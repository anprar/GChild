import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { sha256Hex } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';
import { findAuthByCredentialHash, touchDevicePresence } from '../repositories/devices.js';

export interface DeviceIdentity {
  deviceId: string;
  familyId: string;
}

export type DeviceAuthenticator = (request: FastifyRequest) => DeviceIdentity;

/**
 * Skema `Authorization: Device <credential>` terpisah dari Bearer Parent.
 * Credential tidak pernah ada di URL/query dan hanya hash yang disimpan server.
 */
export function createDeviceAuth(db: Db, now: () => number): DeviceAuthenticator {
  return (request) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Device ')) {
      throw unauthorized('Credential perangkat diperlukan.');
    }
    const credential = header.slice('Device '.length).trim();
    if (credential.length < 32) {
      throw unauthorized('Credential perangkat tidak valid.');
    }

    const record = findAuthByCredentialHash(db, sha256Hex(credential));
    if (!record) {
      throw unauthorized('Credential perangkat tidak valid atau sudah dicabut.');
    }

    touchDevicePresence(db, {
      deviceId: record.deviceId,
      credentialId: record.credentialId,
      now: now(),
    });

    return { deviceId: record.deviceId, familyId: record.familyId };
  };
}
