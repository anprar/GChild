export interface HttpResponseLike {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponseLike>;

export interface SimulatorDeviceMetadata {
  label: string;
  installationId: string;
  model: string;
  manufacturer: string;
  appVersion: string;
  sdkInt: number;
}

export interface DeviceCommand {
  commandId: string;
  type: 'REQUEST_STATUS' | 'LOCK_SCREEN';
  payload: Record<string, unknown>;
  state: string;
  createdAt: string;
  expiresAt: string;
}

export interface AckBody {
  ackId: string;
  status: 'RECEIVED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
  result?: Record<string, unknown>;
  error?: { code: string; message?: string };
  observedAt?: string;
}

export interface AckResponse {
  commandId: string;
  state: string;
  idempotent?: boolean;
}

export class SimulatorHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SimulatorHttpError';
  }
}

function errorCode(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: { code?: unknown } }).error;
    if (error && typeof error.code === 'string') return error.code;
  }
  return 'UNKNOWN';
}

function errorMessage(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === 'string') return error.message;
  }
  return '';
}

export interface DeviceClient {
  setCredential(credential: string): void;
  claim(input: {
    code: string;
    deviceSecret: string;
    device: SimulatorDeviceMetadata;
  }): Promise<{ enrollmentId: string; claimToken: string; verificationCode: string; status: string }>;
  confirmLocal(
    enrollmentId: string,
    claimToken: string,
    accepted: boolean,
  ): Promise<{ status: string }>;
  getEnrollment(enrollmentId: string, claimToken: string): Promise<{ status: string }>;
  fetchCommands(limit?: number): Promise<{ items: DeviceCommand[]; serverTime: string }>;
  ack(commandId: string, body: AckBody): Promise<AckResponse>;
  postStatus(body: Record<string, unknown>): Promise<{ accepted: boolean; receivedAt: string }>;
}

export function createDeviceClient(options: {
  baseUrl: string;
  fetchImpl?: FetchLike;
}): DeviceClient {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const fetchImpl: FetchLike =
    options.fetchImpl ??
    ((url, init) => fetch(url, init) as unknown as Promise<HttpResponseLike>);

  let credential: string | null = null;

  const send = async (
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> },
  ): Promise<unknown> => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        'content-type': 'application/json',
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new SimulatorHttpError(
        response.status,
        errorCode(body),
        errorMessage(body) || `HTTP ${response.status}`,
      );
    }
    return body;
  };

  const deviceHeaders = (): Record<string, string> => {
    if (!credential) throw new Error('Credential perangkat belum diset');
    return { authorization: `Device ${credential}` };
  };

  return {
    setCredential(value) {
      credential = value;
    },

    async claim(input) {
      return (await send('/v1/enrollment/claim', {
        method: 'POST',
        body: input,
      })) as { enrollmentId: string; claimToken: string; verificationCode: string; status: string };
    },

    async confirmLocal(enrollmentId, claimToken, accepted) {
      return (await send(`/v1/enrollment/${enrollmentId}/confirm-local`, {
        method: 'POST',
        headers: { 'x-enrollment-token': claimToken },
        body: { accepted, disclosureVersion: 'simulator-1' },
      })) as { status: string };
    },

    async getEnrollment(enrollmentId, claimToken) {
      return (await send(`/v1/enrollment/${enrollmentId}`, {
        method: 'GET',
        headers: { 'x-enrollment-token': claimToken },
      })) as { status: string };
    },

    async fetchCommands(limit = 10) {
      return (await send(`/v1/device-self/commands?limit=${limit}`, {
        method: 'GET',
        headers: deviceHeaders(),
      })) as { items: DeviceCommand[]; serverTime: string };
    },

    async ack(commandId, body) {
      return (await send(`/v1/device-self/commands/${commandId}/ack`, {
        method: 'POST',
        headers: deviceHeaders(),
        body,
      })) as AckResponse;
    },

    async postStatus(body) {
      return (await send('/v1/device-self/status', {
        method: 'POST',
        headers: deviceHeaders(),
        body,
      })) as { accepted: boolean; receivedAt: string };
    },
  };
}
