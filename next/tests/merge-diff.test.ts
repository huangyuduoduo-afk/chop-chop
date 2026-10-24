// Differential tests: legacy Chopchop mergeAll (executed in jsdom via tools/legacy-oracle.mjs)
// versus the pure TypeScript port in src/core/merge.ts. Synthetic data only.
// Run: cd next && TZ=Asia/Shanghai npx vitest run tests/merge-diff.test.ts   (MD_SEEDS=500 for more seeds, MD_DEBUG=1 for stats)
//
// Known real divergences (tests left failing on purpose; each has a focused repro under 'focused cases'):
//   1. qyx_dice: a never-saved pool is DEFAULT_DICE in legacy memory but null in collectBackup -> port loses the defaults.
//   2. today-mirror: legacy task()/item() ignore rows with removedAt; port does not (merge.ts v5 mirror block).
//   3. today-mirror of an idea: legacy re-runs mergeState(LS copy, mutated state); with equal updatedAt the JSON.stringify
//      tie-break may discard the mirror update; port always applies it.
// @ts-expect-error plain ESM JS module without types
import { legacyMerge, legacyCall } from '../tools/legacy-oracle.mjs';
import { mergeSnapshots } from '../src/core/merge';
import { buildBackup } from '../src/core/backup';
import { genCase, NOW_ISO, T0, TODAY, YESTERDAY } from './fixtures/gen';

const NOW = NOW_ISO;
const NEXT_DAY = '2026-10-25T09:00:00+08:00'; // every 'today' row of the generated data is now yesterday
const SEEDS = Array.from({ length: Number(process.env.MD_SEEDS || 120) }, (_, i) => i + 1);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const SEP = '\u0000';

