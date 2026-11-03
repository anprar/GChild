import { describe, expect, it } from 'vitest';
import { createDeviceClient, type FetchLike, type HttpResponseLike } from '../src/client.js';
import { runDeviceCycle } from '../src/index.js';

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

function jsonResponse(status: number, body: unknown): HttpResponseLike {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function fakeFetch(handler: (request: RecordedRequest) => unknown): {
  fetchImpl: FetchLike;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const request: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return jsonResponse(200, handler(request));
  };
  return { fetchImpl, requests };
}

const baseUrl = 'http://127.0.0.1:3000';
const fixedNow = Date.parse('2026-11-03T08:00:00.000Z');
const now = () => fixedNow;

describe('SIMULATOR', () => {
  it('offline tidak mengirim request apa pun', async () => {
    const { fetchImpl, requests } = fakeFetch(() => ({}));
    const client = createDeviceClient({ baseUrl, fetchImpl });
    const summary = await runDeviceCycle(client, { scenario: 'offline', now });

    expect(requests).toHaveLength(0);
    expect(summary.fetched).toBe(0);
    expect(summary.executed).toBe(0);
  });

  it('delay-ack berhenti setelah RECEIVED dan tidak mengeksekusi', async () => {
    const { fetchImpl, requests } = fakeFetch((request) => {
      if (request.url.includes('/ack')) {
        return { commandId: 'cmd_1', state: 'RECEIVED', idempotent: false };
      }
      if (request.url.includes('/device-self/commands')) {
        return {
          serverTime: new Date(fixedNow).toISOString(),
          items: [
            {
              commandId: 'cmd_1',
              type: 'LOCK_SCREEN',
              payload: {},
              state: 'QUEUED',
              createdAt: new Date(fixedNow).toISOString(),
              expiresAt: new Date(fixedNow + 60_000).toISOString(),
            },
          ],
        };
      }
      return { commandId: 'cmd_1', state: 'RECEIVED', idempotent: false };
    });

    const client = createDeviceClient({ baseUrl, fetchImpl });
    client.setCredential('x'.repeat(40));
    const summary = await runDeviceCycle(client, { scenario: 'delay-ack', now });

    const acks = requests.filter((request) => request.url.includes('/ack'));
    expect(summary.fetched).toBe(1);
    expect(summary.executed).toBe(0);
    expect(acks).toHaveLength(1);
    expect((acks[0]?.body as { status: string }).status).toBe('RECEIVED');
  });

  it('duplicate-ack mengirim ulang ackId yang sama dan menghormati idempotent', async () => {
    const { fetchImpl, requests } = fakeFetch((request) => {
      if (request.url.includes('/status')) {
        return { accepted: true, receivedAt: new Date(fixedNow).toISOString() };
      }
      if (request.url.includes('/ack')) {
        return { commandId: 'cmd_2', state: 'SUCCEEDED', idempotent: true };
      }
      if (request.url.includes('/device-self/commands')) {
        return {
          serverTime: new Date(fixedNow).toISOString(),
          items: [
            {
              commandId: 'cmd_2',
              type: 'REQUEST_STATUS',
              payload: {},
              state: 'QUEUED',
              createdAt: new Date(fixedNow).toISOString(),
              expiresAt: new Date(fixedNow + 60_000).toISOString(),
            },
          ],
        };
      }
      return { commandId: 'cmd_2', state: 'SUCCEEDED', idempotent: true };
    });

    const client = createDeviceClient({ baseUrl, fetchImpl });
    client.setCredential('x'.repeat(40));
    const summary = await runDeviceCycle(client, { scenario: 'duplicate-ack', now });

    const finalAcks = requests.filter(
      (request) =>
        request.url.includes('/ack') && (request.body as { status: string }).status === 'SUCCEEDED',
    );
    expect(finalAcks).toHaveLength(2);
    expect((finalAcks[0]?.body as { ackId: string }).ackId).toBe(
      (finalAcks[1]?.body as { ackId: string }).ackId,
    );
    expect(summary.duplicateAck).toBe(true);
  });

  it('command kedaluwarsa dilaporkan EXPIRED dan tidak dieksekusi', async () => {
    const { fetchImpl, requests } = fakeFetch((request) => {
      if (request.url.includes('/ack')) {
        return { commandId: 'cmd_3', state: 'EXPIRED', idempotent: false };
      }
      if (request.url.includes('/device-self/commands')) {
        return {
          serverTime: new Date(fixedNow).toISOString(),
          items: [
            {
              commandId: 'cmd_3',
              type: 'LOCK_SCREEN',
              payload: {},
              state: 'QUEUED',
              createdAt: new Date(fixedNow - 120_000).toISOString(),
              expiresAt: new Date(fixedNow - 1_000).toISOString(),
            },
          ],
        };
      }
      return { commandId: 'cmd_3', state: 'EXPIRED', idempotent: false };
    });

    const client = createDeviceClient({ baseUrl, fetchImpl });
    client.setCredential('x'.repeat(40));
    const summary = await runDeviceCycle(client, { scenario: 'connect', now });

    expect(summary.expired).toBe(1);
    expect(summary.executed).toBe(0);
    const ack = requests.find((request) => request.url.includes('/ack'));
    expect((ack?.body as { status: string }).status).toBe('EXPIRED');
  });

  it('status scenario mengirim capability null, bukan tebakan', async () => {
    const { fetchImpl, requests } = fakeFetch(() => ({
      accepted: true,
      receivedAt: new Date(fixedNow).toISOString(),
    }));
    const client = createDeviceClient({ baseUrl, fetchImpl });
    client.setCredential('x'.repeat(40));
    await runDeviceCycle(client, { scenario: 'status', now, sequence: 7 });

    const body = requests[0]?.body as {
      sequence: number;
      capabilities: Record<string, boolean | null>;
      observedAt: string;
    };
    expect(body.sequence).toBe(7);
    expect(body.capabilities.deviceAdminActive).toBeNull();
    expect(body.observedAt).toBe(new Date(fixedNow).toISOString());
  });
});
