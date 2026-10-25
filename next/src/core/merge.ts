/*
 * Merge engine: fold a remote snapshot (Gist / history revision / sibling gist)
 * into the local snapshot. Pure — no globals, no storage — so it can be tested
 * against the legacy implementation (tools/legacy-oracle.mjs).
 *
 * Semantics are a faithful port of legacy `mergeAll` (index.html 5.1.3.1) plus the
 * v5 overlay wrapper (assets/v5.js). Deliberate deviations are opt-in through
 * MergeOptions and listed in docs/DATA-CONTRACT.md.
 */
import {
  BACKUP_KEYS, DAILY_KEY, IDEAS_KEY,
  type BackupFile, type DailyReview, type EnoughDay, type EnoughItem, type EnoughSub,
  type IdeasState, type LogEntry, type Snapshot, type Tombstone,
} from './types';
import { clone, dayKey, stableId, type Clock } from './util';

export interface MergeOptions {
  /**
   * Legacy only filtered the *remote* side against tombstones for most scopes, so a
   * deletion made on device A never removed the copy on device B (B kept it and kept
   * re-pushing it). With this on, tombstones also remove local copies. Safe because
   * every add path unburies its value first.
   */
  filterLocalTombstones: boolean;
  /**
   * When a newer Today row updates the idea it mirrors, legacy kept the idea's
   * updatedAt if it was already >= the row's, so the follow-up merge could pick the
   * stale copy by JSON tie-break (text-dependent). With this on, the updated idea's
   * updatedAt strictly increases, so the applied status always wins.
   */
  strictIdeaMirror: boolean;
}
export const DEFAULT_MERGE_OPTIONS: MergeOptions = { filterLocalTombstones: true, strictIdeaMirror: true };
/** Exactly the 5.1.3.1 behaviour; used by parity tests. */
export const LEGACY_MERGE_OPTIONS: MergeOptions = { filterLocalTombstones: false, strictIdeaMirror: false };

/** Legacy in-memory default for a device that never saved its dice pool. */
export const DEFAULT_DICE = [
  '去洗头', '出门走十分钟，不带目的', '倒一杯水，站到窗边喝完', '把手机放到另一个房间',
  '只做眼前这件事的前五分钟', '拍一张此刻眼前的东西', '把桌面上最碍眼的一样东西归位', '朗读一段粤语，就一段',
];

export interface MergeResult {
  snapshot: Snapshot;
  changed: boolean;
}

const MONTH_MAX = 12;
const MAX_OPTS = 9;
const DEAD_MAX = 1200;
const DEAD_KEEP_PER_SCOPE = 250;

/* ---------------- tombstones ---------------- */

export class Tombstones {
  list: Tombstone[];
  constructor(list: Tombstone[] | null | undefined) {
    this.list = Array.isArray(list) ? list : [];
  }
  has(scope: string, v: unknown): boolean {
    return this.list.some((d) => d.s === scope && d.v === v);
  }
  add(d: Tombstone) {
    if (!this.has(d.s, d.v)) this.list.push(d);
  }
  bury(scope: string, v: string | number, t: number) {
    this.add({ s: scope, v, t });
    this.trim();
  }
  unbury(scope: string, v: unknown) {
    this.list = this.list.filter((d) => !(d.s === scope && d.v === v));
  }
  trim() {
    if (this.list.length <= DEAD_MAX) return;
    const keep = new Map<string, Tombstone[]>();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i].s;
      const arr = keep.get(s) || [];
      if (arr.length < DEAD_KEEP_PER_SCOPE) {
        arr.push(this.list[i]);
        keep.set(s, arr);
      }
    }
    this.list = [...keep.values()].flat().sort((a, b) => a.t - b.t);
  }
}

/* ---------------- log helpers ---------------- */

export const logKey = (e: LogEntry): string => (e.id as string) || `${e.t}|${e.type}|${e.text}`;
export const doneLogIdentity = (e: LogEntry) => `${dayKey(e.t)}|${e.type}|${e.src || ''}|${e.text}`;

