export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function parseIso(value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error('Timestamp ISO-8601 tidak valid');
  }
  return ms;
}

/** Zona waktu API selalu UTC; waktu perangkat tidak dipercaya untuk expiry. */
export function parseIsoOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
