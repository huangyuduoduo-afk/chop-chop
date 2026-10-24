/*
 * Action parity: do the same user action in the legacy app (oracle) and with a new
 * domain function, then compare the resulting synced data.
 *
 *   const r = await actionParity({
 *     local,                                   // synthetic qyx_* state
 *     legacy: (w) => { w.eval('addLog("note","合成", null)'); },
 *     next: (draft, clock) => { addLog(draft, { type: 'note', text: '合成' }, clock); },
 *     mask: (b) => { ... },                    // hide generated ids / timestamps that legitimately differ
 *   });
 *   expect(r.diffs).toEqual([]);
 *
 * Legacy runs with frozen time: Date.now() = now + (number of prior calls) ms. The new side
 * gets a clock fixed at `now`. Mask timestamps you cannot align.
 */
// @ts-ignore — plain ESM helper
import { legacyCall } from '../../tools/legacy-oracle.mjs';
import { buildBackup } from '../../src/core/backup';
import type { Snapshot } from '../../src/core/types';
import { clone, type Clock } from '../../src/core/util';

export const NOW = '2026-10-24T09:00:00+08:00';
export const T0 = Date.parse(NOW);

export function fixedClock(at = T0): Clock & { n: number } {
  const c = { n: 0, now: () => at, nonce: () => 'nonce' + ++c.n };
  return c;
}

export function diffPaths(a: any, b: any, path = '', out: string[] = []): string[] {
  if (out.length > 60 || a === b) return out;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    out.push(`${path || '(root)'}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(path + ' (array vs object)'); return out; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${path} length ${a.length} ≠ ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffPaths(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in a)) out.push(`${path}.${k} only in next`);
    else if (!(k in b)) out.push(`${path}.${k} only in legacy`);
    else diffPaths(a[k], b[k], `${path}.${k}`, out);
  }
  return out;
}

export interface ParityResult { legacy: any; next: any; diffs: string[]; errors: string[]; result: unknown }

export async function actionParity(opts: {
  local: Record<string, unknown>;
  legacy: (w: any) => unknown | Promise<unknown>;
  next: (draft: Snapshot, clock: Clock) => unknown;
  mask?: (backup: any, side: 'legacy' | 'next') => void;
  now?: string;
}): Promise<ParityResult> {
  const now = opts.now || NOW;
  const before = await legacyCall({ local: opts.local, now, fn: (w: any) => JSON.parse(w.collectBackup()) });
  const after = await legacyCall({
    local: opts.local,
    now,
    fn: async (w: any) => { await opts.legacy(w); return JSON.parse(w.collectBackup()); },
  });
  const draft: Snapshot = clone(before.result);
  const result = opts.next(draft, fixedClock(Date.parse(now)));
  const legacy = after.result;
  const next = buildBackup(draft, legacy._ver, new Date(0));
  for (const b of [legacy, next]) { delete b._exported; delete b._ver; }
  opts.mask?.(legacy, 'legacy');
  opts.mask?.(next, 'next');
  return { legacy, next, diffs: diffPaths(legacy, next), errors: [...before.errors, ...after.errors], result };
}
