import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DeviceAuthenticator } from '../../auth/device-auth.js';
import type { Config } from '../../config.js';
import type { Db } from '../../db/client.js';
import { ACK_STATUSES } from '../../domain/command-state.js';
import { AppError, badRequest, rateLimited, unauthorized } from '../../lib/errors.js';
import { createRateLimiter, type RateLimiter } from '../../lib/rate-limit.js';
import { parseIsoOrNull, toIso } from '../../lib/time.js';
import { ackCommand, fetchQueuedForDevice } from '../../repositories/commands.js';
import { confirmLocal, claimPairing, getEnrollment } from '../../repositories/pairing.js';
import { upsertStatus } from '../../repositories/status.js';

export interface DeviceSelfDeps {
  db: Db;
  config: Config;
  now: () => number;
  requireDevice: DeviceAuthenticator;
  limiter: RateLimiter;
}

const claimSchema = z.object({
  code: z.string().regex(/^\d{8}$/, 'Kode pairing harus 8 digit'),
  deviceSecret: z.string().min(32).max(256),
  device: z.object({
    label: z.string().min(1).max(60),
    installationId: z.string().min(8).max(128),
    model: z.string().max(80).nullish(),
    manufacturer: z.string().max(80).nullish(),
    appVersion: z.string().max(40).nullish(),
    sdkInt: z.number().int().min(24).max(99).nullish(),
  }),
});

const confirmSchema = z.object({
  accepted: z.boolean(),
  disclosureVersion: z.string().min(1).max(32),
});

const ackSchema = z.object({
  ackId: z.string().min(8).max(128),
  status: z.enum(ACK_STATUSES),
  result: z.record(z.string(), z.unknown()).nullish(),
  error: z
    .object({
      code: z.string().min(1).max(64),
      message: z.string().max(500).optional(),
    })
    .nullish(),
  observedAt: z.string().min(10).max(40).nullish(),
});

const statusSchema = z.object({
  sequence: z.number().int().nonnegative(),
  batteryLevel: z.number().int().min(0).max(100).nullish(),
  charging: z.boolean().nullish(),
  networkConnected: z.boolean().nullish(),
  backendReachable: z.boolean().nullish(),
  screenInteractive: z.boolean().nullish(),
  keyguardLocked: z.boolean().nullish(),
  observedAt: z.string().min(10).max(40),
  capabilities: z.record(z.string(), z.boolean().nullable()).optional(),
  appVersion: z.string().max(40).nullish(),
});

function enrollmentTokenHeader(headers: Record<string, unknown>): string {
  const raw = headers['x-enrollment-token'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length < 16) {
    throw unauthorized('Header X-Enrollment-Token diperlukan.');
  }
  return value;
}