/** Same ms + type + text from different devices = one record (pre-id era duplicates). */
function legacyDedupeByContent(arr: LogEntry[]): LogEntry[] {
  const m = new Map<string, LogEntry>();
  arr.forEach((e) => {
    const k = (e.t || 0) + '|' + (e.type || '') + '|' + (e.text || '');
    const old = m.get(k);
    if (!old) { m.set(k, e); return; }
    const score = (x: LogEntry) => (x.id ? 2 : 0) + ((x.updatedAt || x.t || 0) > (old.updatedAt || old.t || 0) ? 1 : 0);
    if (score(e) > score(old)) m.set(k, e);
  });
  const origins = new Map<string, LogEntry>();
  const out: LogEntry[] = [];
  [...m.values()].forEach((e) => {
    const k = (e.t || 0) + '|' + (e.type || '');
    const old = origins.get(k);
    if (!old) { origins.set(k, e); return; }
    const edited = (e.updatedAt || e.t || 0) > (e.t || 0) || (old.updatedAt || old.t || 0) > (old.t || 0);
    if (!edited) { out.push(e); return; }
    if ((e.updatedAt || e.t || 0) > (old.updatedAt || old.t || 0)) origins.set(k, e);
  });
  return [...origins.values(), ...out].sort((a, b) => (a.t || 0) - (b.t || 0));
}

/** v5 wrapper: records with a stable submission identity skip content dedupe. */
export function dedupeByContent(rows: LogEntry[]): LogEntry[] {
  const stable = rows.filter((r) => r.submissionId || r.v5StableId);
  const legacy = rows.filter((r) => !r.submissionId && !r.v5StableId);
  return [...legacyDedupeByContent(legacy), ...stable].sort((a, b) => a.t - b.t);
}

function dedupeDoneLogEntries(entries: LogEntry[], dead: Tombstones, clock: Clock): LogEntry[] {
  const seen = new Set<string>();
  return [...entries].sort((a, b) => a.t - b.t).filter((e) => {
    if (e.type !== 'done') return true;
    const key = doneLogIdentity(e);
    if (!seen.has(key)) { seen.add(key); return true; }
    dead.bury('log', logKey(e), clock.now());
    return false;
  });
}

/* ---------------- today (enough) helpers ---------------- */

const ENOUGH_STATUSES = ['completed', 'incomplete', 'expired', 'deleted'];
const ENOUGH_SUB_STATUSES = ['completed', 'incomplete', 'expired'];

export function enoughStatus(item: any): EnoughItem['status'] {
  return item && ENOUGH_STATUSES.includes(item.status) ? item.status : item && item.done ? 'completed' : 'incomplete';
}
export function enoughSubStatus(sub: any): EnoughSub['status'] {
  return sub && ENOUGH_SUB_STATUSES.includes(sub.status) ? sub.status : sub && sub.done ? 'completed' : 'incomplete';
}
export function blankEnoughItem(clock: Clock): EnoughItem {
  return { id: stableId('task_', clock.nonce()), text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] };
}
export function normalizeEnoughSub(sub: any): EnoughSub {
  if (typeof sub === 'string') return { text: sub, done: false, status: 'incomplete', updatedAt: 0 };
  const status = enoughSubStatus(sub);
  const out: EnoughSub = { text: (sub && sub.text) || '', done: status === 'completed', status, updatedAt: Number(sub && sub.updatedAt) || 0 };
  const count = Math.max(0, Math.floor(+(sub && sub.c) || 0));
  if (status === 'completed' && count > 0) out.c = count;
  return out;
}
/** Mutates and returns item (legacy semantics). */
export function normalizeEnoughItem(item: any, clock: Clock): EnoughItem {
  item = item || blankEnoughItem(clock);
  if (!item.id) item.id = stableId('task_', clock.nonce());
  item.text = item.text || '';
  item.subs = (item.subs || []).map(normalizeEnoughSub);
  item.status = enoughStatus(item);
  item.done = item.status === 'completed';
  item.updatedAt = Number(item.updatedAt) || 0;
  return item;
}
export function syncParentFromSubs(item: EnoughItem) {
  if (!(item.subs || []).length) return;
  item.status = item.subs.every((s) => s.status === 'completed') ? 'completed' : 'incomplete';
  item.done = item.status === 'completed';
  item.updatedAt = Math.max(item.updatedAt || 0, ...item.subs.map((s) => s.updatedAt || 0));
}
const itemFreshness = (item: any) =>
  Math.max(Number(item && item.updatedAt) || 0, ...((item && item.subs) || []).map((s: any) => Number(s && s.updatedAt) || 0));
