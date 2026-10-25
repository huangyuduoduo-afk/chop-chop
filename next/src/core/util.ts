import type { DayKey, Ms } from './types';

/** FNV-1a over UTF-16 code units, base36. Must match legacy `stableId` exactly. */
export function stableId(prefix: string, value: unknown): string {
  let h = 2166136261;
  for (const ch of String(value)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return prefix + (h >>> 0).toString(36);
}

export const pad = (n: number) => String(n).padStart(2, '0');

/** Local-time day key, same as legacy `dayKey`. */
export function dayKey(t: Ms): DayKey {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthKey(t: Ms): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

/** Injected time/randomness so core logic stays deterministic under test. */
export interface Clock {
  now(): Ms;
  /** Unique token for generated ids (legacy used Date.now()+Math.random()). */
  nonce(): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  nonce: () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}|${Math.random()}`),
};
