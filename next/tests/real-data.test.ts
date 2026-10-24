/*
 * Parity on real backups, opt-in and privacy-preserving: set REAL_A and REAL_B to two
 * backup files on disk. Only JSON paths and counts are printed — never values.
 * Run: REAL_A=… REAL_B=… TZ=Asia/Shanghai npx vitest run tests/real-data.test.ts
 */
import { readFileSync } from 'node:fs';
import { buildBackup } from '../src/core/backup';
import { mergeSnapshots } from '../src/core/merge';
// @ts-ignore — plain ESM helper
import { legacyCall, legacyMerge } from '../tools/legacy-oracle.mjs';

const A = process.env.REAL_A, B = process.env.REAL_B;
const NOW = process.env.REAL_NOW || '2026-10-24T09:00:00+08:00';

function diffPaths(a: any, b: any, path = '', out: string[] = []): string[] {
  if (out.length > 40) return out;
  if (a === b) return out;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') { out.push(path || '(root)'); return out; }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(path + ' (array/object)'); return out; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${path} length ${a.length}≠${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffPaths(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const label = /[一-鿿]/.test(k) ? '<key>' : k;
    if (!(k in a) || !(k in b)) out.push(`${path}.${label} only in ${k in a ? 'legacy' : 'new'}`);
    else diffPaths(a[k], b[k], `${path}.${label}`, out);
  }
  return out;
}

function mask(b: any, inputDead: Set<string>) {
  const o = JSON.parse(JSON.stringify(b));
  delete o._exported;
  delete o._ver;
  o.qyx_dead = (o.qyx_dead || []).map((d: any) => ({ ...d, t: inputDead.has(d.s + '\u0000' + d.v) ? d.t : 0 }))
    .sort((x: any, y: any) => (x.s + x.v < y.s + y.v ? -1 : 1));
  for (const k of ['qyx_enough', 'qyx_enough_prev']) (o[k]?.items || []).forEach((i: any) => { if (!i.text) i.id = '<blank>'; });
  return o;
}

describe.skipIf(!A || !B)('real backup parity (values never printed)', () => {
  it('new merge equals legacy merge on real data', async () => {
    const a = JSON.parse(readFileSync(A!, 'utf8'));
    const b = JSON.parse(readFileSync(B!, 'utf8'));
    const local = Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith('qyx_')));
    const normA = (await legacyCall({ local, now: NOW, fn: (w: any) => JSON.parse(w.collectBackup()) })).result;
    const oracle = await legacyMerge({ local, cloud: b, now: NOW });
    expect(oracle.errors).toEqual([]);
    let n = 0;
    const clock = { now: () => Date.parse(NOW), nonce: () => 'n' + ++n };
    const mine = mergeSnapshots(normA, b, clock, { filterLocalTombstones: false, strictIdeaMirror: false });
    const inputDead = new Set([...(normA.qyx_dead || []), ...(b.qyx_dead || [])].map((d: any) => d.s + '\u0000' + d.v));
    const diffs = diffPaths(mask(oracle.backup, inputDead), mask(buildBackup(mine.snapshot, 'x', new Date(0)), inputDead));
    console.log(`records legacy=${oracle.backup.qyx_log.length} new=${mine.snapshot.qyx_log!.length}; changed legacy=${oracle.changed} new=${mine.changed}; diff paths=${diffs.length}`);
    if (diffs.length) console.log(diffs.join('\n'));
    expect(diffs).toEqual([]);

    const fixed = mergeSnapshots(normA, b, clock, { filterLocalTombstones: true, strictIdeaMirror: true });
    console.log(`fixed mode: records ${fixed.snapshot.qyx_log!.length} (legacy keeps ${oracle.backup.qyx_log.length})`);
  }, 120_000);
});