const snapshotFreshness = (s: any) => Math.max(0, ...((s && s.items) || []).map(itemFreshness));
const cloneEnoughItem = (item: any, clock: Clock) =>
  normalizeEnoughItem(Object.assign({}, item || {}, { subs: ((item && item.subs) || []).map((s: any) => Object.assign({}, s)) }), clock);

function mergeEnoughSnapshot(local: EnoughDay | null | undefined, remote: EnoughDay | null | undefined, dead: Tombstones, clock: Clock): EnoughDay | null {
  if (!local) return remote ? { d: remote.d, items: (remote.items || []).map((i) => cloneEnoughItem(i, clock)) } : null;
  if (!remote) return { d: local.d, items: (local.items || []).map((i) => cloneEnoughItem(i, clock)) };
  if (local.d !== remote.d) {
    const newer = String(remote.d || '') > String(local.d || '') ? remote : local;
    return { d: newer.d, items: (newer.items || []).map((i) => cloneEnoughItem(i, clock)) };
  }
  const remoteIsNewer = snapshotFreshness(remote) > snapshotFreshness(local);
  const base = remoteIsNewer ? remote : local;
  const other = remoteIsNewer ? local : remote;
  const remaining = (other.items || []).map((i) => cloneEnoughItem(i, clock));
  const merged = (base.items || []).map((raw, index) => {
    const first = cloneEnoughItem(raw, clock);
    let at = remaining.findIndex((x) => first.id && x.id === first.id);
    if (at < 0) at = remaining.findIndex((x) => x.text && x.text === first.text);
    if (at < 0 && remaining[index]) at = index;
    if (at < 0) return first;
    const second = remaining.splice(at, 1)[0];
    const winner = itemFreshness(second) > itemFreshness(first) ? second : first;
    const loser = winner === first ? second : first;
    const out = cloneEnoughItem(winner, clock);
    const scope = 'esub:' + base.d;
    const subMap = new Map<string, any>((out.subs || []).filter((s) => !dead.has(scope, s.text)).map((s) => [s.text, s]));
    (loser.subs || []).forEach((s) => {
      if (dead.has(scope, s.text)) return;
      const old = subMap.get(s.text);
      if (!old) subMap.set(s.text, Object.assign({}, s));
      else if ((s.updatedAt || 0) > (old.updatedAt || 0)) subMap.set(s.text, Object.assign({}, s));
    });
    out.subs = [...subMap.values()].map(normalizeEnoughSub);
    if (out.subs.length) syncParentFromSubs(out);
    return out;
  });
  remaining.forEach((item) => { if (merged.length < 3) merged.push(item); });
  return { d: base.d, items: merged.slice(0, 3) };
}

/* ---------------- months ---------------- */

/** Legacy normMonths: fix duplicate ids inside a month, normalise shape. Mutates. */
export function normMonths(months: Record<string, any[]>, clock: Clock) {
  Object.keys(months).forEach((ym) => {
    const seenIds = new Set<string>();
    (months[ym] || []).forEach((a) => {
      const key = String(a.id);
      if (a.id && seenIds.has(key)) a.id = stableId('goal_', ym + '|' + a.text + '|' + clock.nonce());
      else if (a.id) seenIds.add(key);
    });
    (months[ym] || []).forEach((a) => {
      a.kind = a.kind === 'watch' ? 'watch' : 'goal';
      a.splits = (a.splits || []).map((x: any) => (typeof x === 'string' ? { text: x, done: false } : x));
      a.hist = a.hist || [];
      a.done = a.kind === 'watch' ? false : !!a.done;
      if (a.kind === 'watch') a.splits.forEach((x: any) => { x.done = false; });
    });
  });
}

/* ---------------- v5 ideas ---------------- */

