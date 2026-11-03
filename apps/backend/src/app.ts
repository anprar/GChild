import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { AppError } from './lib/errors.js';
import { createRateLimiter, type RateLimiter } from './lib/rate-limit.js';
import { newId } from './lib/ids.js';
import { createDeviceAuth } from './auth/device-auth.js';
import { registerDeviceSelfRoutes } from './modules/device-self/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';

export interface AppDeps {
  db: Db;
  config: Config;
  now?: () => number;
  limiter?: RateLimiter;
  version?: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const now = deps.now ?? (() => Date.now());
  const limiter = deps.limiter ?? createRateLimiter();
  const version = deps.version ?? '0.1.0-stage1-telegram';

  const app = Fastify({
    logger: {
      level: deps.config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-enrollment-token"]',
          'req.headers.cookie',
        ],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 64 * 1024,
    genReqId: () => newId('req'),
    disableRequestLogging: false,
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-Id', request.id);
    return payload;
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

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Payload tidak valid.',
          requestId: request.id,
          details: {
            issues: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        },
      });
    }

    const candidate = error as { statusCode?: number; name?: string; message?: string };
    const statusCode = candidate.statusCode;
    if (statusCode === 413) {
      return reply.status(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Payload melebihi batas.',
          requestId: request.id,
          details: {},
        },
      });
    }
    if (statusCode === 400) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Payload tidak valid.',
          requestId: request.id,
          details: {},
        },
      });
    }

    request.log.error(
      { errorName: candidate.name, errorMessage: candidate.message },
      'Permintaan gagal tanpa penanganan',
    );
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Terjadi kesalahan internal.',
        requestId: request.id,
        details: {},
      },
    });
  });

  registerHealthRoutes(app, { db: deps.db, version, startedAt: now(), now });
  registerDeviceSelfRoutes(app, {
    db: deps.db,
    config: deps.config,
    now,
    requireDevice: createDeviceAuth(deps.db, now),
    limiter,
  });

  return app;
}
