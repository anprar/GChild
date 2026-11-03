export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE_TRANSITION'
  | 'FINAL_STATE_ALREADY_SET'
  | 'GONE'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);

export const unauthorized = (message = 'Tidak terautentikasi.') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Tidak diizinkan.') =>
  new AppError(403, 'FORBIDDEN', message);

/** 404 dipakai juga untuk IDOR agar tidak membocorkan keberadaan resource keluarga lain. */
export const notFound = (message = 'Tidak ditemukan.') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, code: ErrorCode = 'CONFLICT') =>
  new AppError(409, code, message);

export const gone = (message = 'Sudah kedaluwarsa.') => new AppError(410, 'GONE', message);

export const rateLimited = (message = 'Terlalu banyak permintaan.') =>
  new AppError(429, 'RATE_LIMITED', message);

export const invalidTransition = (from: string, to: string) =>
  new AppError(
    409,
    'INVALID_STATE_TRANSITION',
    `Transisi ${from} -> ${to} tidak diizinkan.`,
    { from, to },
  );

export const finalStateSet = (state: string) =>
  new AppError(409, 'FINAL_STATE_ALREADY_SET', `State ${state} sudah final.`, { state });