/* ---------------- comparator ---------------- */
export interface Diff { path: string; a: unknown; b: unknown }
export function diffPaths(a: any, b: any, path = ''): Diff[] {
  if (a === b) return [];
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (a === undefined && b === undefined) return [];
  if (ta !== tb) return [{ path: path || '$', a, b }];
  if (ta === 'array') {
    const out: Diff[] = [];
    const n = Math.max(a.length, b.length);
    if (a.length !== b.length) out.push({ path: `${path}.length`, a: a.length, b: b.length });
    for (let i = 0; i < n; i++) out.push(...diffPaths(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  if (ta === 'object') {
    const out: Diff[] = [];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const va = a[k], vb = b[k];
      if (va === undefined && vb === undefined) continue;
      out.push(...diffPaths(va, vb, path ? `${path}.${k}` : k));
    }
    return out;
  }
  return Number.isNaN(a) && Number.isNaN(b) ? [] : [{ path: path || '$', a, b }];
}
const short = (v: unknown) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 160 ? s.slice(0, 160) + '…' : s; };
export const formatDiffs = (ds: Diff[], limit = 25) =>
  ds.slice(0, limit).map((d) => `  ${d.path}\n      legacy: ${short(d.a)}\n      ts    : ${short(d.b)}`).join('\n') + (ds.length > limit ? `\n  … ${ds.length - limit} more` : '');

/* ---------------- masking ---------------- */
const deadKey = (d: any) => `${d.s}${SEP}${d.v}`;
function maskBackup(b: any, knownDead: Set<string>): any {
  const o = clone(b);
  delete o._exported;
  if (Array.isArray(o.qyx_dead)) {
    // tombstones: compare as a set of s\0v; `t` only when the tombstone existed in an input
    // (new ones are created by dedupeDoneLogEntries with legacy's incrementing Date.now()).
    const m: Record<string, number | null> = { '#count': o.qyx_dead.length };
    for (const d of o.qyx_dead) m[deadKey(d).replace(SEP, '␀')] = knownDead.has(deadKey(d)) ? d.t : null;
    o.qyx_dead = m;
  }
  for (const k of ['qyx_enough', 'qyx_enough_prev']) {
    // blank rows get ids from Date.now()+Math.random() in legacy
    for (const it of o[k]?.items || []) if (!it.text || !String(it.text).trim()) delete it.id;
  }
  return o;
}

/* ---------------- running both implementations ---------------- */
function mkClock(now: string) {
  let n = 0;
  return { now: () => Date.parse(now), nonce: () => `nonce-${++n}` };
}
function runMine(normA: any, remote: any, now: string, fix: boolean, ver: string) {
  const res = mergeSnapshots(clone(normA), clone(remote), mkClock(now), { filterLocalTombstones: fix, strictIdeaMirror: false });
  return { backup: buildBackup(res.snapshot, ver, new Date(0)) as any, changed: res.changed };
}
const collect = (w: any) => JSON.parse(w.collectBackup());

export interface CaseRun {
  A: any; B: any; rawRemote: boolean; features: string[];
  normA: any; remote: any;
  errors: string[];
  oracle: any; oracleChanged: boolean;
  parity: { backup: any; changed: boolean };
  fixed: { backup: any; changed: boolean };
  known: Set<string>;
}
async function runCase(A: any, B: any, rawRemote: boolean, now = NOW, features: string[] = []): Promise<CaseRun> {
  const errors: string[] = [];
  const na = await legacyCall({ local: A, now, fn: collect });
  errors.push(...na.errors.map((e: string) => 'normA: ' + e));
  let remote: any;
  if (rawRemote) remote = clone(B);
  else {
    const nb = await legacyCall({ local: B, now, fn: collect });
    errors.push(...nb.errors.map((e: string) => 'normB: ' + e));
    remote = nb.result;
  }
  const lm = await legacyMerge({ local: A, cloud: remote, now });
  errors.push(...lm.errors.map((e: string) => 'merge: ' + e));
  const normA = na.result;
  const ver = lm.backup._ver;
  const known = new Set<string>([...(normA.qyx_dead || []), ...(remote.qyx_dead || [])].map(deadKey));
  return {
    A, B, rawRemote, features, normA, remote, errors,
    oracle: lm.backup, oracleChanged: lm.changed,
    parity: runMine(normA, remote, now, false, ver),
    fixed: runMine(normA, remote, now, true, ver),
    known,
  };
}

/** B as a device's own localStorage: a key that was never written is absent (not the string "null"). */
function asLocal(b: any) {
  const o: any = {};
  for (const [k, v] of Object.entries(b)) if (v !== null && v !== undefined) o[k] = v;
  // a never-saved dice pool is the separately-tested default-pool divergence; keep these runs about everything else
  if (!o.qyx_dice) o.qyx_dice = ['合成骰子 补'];
  return o;
}

type Kind = 'main' | 'swap' | 'again' | 'nextday';
const memo = new Map<string, Promise<CaseRun>>();
/**
 * main : A local, B remote (B normalised by legacy boot unless the generator asked for a raw gist)
 * swap : B local, A remote  (other direction)
 * again: local = legacy's own merged result for `main`, same remote merged a second time (idempotence / second generation)
 */
function getSeed(seed: number, kind: Kind = 'main'): Promise<CaseRun> {
  const key = `${seed}:${kind}`;
  let p = memo.get(key);
  if (!p) {
    p = (async (): Promise<CaseRun> => {
      const c = genCase(seed);
      if (kind === 'main') return runCase(c.A, c.B, c.rawRemote, NOW, c.features);
      if (kind === 'nextday') return runCase(c.A, c.B, c.rawRemote, NEXT_DAY, [...c.features, 'next-day']);
      if (kind === 'swap') return runCase(asLocal(c.B), c.A, false, NOW, [...c.features, 'swapped']);
      const first = await getSeed(seed, 'main');
      const A2: any = {};
      for (const [k, v] of Object.entries(first.oracle)) if (!k.startsWith('_') && v !== null) A2[k] = v;
      return runCase(A2, first.remote, true, NOW, [...c.features, 'again']);
    })();
    memo.set(key, p);
  }
  return p;
}

function parityDiffs(c: CaseRun) {
  return diffPaths(maskBackup(c.oracle, c.known), maskBackup(c.parity.backup, c.known));
}

/* ---------------- "fixed mode" explainability ---------------- */
const logKey = (e: any) => e.id || `${e.t}|${e.type}|${e.text}`;
const contentKey = (e: any) => `${e.t || 0}|${e.type || ''}|${e.text || ''}`;
const dayOf = (t: number) => { const d = new Date(t); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const doneIdentity = (e: any) => `${dayOf(e.t)}|${e.type}|${e.src || ''}|${e.text}`;
const same = (a: any, b: any) => diffPaths(a, b).length === 0;
const isPrefix = (p: any[], a: any[]) => p.length <= a.length && p.every((x, i) => same(x, a[i]));

/**
 * Differences between legacy (O) and fixed-mode TS (F) must all be explained by tombstones in the
 * merged qyx_dead (`dead`) plus their downstream effects (slicing to 9/10/30/12, content-dedupe and
 * done-dedupe survivors, recomputed prev-day stats). Returns the list of unexplained differences.
 */
export function explainFixedDiffs(O: any, F: any, dead: Set<string>, remote: any, inputs: { normA: any }): string[] {
  const problems: string[] = [];
  const isDead = (s: string, v: unknown) => dead.has(`${s}${SEP}${v}`);
  const keys = new Set([...Object.keys(O), ...Object.keys(F)]);
  for (const k of keys) {
    if (same(O[k], F[k])) continue;
    switch (k) {
      case 'qyx_log': {
        const Ol: any[] = O.qyx_log || [], Fl: any[] = F.qyx_log || [];
        const Fm = new Map(Fl.map((e) => [logKey(e), e])), Om = new Map(Ol.map((e) => [logKey(e), e]));
        const missing = Ol.filter((e) => !Fm.has(logKey(e)));
        for (const e of missing) if (!isDead('log', logKey(e))) problems.push(`log ${logKey(e)} missing from fixed output without a tombstone`);
        for (const e of Fl) {
          if (!Om.has(logKey(e))) {
            const gone = missing.filter((m) => isDead('log', logKey(m)));
            const explained = gone.some((m) => contentKey(m) === contentKey(e) || (e.type === 'done' && m.type === 'done' && doneIdentity(m) === doneIdentity(e)));
            if (!explained) problems.push(`log ${logKey(e)} appears only in fixed output and is not a dedupe survivor of a tombstoned row`);
          } else if (!same(Om.get(logKey(e)), e)) problems.push(`log ${logKey(e)} differs in content`);
        }
        const oc = Ol.filter((e) => Fm.has(logKey(e))).map(logKey), fc = Fl.filter((e) => Om.has(logKey(e))).map(logKey);
        if (!same(oc, fc)) problems.push('log: relative order of common rows differs');
        break;
      }
      case 'qyx_dead': {
        const ok = new Set((O.qyx_dead || []).map(deadKey)), fk = new Set((F.qyx_dead || []).map(deadKey));
        for (const x of [...ok].filter((x) => !fk.has(x as string)).concat([...fk].filter((x) => !ok.has(x as string)))) if (!String(x).startsWith(`log${SEP}`)) problems.push(`qyx_dead differs outside scope log: ${String(x).replace(SEP, '␀')}`);
        break;
      }
      case 'qyx_dice': {
        const exp = (O.qyx_dice || []).filter((v: string) => !isDead('dice', v));
        if (!same(exp, F.qyx_dice || [])) problems.push(`qyx_dice: expected legacy minus tombstoned ${short(exp)}, got ${short(F.qyx_dice)}`);
        break;
      }
      case 'qyx_opts':
      case 'qyx_bench': {
        if (k === 'qyx_bench' && O.qyx_opts && !same(O.qyx_opts, F.qyx_opts) && memoOptsChecked.has(O)) break;
        memoOptsChecked.add(O);
        const Oo: string[] = O.qyx_opts || [], Ob: string[] = O.qyx_bench || [], Fo: string[] = F.qyx_opts || [], Fb: string[] = F.qyx_bench || [];
        const keep = (a: string[]) => a.filter((v) => !isDead('opt', v));
        const sO = new Set([...Oo, ...Ob].filter((v) => !isDead('opt', v))), sF = new Set([...Fo, ...Fb]);
        if (!(sO.size === sF.size && [...sO].every((v) => sF.has(v)))) problems.push(`opts∪bench pool differs beyond tombstones: legacy-minus-dead ${short([...sO])} vs fixed ${short([...sF])}`);
        if (Fo.length > 9) problems.push('qyx_opts longer than 9');
        if (!isPrefix(keep(Oo), Fo)) problems.push(`qyx_opts: legacy-minus-dead ${short(keep(Oo))} is not a prefix of fixed ${short(Fo)}`);
        const kb = keep(Ob).filter((v) => Fb.includes(v)), fb = Fb.filter((v) => keep(Ob).includes(v));
        if (!same(kb, fb)) problems.push('qyx_bench: relative order of surviving rows differs');
        break;
      }
      case 'qyx_ongoing':
      case 'qyx_rules': {
        const field = k === 'qyx_ongoing' ? 'ongoing' : 'rule';
        const cap = k === 'qyx_ongoing' ? 10 : 30;
        const Ol: any[] = O[k] || [], Fl: any[] = F[k] || [];
        const exp = Ol.filter((x) => !isDead(field, x.text));
        if (Fl.length > cap) problems.push(`${k} longer than ${cap}`);
        if (!isPrefix(exp, Fl)) problems.push(`${k}: legacy-minus-tombstoned is not a prefix of fixed output`);
        const pool = k === 'qyx_ongoing' ? [...(inputs.normA.qyx_ongoing || []), ...(remote.qyx_ongoing || [])] : [...(inputs.normA.qyx_rules || []), ...(remote.qyx_rules || [])];
        for (const x of Fl.slice(exp.length)) if (isDead(field, x.text) || !pool.some((p: any) => p.text === x.text)) problems.push(`${k}: unexpected extra row ${short(x)}`);
        break;
      }
      case 'qyx_months': {
        const Om = O.qyx_months || {}, Fm = F.qyx_months || {};
        for (const ym of new Set([...Object.keys(Om), ...Object.keys(Fm)])) {
          const Og: any[] = Om[ym] || [], Fg: any[] = Fm[ym] || [];
          for (const og of Og) {
            const fg = Fg.find((x) => x.text === og.text);
            if (isDead('anchor:' + ym, og.text)) { if (fg) problems.push(`months ${ym} "${og.text}" tombstoned but still present`); continue; }
            if (!fg) { problems.push(`months ${ym} "${og.text}" missing without tombstone`); continue; }
            const exp = { ...og, splits: (og.splits || []).filter((sp: any) => !isDead('split:' + og.text, sp.text)) };
            const ds = diffPaths(exp, fg);
            if (ds.length) problems.push(`months ${ym} "${og.text}" differs beyond split tombstones:\n${formatDiffs(ds, 5)}`);
          }
          const remoteTexts = new Set((remote.qyx_months?.[ym] || []).map((x: any) => x.text));
          for (const fg of Fg) if (!Og.some((x) => x.text === fg.text) && (isDead('anchor:' + ym, fg.text) || !remoteTexts.has(fg.text))) problems.push(`months ${ym} unexpected extra goal "${fg.text}"`);
          const oc = Og.filter((x) => Fg.some((y) => y.text === x.text)).map((x) => x.text), fc = Fg.filter((x) => Og.some((y) => y.text === x.text)).map((x) => x.text);
          if (!same(oc, fc)) problems.push(`months ${ym}: relative goal order differs`);
        }
        break;
      }
      case 'qyx_sums': {
        const Os = O.qyx_sums || {}, Fs = F.qyx_sums || {};
        for (const d of new Set([...Object.keys(Os), ...Object.keys(Fs)])) {
          if (same(Os[d], Fs[d])) continue;
          const ds = diffPaths(Os[d], Fs[d]).filter((x) => !x.path.startsWith('stats'));
          const dayLog = (F.qyx_log || []).filter((e: any) => dayOf(e.t) === d);
          const stats = { cut: dayLog.filter((e: any) => e.type === 'dice' || e.type === 'ai').length, notes: dayLog.filter((e: any) => e.type === 'note').length, done: dayLog.filter((e: any) => e.type === 'done').length };
          if (ds.length || !(Fs[d]?.v2 && F.qyx_enough_prev?.d === d && same(Fs[d].stats, stats))) problems.push(`qyx_sums[${d}] differs for a reason other than recomputed stats:\n${formatDiffs(diffPaths(Os[d], Fs[d]), 5)}`);
        }
        break;
      }
      default:
        problems.push(`unexplained difference in ${k}:\n${formatDiffs(diffPaths(O[k], F[k]), 5)}`);
    }
  }
  return problems;
}
const memoOptsChecked = new WeakSet<object>();

/** Fixed-mode reference built from legacy itself: prefilter LOCAL data with the merged tombstones, then run legacy. */
function filterLocalByTombstones(normA: any, remote: any) {
  const dead = new Set([...(normA.qyx_dead || []), ...(remote.qyx_dead || [])].map(deadKey));
  const isDead = (s: string, v: unknown) => dead.has(`${s}${SEP}${v}`);
  const a = clone(normA);
  for (const k of Object.keys(a)) if (a[k] === null || k.startsWith('_')) delete a[k]; // null in a backup == key never written
  a.qyx_log = (a.qyx_log || []).filter((e: any) => !isDead('log', logKey(e)));
  for (const k of ['qyx_opts', 'qyx_bench']) if (Array.isArray(a[k])) a[k] = a[k].filter((v: string) => !isDead('opt', v));
  if (Array.isArray(a.qyx_dice)) a.qyx_dice = a.qyx_dice.filter((v: string) => !isDead('dice', v));
  if (Array.isArray(a.qyx_ongoing)) a.qyx_ongoing = a.qyx_ongoing.filter((x: any) => !isDead('ongoing', x.text));
  if (Array.isArray(a.qyx_rules)) a.qyx_rules = a.qyx_rules.filter((x: any) => !isDead('rule', x.text));
  for (const ym of Object.keys(a.qyx_months || {})) {
    a.qyx_months[ym] = (a.qyx_months[ym] || []).filter((g: any) => !isDead('anchor:' + ym, g.text));
    for (const g of a.qyx_months[ym]) g.splits = (g.splits || []).map((x: any) => (typeof x === 'string' ? { text: x, done: false } : x)).filter((x: any) => !isDead('split:' + g.text, x.text));
  }
  return a;
}

/* =========================================================================================== */

describe('legacy parity (filterLocalTombstones:false)', () => {
  it.each(SEEDS)('seed %i: legacy booted without errors', async (seed) => {
    const c = await getSeed(seed);
    expect(c.errors).toEqual([]);
  }, 120_000);

  it.each(SEEDS)('seed %i: merged backup equals legacy', async (seed) => {
    const c = await getSeed(seed);
    const ds = parityDiffs(c);
    expect(ds.length, `seed ${seed} [${c.features.join(',')}] rawRemote=${c.rawRemote}: ${ds.length} differing paths\n${formatDiffs(ds)}`).toBe(0);
  }, 120_000);

  it.each(SEEDS)('seed %i: changed flag agrees', async (seed) => {
    const c = await getSeed(seed);
    expect(c.parity.changed, `seed ${seed}: legacy changed=${c.oracleChanged}, ts changed=${c.parity.changed}`).toBe(c.oracleChanged);
  }, 120_000);

  it.each(SEEDS)('seed %i: opposite direction (B local, A remote) equals legacy', async (seed) => {
    const c = await getSeed(seed, 'swap');
    expect(c.errors).toEqual([]);
    const ds = parityDiffs(c);
    expect(ds.length, `seed ${seed} swapped [${c.features.join(',')}]: ${ds.length} differing paths\n${formatDiffs(ds)}`).toBe(0);
    expect(c.parity.changed, `seed ${seed} swapped: legacy changed=${c.oracleChanged}, ts changed=${c.parity.changed}`).toBe(c.oracleChanged);
  }, 120_000);

  it.each(SEEDS)('seed %i: same data merged a day later (everything rolls over) equals legacy', async (seed) => {
    const c = await getSeed(seed, 'nextday');
    expect(c.errors).toEqual([]);
    const ds = parityDiffs(c);
    expect(ds.length, `seed ${seed} next-day [${c.features.join(',')}]: ${ds.length} differing paths\n${formatDiffs(ds)}`).toBe(0);
    expect(c.parity.changed, `seed ${seed} next-day: legacy changed=${c.oracleChanged}, ts changed=${c.parity.changed}`).toBe(c.oracleChanged);
  }, 120_000);

  it.each(SEEDS)('seed %i: second merge of the same remote into legacy\'s own result equals legacy (and changed agrees)', async (seed) => {
    const c = await getSeed(seed, 'again');
    expect(c.errors).toEqual([]);
    const ds = parityDiffs(c);
    expect(ds.length, `seed ${seed} again [${c.features.join(',')}]: ${ds.length} differing paths\n${formatDiffs(ds)}`).toBe(0);
    // Legacy can report changed=true with identical data: the v5 idea mirror mutates an idea, then the
    // JSON tie-break restores the stored copy but the flag stays set. The TS port compares data, so it
    // may only be *less* eager than legacy, never claim a change legacy did not see.
    if (c.parity.changed) expect(c.oracleChanged, `seed ${seed} again: ts changed but legacy did not`).toBe(true);
  }, 120_000);
});

describe('fixed mode (filterLocalTombstones:true)', () => {
  it.each(SEEDS)('seed %i: every difference from legacy is explained by a tombstone', async (seed) => {
    const c = await getSeed(seed);
    const deadF = new Set<string>((c.fixed.backup.qyx_dead || []).map(deadKey));
    const O = maskBackup(c.oracle, c.known), F = maskBackup(c.fixed.backup, c.known);
    // after masking qyx_dead is a map; restore plain tombstone lists for the explainer
    O.qyx_dead = c.oracle.qyx_dead; F.qyx_dead = c.fixed.backup.qyx_dead;
    const problems = explainFixedDiffs(O, F, deadF, c.remote, { normA: c.normA });
    expect(problems.length, `seed ${seed} [${c.features.join(',')}]:\n${problems.join('\n')}`).toBe(0);
  }, 120_000);

  // Stronger: fixed mode == legacy mergeAll applied to local data pre-filtered by the merged tombstones.
  const REF_SEEDS = SEEDS.filter((s) => s % 2 === 0);
  it.each(REF_SEEDS)('seed %i: equals legacy run on tombstone-filtered local data', async (seed) => {
    const c = await getSeed(seed);
    const filtered = filterLocalByTombstones(c.normA, c.remote);
    const ref = await legacyMerge({ local: filtered, cloud: c.remote, now: NOW });
    expect(ref.errors).toEqual([]);
    const ds = diffPaths(maskBackup(ref.backup, c.known), maskBackup(c.fixed.backup, c.known));
    expect(ds.length, `seed ${seed} [${c.features.join(',')}]: ${ds.length} differing paths\n${formatDiffs(ds)}`).toBe(0);
  }, 120_000);
});

/* =========================================================================================== */
/* Hand-written focused cases                                                                   */

const rec = (id: string, t: number, text: string, extra: Record<string, unknown> = {}) => ({ id, t, updatedAt: t, type: 'note', text, mood: null, src: null, q: null, ...extra });
const blank = (id: string) => ({ id, text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] });
const day = (d: string, items: any[]) => ({ d, items });
async function focused(A: any, B: any, raw = true) {
  const c = await runCase(A, B, raw, NOW);
  return { c, ds: parityDiffs(c) };
}

describe('focused cases', () => {
  it('remote deletion of a record local still has: parity keeps it, fixed mode removes it', async () => {
    const r1 = rec('rec_focus1', T0 - 3 * 3_600_000, '合成记录 甲');
    const r2 = rec('rec_focus2', T0 - 2 * 3_600_000, '合成记录 乙');
    const A = { qyx_log: [r1, r2], qyx_dice: ['合成骰子 1'] };
    const B = { qyx_log: [r2], qyx_dice: ['合成骰子 1'], qyx_dead: [{ s: 'log', v: 'rec_focus1', t: T0 - 1_000_000 }] };
    const { c, ds } = await focused(A, B);
    expect(c.errors).toEqual([]);
    expect(ds.length, formatDiffs(ds)).toBe(0);
    expect(c.oracle.qyx_log.map((e: any) => e.id)).toEqual(['rec_focus1', 'rec_focus2']); // legacy resurrects/keeps
    expect(c.parity.backup.qyx_log.map((e: any) => e.id)).toEqual(['rec_focus1', 'rec_focus2']);
    expect(c.fixed.backup.qyx_log.map((e: any) => e.id)).toEqual(['rec_focus2']);
    expect(c.fixed.backup.qyx_dead.some((d: any) => d.s === 'log' && d.v === 'rec_focus1')).toBe(true);
    const O = maskBackup(c.oracle, c.known), F = maskBackup(c.fixed.backup, c.known);
    O.qyx_dead = c.oracle.qyx_dead; F.qyx_dead = c.fixed.backup.qyx_dead;
    const problems = explainFixedDiffs(O, F, new Set(c.fixed.backup.qyx_dead.map(deadKey)), c.remote, { normA: c.normA });
    expect(problems).toEqual([]);
  }, 120_000);

  it('remote tombstone does remove a REMOTE copy and blocks a re-add (both modes)', async () => {
    const r1 = rec('rec_focus3', T0 - 3_600_000, '合成记录 丙');
    const A = { qyx_log: [], qyx_dice: ['合成骰子 1'] };
    const B = { qyx_log: [r1], qyx_dice: ['合成骰子 1'], qyx_dead: [{ s: 'log', v: 'rec_focus3', t: T0 - 5000 }] };
    const { c, ds } = await focused(A, B);
    expect(ds.length, formatDiffs(ds)).toBe(0);
    expect(c.oracle.qyx_log).toEqual([]);
    expect(c.fixed.backup.qyx_log).toEqual([]);
  }, 120_000);

  it('today mirror of a v5 checklist task: newer remote row text/done flows into the plan task', async () => {
    const plan = { id: 'plan_focus0001', recordId: 'rec5_focusrec', text: '合成清单 旧', done: false, scheduledDate: TODAY, order: 0, createdAt: T0 - 9 * 3_600_000, updatedAt: T0 - 8 * 3_600_000 };
    const note = rec('rec5_focusrec', T0 - 9 * 3_600_000, '合成记录 清单', { submissionId: 'focusrec' });
    const mkSide = (text: string, status: string, updatedAt: number) => ({
      qyx_log: [note],
      qyx_dice: ['x'],
      qyx_enough: day(TODAY, [{ id: 'task_m1', text, done: status === 'completed', status, updatedAt, subs: [], v5TaskId: plan.id }, blank('task_m2'), blank('task_m3')]),
      qyx_ideas_v5: { schema: 2, items: [], links: [], events: [], tasks: [plan] },
    });
    const A = mkSide('合成事项 旧', 'incomplete', T0 - 8 * 3_600_000);
    const B = mkSide('合成事项 新', 'completed', T0 - 600_000);
    const { c, ds } = await focused(A, B);
    expect(c.errors).toEqual([]);
    expect(ds.length, formatDiffs(ds)).toBe(0);
    const p = c.oracle.qyx_ideas_v5.tasks.find((t: any) => t.id === plan.id);
    expect(p).toMatchObject({ text: '合成事项 新', done: true, updatedAt: T0 - 600_000 });
    expect(c.parity.backup.qyx_ideas_v5.tasks.find((t: any) => t.id === plan.id)).toMatchObject({ text: '合成事项 新', done: true });
    // the row itself only takes the newer status (legacy never copies a non-blank remote text over local text)
    expect(c.oracle.qyx_enough.items[0]).toMatchObject({ text: '合成事项 旧', status: 'completed', v5TaskId: plan.id });
  }, 120_000);

  it('today mirror of a v5 idea: statusUpdatedAt gate', async () => {
    const note = rec('rec5_focusidea', T0 - 9 * 3_600_000, '合成记录 想法', { submissionId: 'focusidea' });
    const idea = { id: 'idea_focusidea', title: '合成想法 旧', icon: 'star', status: 'open', rootRecordId: note.id, createdAt: T0 - 9 * 3_600_000, activityAt: T0 - 9 * 3_600_000, updatedAt: T0 - 8 * 3_600_000, statusUpdatedAt: T0 - 8 * 3_600_000 };
    const mkSide = (text: string, status: string, updatedAt: number) => ({
      qyx_log: [note],
      qyx_dice: ['x'],
      qyx_enough: day(TODAY, [{ id: 'task_i1', text, done: status === 'completed', status, updatedAt, subs: [], v5IdeaId: idea.id }, blank('task_i2'), blank('task_i3')]),
      qyx_ideas_v5: { schema: 2, items: [idea], links: [], events: [], tasks: [] },
    });
    const { c, ds } = await focused(mkSide('合成事项 旧', 'incomplete', T0 - 8 * 3_600_000), mkSide('合成想法 新', 'completed', T0 - 300_000));
    expect(ds.length, formatDiffs(ds)).toBe(0);
    expect(c.oracle.qyx_ideas_v5.items[0]).toMatchObject({ title: '合成想法 新', status: 'completed', statusUpdatedAt: T0 - 300_000 });
  }, 120_000);

  it('today mirror ignores a removed (removedAt) v5 task and a removed idea (legacy task()/item() skip them)', async () => {
    const note = rec('rec5_focusrm', T0 - 9 * 3_600_000, '合成记录 已删', { submissionId: 'focusrm' });
    const plan = { id: 'plan_focusrm01', recordId: note.id, text: '合成清单 已删', done: false, scheduledDate: TODAY, order: 0, createdAt: T0 - 9 * 3_600_000, updatedAt: T0 - 8 * 3_600_000, removedAt: T0 - 7 * 3_600_000 };
    const idea = { id: 'idea_focusrm', title: '合成想法 已删', icon: 'star', status: 'open', rootRecordId: note.id, createdAt: T0 - 9 * 3_600_000, activityAt: T0 - 9 * 3_600_000, updatedAt: T0 - 8 * 3_600_000, statusUpdatedAt: T0 - 8 * 3_600_000, removedAt: T0 - 7 * 3_600_000 };
    const mkSide = (text: string, status: string, updatedAt: number) => ({
      qyx_log: [note], qyx_dice: ['x'],
      qyx_enough: day(TODAY, [
        { id: 'task_rm1', text, done: status === 'completed', status, updatedAt, subs: [], v5TaskId: plan.id },
        { id: 'task_rm2', text, done: status === 'completed', status, updatedAt, subs: [], v5IdeaId: idea.id },
        blank('task_rm3')]),
      qyx_ideas_v5: { schema: 2, items: [idea], links: [], events: [], tasks: [plan] },
    });
    const A = mkSide('合成事项 旧', 'incomplete', T0 - 8 * 3_600_000);
    const B = mkSide('合成事项 新', 'completed', T0 - 600_000);
    // local row has no mirror pointers yet; only the remote knows them
    A.qyx_enough.items.forEach((it: any) => { delete it.v5TaskId; delete it.v5IdeaId; });
    const { c, ds } = await focused(A, B);
    expect(c.errors).toEqual([]);
    expect(c.oracle.qyx_ideas_v5.tasks[0].text).toBe('合成清单 已删'); // legacy: removed task untouched
    expect(c.oracle.qyx_ideas_v5.items[0].title).toBe('合成想法 已删'); // legacy: removed idea untouched
    expect(ds.length, formatDiffs(ds)).toBe(0);
  }, 120_000);

  // legacy re-runs mergeState(read(LS), state) after mutating the idea in place; when idea.updatedAt does not move
  // (remote row is newer than statusUpdatedAt but not newer than idea.updatedAt) the equal-updatedAt tie-break is
  // JSON.stringify(x) > JSON.stringify(old), so legacy may keep the pre-mutation copy.
  it.each([
    ['remote text sorts BEFORE the old title', '合成事项 新', '合成想法 旧'],
    ['remote text sorts AFTER the old title', '合成想法 新', '合成事项 旧'],
  ])('today mirror of an idea whose updatedAt >= remote row updatedAt: %s', async (_name, remoteText, oldTitle) => {
    const note = rec('rec5_focustie', T0 - 9 * 3_600_000, '合成记录 平局', { submissionId: 'focustie' });
    const idea = { id: 'idea_focustie', title: oldTitle, icon: 'star', status: 'open', rootRecordId: note.id, createdAt: T0 - 9 * 3_600_000, activityAt: T0 - 9 * 3_600_000, updatedAt: T0 - 60_000, statusUpdatedAt: T0 - 8 * 3_600_000 };
    const mkSide = (text: string, status: string, updatedAt: number) => ({
      qyx_log: [note], qyx_dice: ['x'],
      qyx_enough: day(TODAY, [{ id: 'task_tie1', text, done: status === 'completed', status, updatedAt, subs: [], v5IdeaId: idea.id }, blank('task_tie2'), blank('task_tie3')]),
      qyx_ideas_v5: { schema: 2, items: [idea], links: [], events: [], tasks: [] },
    });
    const { c, ds } = await focused(mkSide('合成事项 旧', 'incomplete', T0 - 8 * 3_600_000), mkSide(remoteText, 'completed', T0 - 600_000));
    expect(c.errors).toEqual([]);
    expect(ds.length, `legacy idea=${short(c.oracle.qyx_ideas_v5.items[0])}\n${formatDiffs(ds)}`).toBe(0);
  }, 120_000);

  it('enough day rollover: device last opened yesterday keeps its rows as "prev" and takes remote text for today', async () => {
    const yItems = [
      { id: 'task_y1', text: '合成事项 昨一', done: true, status: 'completed', updatedAt: T0 - 20 * 3_600_000, subs: [{ text: '合成小项 1', done: false, status: 'incomplete', updatedAt: 0 }] },
      { id: 'task_y2', text: '合成事项 昨二', done: false, status: 'incomplete', updatedAt: T0 - 21 * 3_600_000, subs: [] },
      blank('task_y3'),
    ];
    const A = { qyx_log: [rec('rec_r1', T0 - 20 * 3_600_000, '合成记录 昨')], qyx_enough: day(YESTERDAY, yItems), qyx_dice: ['合成骰子 1'] };
    const B = {
      qyx_enough: day(TODAY, [{ id: 'task_t1', text: '合成事项 今一', done: false, status: 'incomplete', updatedAt: T0 - 3_600_000, subs: [] }, blank('task_t2'), blank('task_t3')]),
      qyx_enough_prev: day(YESTERDAY, [{ ...yItems[0], status: 'incomplete', done: false, updatedAt: T0 - 19 * 3_600_000 }, yItems[1], blank('task_y3')]),
      qyx_dice: ['合成骰子 1'],
    };
    const { c, ds } = await focused(A, B);
    expect(c.errors).toEqual([]);
    expect(ds.length, formatDiffs(ds)).toBe(0);
    expect(c.normA.qyx_enough.d).toBe(TODAY); // legacy boot rolled the day
    expect(c.normA.qyx_enough_prev.d).toBe(YESTERDAY);
    expect(c.oracle.qyx_enough.items[0]).toMatchObject({ id: 'task_t1', text: '合成事项 今一' });
    expect(c.oracle.qyx_enough_prev.d).toBe(YESTERDAY);
  }, 120_000);

  it('remote enough from a stale day is ignored for today but merged into prev by freshness', async () => {
    const mk = (id: string, text: string, u: number) => ({ id, text, done: false, status: 'incomplete', updatedAt: u, subs: [] });
    const A = { qyx_dice: ['合成骰子 1'], qyx_enough: day(TODAY, [mk('task_a1', '合成事项 甲', T0 - 3600_000), blank('task_a2'), blank('task_a3')]), qyx_enough_prev: day(YESTERDAY, [mk('task_p1', '合成事项 昨甲', T0 - 20 * 3600_000), blank('task_p2'), blank('task_p3')]) };
    const B = { qyx_dice: ['合成骰子 1'], qyx_enough: day(YESTERDAY, [mk('task_b1', '合成事项 乙', T0 - 3600_000), blank('task_b2'), blank('task_b3')]), qyx_enough_prev: day(YESTERDAY, [mk('task_p1', '合成事项 昨甲', T0 - 10 * 3600_000), mk('task_p9', '合成事项 昨新', T0 - 9 * 3600_000), blank('task_p3')]) };
    const { ds, c } = await focused(A, B);
    expect(ds.length, formatDiffs(ds)).toBe(0);
    expect(c.oracle.qyx_enough.items[0].id).toBe('task_a1');
  }, 120_000);

  it('same-day duplicate done entries across devices are deduped and buried identically', async () => {
    const t = T0 - 4 * 3_600_000;
    const mk = (id: string, dt: number) => ({ id, t: t + dt, updatedAt: t + dt, type: 'done', text: '合成小项 1', mood: null, src: '三件·小项', q: null });
    const { c, ds } = await focused({ qyx_log: [mk('rec_d1', 0)], qyx_dice: ['x'] }, { qyx_log: [mk('rec_d2', 7000)], qyx_dice: ['x'] });
    expect(ds.length, formatDiffs(ds)).toBe(0);
    expect(c.oracle.qyx_log.map((e: any) => e.id)).toEqual(['rec_d1']);
    expect(c.parity.backup.qyx_dead.map(deadKey)).toContain(`log${SEP}rec_d2`);
  }, 120_000);

  it('goal cap of 12 per month and month-goal merge by text', async () => {
    const goal = (i: number) => ({ id: `goal_cap${i}`, text: `合成目标 ${i}`, kind: 'goal', done: false, splits: [], hist: [] });
    const A = { qyx_dice: ['x'], qyx_months: { '2026-10': Array.from({ length: 9 }, (_, i) => goal(i)) } };
    const B = { qyx_dice: ['x'], qyx_months: { '2026-10': [goal(2), ...Array.from({ length: 6 }, (_, i) => goal(20 + i))] } };
    const { c, ds } = await focused(A, B);
    expect(ds.length, formatDiffs(ds)).toBe(0);
    expect(c.oracle.qyx_months['2026-10'].length).toBe(12);
  }, 120_000);

  it('tombstone list trimming (>1200 entries keeps the newest 250 per scope) matches legacy exactly, including order', async () => {
    const mk = (s: string, n: number, base: number) => Array.from({ length: n }, (_, i) => ({ s, v: `${s}-${base + i}`, t: T0 - (n - i) * 1000 - base }));
    const A = { qyx_dice: ['x'], qyx_dead: [...mk('log', 700, 0), ...mk('opt', 300, 0)] };
    const B = { qyx_dice: ['x'], qyx_dead: [...mk('dice', 400, 0), ...mk('log', 100, 5000), ...mk('opt', 20, 9000)] };
    const { c, ds } = await focused(A, B);
    expect(c.errors).toEqual([]);
    expect(ds.length, formatDiffs(ds)).toBe(0);
    const exact = diffPaths(c.oracle.qyx_dead, c.parity.backup.qyx_dead);
    expect(exact.length, formatDiffs(exact)).toBe(0);
    expect(c.oracle.qyx_dead.length).toBeLessThanOrEqual(750);
    expect(c.oracle.qyx_dead.length).toBeGreaterThan(300);
  }, 120_000);

  it('null remote is a no-op in both implementations', async () => {
    const A = { qyx_dice: ['x'], qyx_log: [rec('rec_n1', T0 - 3600_000, '合成记录 空')] };
    const na = await legacyCall({ local: A, now: NOW, fn: collect });
    const lm = await legacyMerge({ local: A, cloud: null, now: NOW });
    expect(lm.changed).toBe(false);
    const mine = mergeSnapshots(clone(na.result), null, mkClock(NOW), { filterLocalTombstones: false, strictIdeaMirror: false });
    expect(mine.changed).toBe(false);
    const known = new Set<string>();
    const ds = diffPaths(maskBackup(lm.backup, known), maskBackup(buildBackup(mine.snapshot, lm.backup._ver, new Date(0)), known));
    expect(ds.length, formatDiffs(ds)).toBe(0);
  }, 120_000);

  it('a device that never saved qyx_dice has the built-in default pool in memory (legacy merges it in)', async () => {
    const { c, ds } = await focused({ qyx_log: [rec('rec_nd', T0 - 3600_000, '合成记录 无骰子')] }, { qyx_dice: ['合成骰子 远端'] });
    expect(c.normA.qyx_dice).toBeNull(); // collectBackup of a never-saved pool
    expect(c.oracle.qyx_dice).toContain('合成骰子 远端');
    expect(ds.length, `legacy dice=${short(c.oracle.qyx_dice)}\n${formatDiffs(ds)}`).toBe(0);
  }, 120_000);
});

describe('coverage sanity (the generator must actually exercise the merge, or "all green" means nothing)', () => {
  it('seeds hit the interesting paths; the comparator and the two modes are not vacuous', async () => {
    const st: Record<string, number> = {};
    const bump = (k: string, n = 1) => (st[k] = (st[k] || 0) + n);
    for (const seed of SEEDS) {
      const c = await getSeed(seed);
      const O = c.oracle;
      for (const f of c.features) bump('feat:' + f);
      if (diffPaths(c.parity.backup, c.fixed.backup).length) bump('fixed!=parity');
      if (diffPaths(maskBackup(c.normA, c.known), maskBackup(O, c.known)).length) bump('merge!=normA');
      const deadIn = new Set([...(c.normA.qyx_dead || []), ...(c.remote.qyx_dead || [])].map(deadKey));
      bump('newDead', (O.qyx_dead || []).filter((d: any) => !deadIn.has(deadKey(d))).length);
      bump('logGrew', (O.qyx_log || []).length - (c.normA.qyx_log || []).length);
      bump('benchNonEmpty', (O.qyx_bench || []).length > 0 ? 1 : 0);
      bump('months12', Object.values(O.qyx_months || {}).some((m: any) => m.length >= 12) ? 1 : 0);
      bump('enoughSameDay', c.remote.qyx_enough?.d === TODAY && c.normA.qyx_enough?.d === TODAY ? 1 : 0);
      bump('rules30', (O.qyx_rules || []).length >= 30 ? 1 : 0);
      bump('ongoing10', (O.qyx_ongoing || []).length >= 10 ? 1 : 0);
      // a deliberately wrong "implementation" must be caught by the comparator: oracle vs fixed output differs wherever tombstones matter
      if (c.fixed.backup.qyx_log.length !== c.parity.backup.qyx_log.length) bump('tombstone-removed-local-log-rows');
    }
    for (const kind of ['swap', 'again', 'nextday'] as Kind[]) {
      for (const seed of SEEDS) {
        const c = await getSeed(seed, kind);
        bump(`${kind}:changed-false`, c.oracleChanged ? 0 : 1);
      }
    }
    if (process.env.MD_DEBUG) console.log(JSON.stringify(st, null, 1));
    if (SEEDS.length >= 60) {
      const scale = SEEDS.length / 120;
      expect(st['fixed!=parity'], 'fixed mode must differ from parity somewhere').toBeGreaterThan(10 * scale);
      expect(st['tombstone-removed-local-log-rows']).toBeGreaterThan(3 * scale);
      expect(st['feat:legacy-no-id']).toBeGreaterThan(10 * scale);
      expect(st['feat:done-dup-base']).toBeGreaterThan(10 * scale);
      expect(st.newDead, 'done-dedupe must bury something').toBeGreaterThan(5 * scale);
      expect(st.benchNonEmpty).toBeGreaterThan(10 * scale);
      expect(st.months12).toBeGreaterThan(0);
      expect(st.enoughSameDay).toBeGreaterThan(20 * scale);
      expect(st.rules30).toBeGreaterThan(0);
      expect(st.ongoing10).toBeGreaterThan(0);
      expect(st['feat:mirror-task'] + st['feat:mirror-idea']).toBeGreaterThan(5 * scale);
      expect(st['feat:raw-remote']).toBeGreaterThan(10 * scale);
      expect(st['again:changed-false'], 'second merge should be a no-op for most seeds, so the changed flag is tested both ways').toBeGreaterThan(20 * scale);
    }
    // comparator self-check
    const o = maskBackup((await getSeed(SEEDS[0])).oracle, new Set());
    const tweaked = clone(o);
    tweaked.qyx_log[0].text += 'x';
    expect(diffPaths(o, tweaked)).toEqual([{ path: 'qyx_log[0].text', a: o.qyx_log[0].text, b: tweaked.qyx_log[0].text }]);
    tweaked.qyx_log.reverse();
    expect(diffPaths(o, tweaked).length).toBeGreaterThan(0); // array order matters
  }, 600_000);
});

describe.skipIf(!process.env.MD_DEBUG)('debug helpers (MD_DEBUG=1)', () => {
  it('which keys does a merge change for identical/stale-remote seeds', async () => {
    for (const seed of SEEDS) {
      const c = await getSeed(seed);
      if (!c.features.some((f) => f === 'identical' || f === 'stale-remote')) continue;
      const keysChanged = Object.keys(c.oracle).filter((k) => k !== '_exported' && diffPaths(maskBackup({ [k]: c.normA[k] }, c.known), maskBackup({ [k]: c.oracle[k] }, c.known)).length);
      console.log(seed, c.features.filter((f) => f === 'identical' || f === 'stale-remote'), 'legacy changed', c.oracleChanged, 'ts changed', c.parity.changed, 'keys differing from normA:', keysChanged.join(','));
    }
  }, 600_000);
});