const SAFE_ID = /^[-\w:.]+$/;
export const emptyIdeas = (): IdeasState => ({ schema: 2, items: [], links: [], events: [], tasks: [] });

export function mergeIdeas(a: Partial<IdeasState> | null | undefined, b: Partial<IdeasState> | null | undefined): IdeasState {
  const out = emptyIdeas();
  a = a || {};
  b = b || {};
  for (const key of ['items', 'links', 'events', 'tasks'] as const) {
    const m = new Map<string, any>();
    const rows = [...(Array.isArray(a[key]) ? (a[key] as any[]) : []), ...(Array.isArray(b[key]) ? (b[key] as any[]) : [])];
    for (const x of rows) {
      if (!x || typeof x.id !== 'string' || !SAFE_ID.test(x.id)) continue;
      if (['recordId', 'ideaId', 'rootRecordId'].some((k) => x[k] && !SAFE_ID.test(x[k]))) continue;
      const old = m.get(x.id);
      if (!old || (x.updatedAt || 0) > (old.updatedAt || 0) ||
        ((x.updatedAt || 0) === (old.updatedAt || 0) && JSON.stringify(x) > JSON.stringify(old))) m.set(x.id, x);
    }
    (out as any)[key] = [...m.values()].sort((x, y) => x.id.localeCompare(y.id));
  }
  return out;
}

export function mergeDaily(left: unknown, right: unknown): DailyReview[] {
  const rows = new Map<string, DailyReview>();
  for (const r of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])] as any[]) {
    if (!r || typeof r.id !== 'string' || !SAFE_ID.test(r.id) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Array.isArray(r.paragraphs)) continue;
    const old = rows.get(r.id);
    if (!old || (r.t || 0) > (old.t || 0)) rows.set(r.id, r);
  }
  return [...rows.values()].sort((a, b) => (b.t || 0) - (a.t || 0) || a.id.localeCompare(b.id));
}

/* ---------------- main merge ---------------- */

const fingerprint = (s: Snapshot) =>
  JSON.stringify([...BACKUP_KEYS, IDEAS_KEY, DAILY_KEY].map((k) => (s as any)[k] ?? null));