export function registerDeviceSelfRoutes(app: FastifyInstance, deps: DeviceSelfDeps): void {
  const { db, config, now, requireDevice, limiter } = deps;

  // ---------------------------------------------------------------- enrollment
  app.post('/v1/enrollment/claim', async (request, reply) => {
    if (!limiter.consume(`claim:${request.ip}`, 10, 60_000)) {
      throw rateLimited('Terlalu banyak percobaan pairing. Coba lagi nanti.');
    }
    const body = claimSchema.parse(request.body);

    const result = claimPairing(db, {
      code: body.code,
      pepper: config.pairingCodePepper,
      deviceSecret: body.deviceSecret,
      metadata: {
        label: body.device.label,
        installationId: body.device.installationId,
        model: body.device.model ?? null,
        manufacturer: body.device.manufacturer ?? null,
        appVersion: body.device.appVersion ?? null,
        sdkInt: body.device.sdkInt ?? null,
      },
      now: now(),
      codeTtlMs: config.pairingCodeTtlMs,
      claimTtlMs: config.enrollmentTtlMs,
    });

    return reply.status(201).send({
      enrollmentId: result.pairing.id,
      status: result.pairing.status,
      claimToken: result.claimToken,
      claimExpiresAt: toIso(result.claimExpiresAt),
      verificationCode: result.verificationCode,
      deviceLabel: result.pairing.device_label,
    });
  });

  app.post<{ Params: { id: string } }>(
    '/v1/enrollment/:id/confirm-local',
    async (request) => {
      const token = enrollmentTokenHeader(request.headers as Record<string, unknown>);
      const body = confirmSchema.parse(request.body);
      const pairing = confirmLocal(db, {
        pairingId: request.params.id,
        claimToken: token,
        accepted: body.accepted,
        now: now(),
      });
      return { status: pairing.status, deviceLabel: pairing.device_label };
    },
  );

  app.get<{ Params: { id: string } }>('/v1/enrollment/:id', async (request) => {
    const token = enrollmentTokenHeader(request.headers as Record<string, unknown>);
    const pairing = getEnrollment(db, { pairingId: request.params.id, claimToken: token });
    return {
      status: pairing.status,
      deviceLabel: pairing.device_label,
      verificationCode: pairing.verification_code,
    };
  });

  // ------------------------------------------------------------------ commands
  app.get('/v1/device-self/commands', async (request) => {
    const device = requireDevice(request);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(20).default(10) })
      .parse(request.query);

    const rows = fetchQueuedForDevice(db, {
      deviceId: device.deviceId,
      now: now(),
      limit: query.limit,
    });

    return {
      serverTime: toIso(now()),
      items: rows.map((row) => ({
        commandId: row.id,
        type: row.type,
        payload: JSON.parse(row.payload_json) as Record<string, unknown>,
        state: row.state,
        createdAt: toIso(row.created_at),
        expiresAt: toIso(row.expires_at),
      })),
    };
  });

  app.post<{ Params: { id: string } }>(
    '/v1/device-self/commands/:id/ack',
    async (request) => {
      const device = requireDevice(request);
      if (!limiter.consume(`ack:${device.deviceId}`, 120, 60_000)) {
        throw rateLimited('Terlalu banyak ACK.');
      }
      const body = ackSchema.parse(request.body);

      const observedAt = parseIsoOrNull(body.observedAt ?? null);
      if (body.observedAt && observedAt === null) {
        throw badRequest('observedAt bukan ISO-8601 yang valid.');
      }

      const result = ackCommand(db, {
        deviceId: device.deviceId,
        commandId: request.params.id,
        ackId: body.ackId,
        status: body.status,
        result: body.result ?? null,
        error: body.error ?? null,
        observedAt,
        now: now(),
        leaseMs: config.commandLeaseMs,
      });

      return {
        commandId: result.command.id,
        state: result.command.state,
        idempotent: result.idempotent,
        expiresAt: toIso(result.command.expires_at),
      };
    },
  );

  // -------------------------------------------------------------------- status
  app.post('/v1/device-self/status', async (request) => {
    const device = requireDevice(request);
    if (!limiter.consume(`status:${device.deviceId}`, 60, 60_000)) {
      throw rateLimited('Terlalu banyak laporan status.');
    }
    const body = statusSchema.parse(request.body);

    const observedAt = parseIsoOrNull(body.observedAt);
    if (observedAt === null) {
      throw badRequest('observedAt bukan ISO-8601 yang valid.');
    }

    const receivedAt = now();
    const result = upsertStatus(db, {
      deviceId: device.deviceId,
      sequence: body.sequence,
      batteryLevel: body.batteryLevel ?? null,
      charging: body.charging ?? null,
      networkConnected: body.networkConnected ?? null,
      backendReachable: body.backendReachable ?? null,
      screenInteractive: body.screenInteractive ?? null,
      keyguardLocked: body.keyguardLocked ?? null,
      observedAt,
      receivedAt,
      capabilities: body.capabilities,
      appVersion: body.appVersion ?? null,
    });

    return {
      accepted: result.accepted,
      receivedAt: toIso(receivedAt),
      note: result.accepted
        ? 'Snapshot diterima.'
        : 'Snapshot diabaikan karena sequence lebih lama.',
    };
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          details: error.details ?? {},
        },
      });
    }
    throw error;
  });
}

export const deviceSelfDefaultLimiter = createRateLimiter();
