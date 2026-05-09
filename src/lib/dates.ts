// Shared date helpers for ISO YYYY-MM-DD strings used by Postgres DATE columns.
// Mirrors the helpers originally inlined in src/controllers/batches/create.ts.

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Returns the ISO date `n` days before today. Used to bound the lookback window.
export function isoDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Inclusive day delta between two ISO dates (from <= to). Returns null when invalid.
export function daysBetween(fromIso: string, toIso: string): number | null {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return null;
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.floor((to - from) / 86_400_000) + 1;
}