export function mergeSnapshots(
  localIn: Snapshot,
  remoteIn: BackupFile | null | undefined,
  clock: Clock,
  options: MergeOptions = DEFAULT_MERGE_OPTIONS,
): MergeResult {
  if (!remoteIn || typeof remoteIn !== 'object') return { snapshot: localIn, changed: false };
  const before = fingerprint(localIn);
  const L: any = clone(localIn);
  const o: any = clone(remoteIn);
  const fix = options.filterLocalTombstones;
  const now = clock.now();
  const today = dayKey(now);

  // Tombstones first so every later filter sees the union.
  const dead = new Tombstones(L.qyx_dead);
  (o.qyx_dead || []).forEach((d: Tombstone) => dead.add(d));
  dead.trim();
  const isDead = (s: string, v: unknown) => dead.has(s, v);

  // Opts history: by t|text.
  const ohKey = (x: any) => (x.t || 0) + '|' + (x.text || '');
  const ohMap = new Map<string, any>((L.qyx_opts_hist || []).filter((x: any) => !isDead('ohist', ohKey(x))).map((x: any) => [ohKey(x), x]));
  (o.qyx_opts_hist || []).forEach((x: any) => { const k = ohKey(x); if (!isDead('ohist', k) && !ohMap.has(k)) ohMap.set(k, x); });
  L.qyx_opts_hist = [...ohMap.values()].sort((a, b) => a.t - b.t).slice(-800);

  // Routines and drawers: by id, newer updatedAt wins.
  const mergeById = (local: any[], remote: any[], scope: string) => {
    const map = new Map<any, any>(local.filter((x) => !isDead(scope, x.id)).map((x) => [x.id, x]));
    (remote || []).forEach((x) => {
      if (!x || !x.id || isDead(scope, x.id)) return;
      const old = map.get(x.id);
      if (!old || (x.updatedAt || 0) > (old.updatedAt || 0)) map.set(x.id, x);
    });
    return [...map.values()].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0) || String(a.id).localeCompare(String(b.id)));
  };
  L.qyx_routines = mergeById(L.qyx_routines || [], o.qyx_routines, 'routine');
  if (L.qyx_drawers) L.qyx_drawers = mergeById(L.qyx_drawers, o.qyx_drawers, 'drawer');
  else if (o.qyx_drawers) L.qyx_drawers = (o.qyx_drawers || []).filter((x: any) => x && x.id && !isDead('drawer', x.id));

  // Tags and tag relations.
  const tagMap = new Map<string, any>((L.qyx_tags || []).map((t: any) => [t.id, t]));
  (o.qyx_tags || []).forEach((t: any) => {
    if (isDead('tag', t.id)) return;
    const old = tagMap.get(t.id);
    if (!old || (t.updated_time || 0) > (old.updated_time || 0)) tagMap.set(t.id, t);
  });
  L.qyx_tags = [...tagMap.values()].filter((t) => !isDead('tag', t.id));
  const mergeRelations = (local: any, remote: any) => {
    const out = Object.assign({}, local || {});
    Object.keys(remote || {}).forEach((k) => {
      out[k] = [...new Set([...(out[k] || []), ...(remote[k] || [])])].filter((id) => tagMap.has(id) && !isDead('tag', id));
    });
    return out;
  };
  L.qyx_record_tags = mergeRelations(L.qyx_record_tags, o.qyx_record_tags);
  L.qyx_goal_tags = mergeRelations(L.qyx_goal_tags, o.qyx_goal_tags);
  L.qyx_task_tags = mergeRelations(L.qyx_task_tags, o.qyx_task_tags);
  L.qyx_task_goals = Object.assign({}, o.qyx_task_goals || {}, L.qyx_task_goals || {});

  // Log: by logKey, newer (updatedAt||t) wins, then content dedupe.
  let localLog: LogEntry[] = L.qyx_log || [];
  if (fix) localLog = localLog.filter((e) => !isDead('log', logKey(e)));
  const logMap = new Map<string, LogEntry>(localLog.map((e) => [logKey(e), e]));
  (o.qyx_log || []).forEach((e: LogEntry) => {
    const k = logKey(e);
    const cur = logMap.get(k);
    if (!isDead('log', k) && (!cur || (e.updatedAt || e.t || 0) > (cur.updatedAt || cur.t || 0))) logMap.set(k, e);
  });
  L.qyx_log = dedupeDoneLogEntries(dedupeByContent([...logMap.values()]), dead, clock);

  // Voice polish history.
  const phKey = (x: any) => (x.t || 0) + '|' + (x.original || '') + '|' + (x.polished || '');
  const phMap = new Map<string, any>((L.qyx_polish_history || []).map((x: any) => [phKey(x), x]));
  (o.qyx_polish_history || []).forEach((x: any) => { if (!phMap.has(phKey(x))) phMap.set(phKey(x), x); });
  L.qyx_polish_history = [...phMap.values()].sort((a, b) => a.t - b.t);

  // Bottles: by id, followups unioned.
  const bMap = new Map<any, any>((L.qyx_bottles || []).map((b: any) => [b.id, b]));
  (o.qyx_bottles || []).forEach((rb: any) => {
    const lb = bMap.get(rb.id);
    if (!lb) { bMap.set(rb.id, rb); return; }
    const fKey = (f: any) => f.t + '|' + f.text;
    const fMap = new Map<string, any>((lb.followups || []).map((f: any) => [fKey(f), f]));
    (rb.followups || []).forEach((f: any) => { if (!fMap.has(fKey(f))) fMap.set(fKey(f), f); });
    lb.followups = [...fMap.values()].sort((a, b) => a.t - b.t);
  });
  L.qyx_bottles = [...bMap.values()].sort((a, b) => a.t - b.t);

  // Ongoing ("定过的"): by id; tombstoned by text.
  let localOngoing: any[] = L.qyx_ongoing || [];
  if (fix) localOngoing = localOngoing.filter((x) => !isDead('ongoing', x.text));
  const oMap = new Map<any, any>(localOngoing.map((x) => [x.id, x]));
  (o.qyx_ongoing || []).forEach((x: any) => { if (!oMap.has(x.id) && !isDead('ongoing', x.text)) oMap.set(x.id, x); });
  L.qyx_ongoing = [...oMap.values()].sort((a, b) => b.t - a.t).slice(0, 10);

  // String pools.
  const unionStr = (local: string[] | null | undefined, remote: string[] | null | undefined, scope: string) => {
    const set = new Set<string>((local || []).filter((v) => !fix || !isDead(scope, v)));
    (remote || []).forEach((v) => { if (!isDead(scope, v)) set.add(v); });
    return [...set];
  };
  const mergedOpts = unionStr(L.qyx_opts, o.qyx_opts, 'opt');
  const mergedBench = unionStr(L.qyx_bench, o.qyx_bench, 'opt');
  L.qyx_opts = mergedOpts.slice(0, MAX_OPTS);
  L.qyx_bench = [...new Set([...mergedBench, ...mergedOpts.slice(MAX_OPTS)])];
  L.qyx_dice = unionStr(L.qyx_dice ?? DEFAULT_DICE, o.qyx_dice, 'dice');

  // Month goals: by month, by text; splits unioned, done ORed.
  const months: Record<string, any[]> = L.qyx_months || {};
  const normSp = (arr: any[]) => (arr || []).map((x) => (typeof x === 'string' ? { text: x, done: false } : x));
  if (fix) {
    Object.keys(months).forEach((ym) => {
      months[ym] = (months[ym] || []).filter((a) => !isDead('anchor:' + ym, a.text));
      months[ym].forEach((a) => { a.splits = normSp(a.splits).filter((x: any) => !isDead('split:' + a.text, x.text)); });
    });
  }
  const rm = o.qyx_months || {};
  Object.keys(rm).forEach((ym) => {
    if (!months[ym]) months[ym] = [];
    (rm[ym] || []).forEach((ra: any) => {
      if (isDead('anchor:' + ym, ra.text)) return;
      const la = months[ym].find((x) => x.text === ra.text);
      if (!la) {
        if (months[ym].length < MONTH_MAX) {
          ra.splits = normSp(ra.splits).filter((x: any) => !isDead('split:' + ra.text, x.text));
          ra.hist = ra.hist || [];
          months[ym].push(ra);
        }
        return;
      }
      const sm = new Map<string, any>(normSp(la.splits).map((x: any) => [x.text, x]));
      normSp(ra.splits).forEach((x: any) => {
        if (isDead('split:' + la.text, x.text)) return;
        if (sm.has(x.text)) sm.get(x.text).done = sm.get(x.text).done || x.done;
        else sm.set(x.text, x);
      });
      la.splits = [...sm.values()];
      la.done = la.done || !!ra.done;
      const hk = (h: any) => h.t + '|' + h.ev;
      const hm = new Map<string, any>((la.hist || []).map((h: any) => [hk(h), h]));
      (ra.hist || []).forEach((h: any) => { if (!hm.has(hk(h))) hm.set(hk(h), h); });
      la.hist = [...hm.values()].sort((x, y) => x.t - y.t);
    });
  });
  normMonths(months, clock);
  L.qyx_months = months;

  // Daily summaries: fill gaps only.
  const sums = L.qyx_sums || {};
  Object.keys(o.qyx_sums || {}).forEach((k) => { if (!sums[k]) sums[k] = o.qyx_sums[k]; });
  L.qyx_sums = sums;

  // Today's three.
  const re: EnoughDay | undefined = o.qyx_enough;
  let enough: EnoughDay | null = L.qyx_enough || null;
  if (re && re.d === today && enough && enough.d === today) {
    enough.items.forEach((it, i) => {
      const rit: any = (re.items || [])[i];
      if (!rit) return;
      normalizeEnoughItem(it, clock);
      normalizeEnoughItem(rit, clock);
      const localDeleted = enoughStatus(it) === 'deleted';
      if (!it.text.trim() && rit.text && !localDeleted && (it.updatedAt || 0) <= (rit.updatedAt || 0)) {
        it.text = rit.text;
        if (rit.id) it.id = rit.id;
      }
      const lu = it.updatedAt || 0, ru = rit.updatedAt || 0;
      it.status = enoughStatus(ru > lu ? rit : it);
      it.done = it.status === 'completed';
      it.updatedAt = Math.max(lu, ru);
      const scope = 'esub:' + enough!.d;
      const sm = new Map<string, any>((it.subs || []).map(normalizeEnoughSub).filter((x) => !isDead(scope, x.text)).map((x) => [x.text, x]));
      (rit.subs || []).map(normalizeEnoughSub).forEach((x: any) => {
        if (isDead(scope, x.text)) return;
        const local = sm.get(x.text);
        if (!local) { sm.set(x.text, x); return; }
        const winner = (x.updatedAt || 0) > (local.updatedAt || 0) ? x : local;
        local.status = enoughSubStatus(winner);
        local.done = local.status === 'completed';
        local.updatedAt = Math.max(local.updatedAt || 0, x.updatedAt || 0);
      });
      it.subs = [...sm.values()];
      syncParentFromSubs(it);
      if (rit.id && rit.id !== it.id) {
        L.qyx_task_tags[it.id] = [...new Set([...(L.qyx_task_tags[it.id] || []), ...(L.qyx_task_tags[rit.id] || [])])];
        if (!L.qyx_task_goals[it.id] && L.qyx_task_goals[rit.id]) L.qyx_task_goals[it.id] = L.qyx_task_goals[rit.id];
      }
    });
  } else if (re && re.d === today && (!enough || enough.d !== today)) {
    enough = re;
    enough.items = (enough.items || []).map((i) => normalizeEnoughItem(i, clock)).slice(0, 3);
    enough.items.forEach(syncParentFromSubs);
    while (enough.items.length < 3) enough.items.push(blankEnoughItem(clock));
  }
  L.qyx_enough = enough;

  // Yesterday's three + its summary.
  const mergedPrev = mergeEnoughSnapshot(L.qyx_enough_prev, o.qyx_enough_prev, dead, clock);
  if (mergedPrev) {
    L.qyx_enough_prev = mergedPrev;
    const oldSum = sums[mergedPrev.d];
    if (oldSum && oldSum.v2) {
      oldSum.three = mergedPrev.items.filter((i) => i.text && i.text.trim() && enoughStatus(i) !== 'deleted').map((i) => ({
        text: i.text, status: enoughStatus(i), done: enoughStatus(i) === 'completed',
        subs: (i.subs || []).filter((s) => s.text && s.text.trim()).map((s) => ({ text: s.text, status: enoughSubStatus(s), done: enoughSubStatus(s) === 'completed' })),
      }));
      const dayLog = (L.qyx_log as LogEntry[]).filter((e) => dayKey(e.t) === mergedPrev.d);
      oldSum.stats = {
        cut: dayLog.filter((e) => e.type === 'dice' || e.type === 'ai').length,
        notes: dayLog.filter((e) => e.type === 'note').length,
        done: dayLog.filter((e) => e.type === 'done').length,
      };
    }
  }

  // Habits: by id (name fallback), newer name wins, per-day max count.
  const habits: any[] = L.qyx_habits || [];
  (o.qyx_habits || []).forEach((rh: any) => {
    if (!rh || isDead('habit', rh.name)) return;
    let lh = habits.find((x) => String(x.id) === String(rh.id)) || habits.find((x) => x.name === rh.name);
    if (!lh) { if (habits.length < 3) habits.push(rh); return; }
    if ((rh.updatedAt || 0) > (lh.updatedAt || 0) && rh.name && !isDead('habit', rh.name)) {
      lh.name = rh.name;
      lh.updatedAt = rh.updatedAt;
    }
    lh.counts = lh.counts || {};
    Object.keys(rh.counts || {}).forEach((d) => { lh.counts[d] = Math.max(lh.counts[d] || 0, rh.counts[d]); });
  });
  L.qyx_habits = habits;

  // Bonus: same-day per slot.
  const rb = o.qyx_bonus;
  let bonus = L.qyx_bonus || null;
  if (rb && rb.d === today && bonus && bonus.d === today) {
    bonus.items.forEach((it: any, i: number) => {
      const rit = (rb.items || [])[i];
      if (!rit) return;
      if (!it.text.trim() && rit.text) it.text = rit.text;
      it.done = it.done || !!rit.done;
    });
  } else if (rb && rb.d === today && (!bonus || bonus.d !== today)) bonus = rb;
  L.qyx_bonus = bonus;
  if (o.qyx_bonus_prev && !L.qyx_bonus_prev) L.qyx_bonus_prev = o.qyx_bonus_prev;

  // Rules: by text.
  let rules: any[] = L.qyx_rules || [];
  if (fix) rules = rules.filter((r) => !isDead('rule', r.text));
  (o.qyx_rules || []).forEach((rr: any) => {
    if (isDead('rule', rr.text)) return;
    if (!rules.some((x) => x.text === rr.text)) rules.push(rr);
  });
  rules.sort((a, b) => b.t - a.t);
  L.qyx_rules = rules.slice(0, 30);

  // AI reviews: by t, newest 12.
  const normReview = (v: any): any[] => (!v ? [] : Array.isArray(v) ? v : v.text ? [{ t: v.t || 0, from: (v.t || 0) - 7 * 864e5, to: v.t || 0, text: v.text }] : []);
  const rv = new Map<number, any>();
  normReview(L.qyx_ai_review).concat(normReview(o.qyx_ai_review)).forEach((r) => { if (r && r.t && !rv.has(r.t)) rv.set(r.t, r); });
  L.qyx_ai_review = [...rv.values()].sort((a, b) => b.t - a.t).slice(0, 12);

  if (o.qyx_sit_reminder && !L.qyx_sit_reminder) L.qyx_sit_reminder = o.qyx_sit_reminder;
  L.qyx_dead = dead.list;

  // v5 overlay: ideas + daily reviews.
  let ideas = mergeIdeas(L[IDEAS_KEY] || emptyIdeas(), emptyIdeas());
  if (o[IDEAS_KEY]) ideas = mergeIdeas(ideas, o[IDEAS_KEY]);
  if (o[DAILY_KEY]) L[DAILY_KEY] = mergeDaily(L[DAILY_KEY] || [], o[DAILY_KEY]);

  // v5: a Today row mirrors a checklist task or an idea; carry newer remote state into it.
  if (re && re.d === today && enough && enough.d === re.d) {
    const beforeMirror = clone(ideas);
    let ideasChanged = false;
    (re.items || []).forEach((remote: any, i) => {
      const local: any = enough!.items[i];
      if (!remote || !local || String(local.id) !== String(remote.id)) return;
      if (remote.v5TaskId) {
        const plan = ideas.tasks.find((x) => x.id === remote.v5TaskId && !x.removedAt);
        if (!plan) return;
        if (local.v5TaskId !== plan.id) local.v5TaskId = plan.id;
        if ((remote.updatedAt || 0) > (plan.updatedAt || 0)) {
          plan.text = remote.text;
          plan.done = enoughStatus(remote) === 'completed';
          plan.updatedAt = remote.updatedAt;
          ideasChanged = true;
        }
      }
      if (remote.v5IdeaId) {
        const idea = ideas.items.find((x) => x.id === remote.v5IdeaId && !x.removedAt);
        if (!idea) return;
        if (local.v5IdeaId !== idea.id) local.v5IdeaId = idea.id;
        if ((remote.updatedAt || 0) > (idea.statusUpdatedAt || 0)) {
          idea.title = remote.text;
          idea.status = enoughStatus(remote) === 'completed' ? 'completed' : 'open';
          idea.statusUpdatedAt = remote.updatedAt;
          idea.updatedAt = options.strictIdeaMirror && (idea.updatedAt || 0) >= remote.updatedAt
            ? (idea.updatedAt || 0) + 1
            : Math.max(idea.updatedAt || 0, remote.updatedAt);
          ideasChanged = true;
        }
      }
    });
    // Legacy re-merged the mutated state onto the stored pre-mirror copy.
    if (ideasChanged) ideas = mergeIdeas(beforeMirror, ideas);
  }
  if (L[IDEAS_KEY] || o[IDEAS_KEY]) L[IDEAS_KEY] = ideas;

  const snapshot = L as Snapshot;
  return { snapshot, changed: fingerprint(snapshot) !== before };
}
