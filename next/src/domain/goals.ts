/*
 * 目标 page data: month goals (qyx_months), their splits / tags, AI splitting, habits.
 * OWNER: goals/sea agent. Ports legacy `monthAnchors` & friends (index.html l.2377-2650, 3355-3440).
 *
 * Differences from legacy that matter:
 *  - Nothing here runs implicitly. `ensureMonth` (the old `monthAnchors()` side effect:
 *    create this month, carry last month's 观察位 + their tags) is an explicit call; selectors
 *    (`monthGoals`, `goalCount`, …) are read-only.
 *  - Goals are addressed by id (always unique within a month after normMonths), splits by index.
 */
import { runAI, type AiOptions } from '../core/ai';
import type { EnoughDay, Habit, MonthGoal, Snapshot, Tombstone } from '../core/types';
import { dayKey, monthKey, stableId, type Clock } from '../core/util';
import { addLog, bury, ensureTagPath, parseTagPaths, unbury } from './shared';

export const MONTH_MAX = 12;
export const GOAL_MAX = 2;
export const SPLIT_AI_MAX = 8;
export const HABIT_MAX = 3;

/* ---------------- read-only selectors ---------------- */

export const isWatch = (a: { kind?: string } | null | undefined) => !!a && a.kind === 'watch';

export function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export const currentYm = (clock: { now(): number }) => monthKey(clock.now());

/** Goals of a month. Never creates the month. */
export function monthGoals(s: Snapshot, ym: string): MonthGoal[] {
  const list = s.qyx_months?.[ym];
  return Array.isArray(list) ? list : [];
}
export const goalCount = (list: MonthGoal[]) => list.filter((a) => !isWatch(a) && !a.done).length;
export const goalDoneCount = (list: MonthGoal[]) => list.filter((a) => !isWatch(a) && a.done).length;
export const watchCount = (list: MonthGoal[]) => list.filter(isWatch).length;

/** Display order (derived, never stored): goals in progress, done goals, then 观察位. Stable within a group. */
export function orderedGoals(list: MonthGoal[]): MonthGoal[] {
  const rank = (a: MonthGoal) => (isWatch(a) ? 2 : a.done ? 1 : 0);
  return list.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map((o) => o.a);
}

export interface PastMonth { ym: string; month: number; parts: string[] }
/** 往月: months before `cur` with at least one item, newest first. */
export function pastMonths(s: Snapshot, cur: string): PastMonth[] {
  const months = s.qyx_months || {};
  return Object.keys(months)
    .filter((k) => k < cur && (months[k] || []).length)
    .sort()
    .reverse()
    .map((ym) => ({
      ym,
      month: parseInt(ym.split('-')[1], 10),
      parts: (months[ym] || []).map((a) => {
        const sp = a.splits || [];
        const dn = sp.filter((x) => x.done).length;
        return `${a.done ? '✓ ' : ''}${a.text}${sp.length ? `（${dn}/${sp.length}）` : ''}`;
      }),
    }));
}

export function findGoal(s: Snapshot, ym: string, id: string | number): MonthGoal | undefined {
  return monthGoals(s, ym).find((a) => String(a.id) === String(id));
}

/** Any goal in any month by id (legacy goalById). */
export function goalById(s: Snapshot, id: unknown): MonthGoal | null {
  for (const ym of Object.keys(s.qyx_months || {})) {
    const found = (s.qyx_months![ym] || []).find((a) => String(a.id) === String(id));
    if (found) return found;
  }
  return null;
}

export function tagPath(s: Snapshot, id: string): string {
  const tags = s.qyx_tags || [];
  const byId = (x: string) => tags.find((t) => t.id === x);
  const parts: string[] = [];
  const seen = new Set<string>();
  let t = byId(id);
  while (t && !seen.has(t.id)) {
    seen.add(t.id);
    parts.unshift(t.name);
    t = t.parent_id ? byId(t.parent_id) : undefined;
  }
  return parts.join('/');
}

/** `#path` for each tag still known; unknown ids dropped. */
export function goalTagPaths(s: Snapshot, goalId: string | number): { id: string; path: string }[] {
  const ids = [...new Set(s.qyx_goal_tags?.[String(goalId)] || [])];
  return ids.map((id) => ({ id, path: tagPath(s, id) })).filter((x) => x.path);
}

export interface TrailLine { t: number; prefix: string; text: string }
/**
 * 轨迹 (read-only): done rows that match today/yesterday-three items bound to this goal, and
 * notes carrying one of the goal's tags; plus the card's own operation history.
 */
export function goalTrail(s: Snapshot, a: MonthGoal): { derived: TrailLine[]; cardOps: TrailLine[] } {
  const log = s.qyx_log || [];
  const taskIds = Object.keys(s.qyx_task_goals || {}).filter((id) => String(s.qyx_task_goals![id]) === String(a.id));
  const taskTexts = new Set<string>();
  [s.qyx_enough, s.qyx_enough_prev].filter((x): x is EnoughDay => !!x).forEach((day) =>
    (day.items || []).forEach((item) => {
      if (!taskIds.includes(String(item.id))) return;
      if (item.text) taskTexts.add(item.text);
      (item.subs || []).forEach((sub) => { if (sub.text) taskTexts.add(sub.text); });
    }));
  const tagIds = new Set(s.qyx_goal_tags?.[String(a.id)] || []);
  const tagPaths = new Set([...tagIds].map((id) => tagPath(s, id)));
  const rt = s.qyx_record_tags || {};
  const trail: TrailLine[] = [
    ...log.filter((e) => e.type === 'done' && taskTexts.has(e.text)).map((e) => ({ t: e.t, prefix: '✓', text: e.text })),
    ...log
      .filter((e) => e.type === 'note' && ((rt[e.id] || []).some((id) => tagIds.has(id)) || parseTagPaths(e.text).some((p) => tagPaths.has(p))))
      .map((e) => ({ t: e.t, prefix: '✎', text: e.text })),
  ];
  const seen = new Set<string>();
  const derived = trail
    .filter((x) => { const k = x.prefix + '|' + x.t + '|' + x.text; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => y.t - x.t);
  const cardOps = (a.hist || []).map((h) => ({ t: h.t, prefix: '·', text: h.ev })).sort((x, y) => y.t - x.t);
  return { derived, cardOps };
}

/* ---------------- tombstone helper ---------------- */

/** Legacy renameScope: re-target tombstones from one scope to another, de-duplicated. */
export function renameScope(s: Snapshot, oldScope: string, newScope: string) {
  if (oldScope === newScope) return;
  const dead = s.qyx_dead;
  if (!Array.isArray(dead)) return;
  let touched = false;
  dead.forEach((d) => { if (d.s === oldScope) { d.s = newScope; touched = true; } });
  if (!touched) return;
  const seen = new Set<string>();
  s.qyx_dead = dead.filter((d: Tombstone) => {
    const k = d.s + '\u0000' + d.v;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------------- month creation ---------------- */

/**
 * Legacy `monthAnchors()` side effect, made explicit. If this month has no entry yet, create it
 * from last month's 观察位 (goals never carry), copying their tag lists by position.
 * An empty array never re-triggers, so deleting all watches does not regrow them.
 * Returns true when it wrote something.
 */
export function ensureMonth(s: Snapshot, clock: Clock): boolean {
  const ym = currentYm(clock);
  const months = (s.qyx_months ||= {});
  if (months[ym]) return false;
  const py = prevYm(ym);
  const prev = months[py] || [];
  const prevWatches = prev.filter((a) => a && a.kind === 'watch');
  months[ym] = prevWatches
    .map((a) => ({
      id: stableId('goal_', ym + '|' + a.text + '|' + clock.nonce()),
      text: a.text,
      kind: 'watch' as const,
      done: false,
      splits: (a.splits || []).map((x) => ({ text: (x && x.text) || String(x || ''), done: false })),
      hist: [],
      carriedFrom: py,
    }))
    .slice(0, MONTH_MAX);
  const gt = (s.qyx_goal_tags ||= {});
  prevWatches.forEach((a, i) => {
    const tags = gt[String(a.id)];
    if (tags && tags.length && months[ym][i]) gt[String(months[ym][i].id)] = [...tags];
  });
  return true;
}

/** Legacy initTagSystem's goal part: give id-less goals an id (old data). Returns true if it changed anything. */
export function repairGoalIds(s: Snapshot): boolean {
  let changed = false;
  Object.keys(s.qyx_months || {}).forEach((ym) =>
    (s.qyx_months![ym] || []).forEach((a, i) => {
      if (!a.id) { a.id = stableId('goal_', ym + '|' + a.text + '|' + i); changed = true; }
    }));
  return changed;
}

/** One call for "the goals page was opened": repair ids, create this month. Writes only if needed. */
export function openGoalsPage(s: Snapshot, clock: Clock): boolean {
  const a = repairGoalIds(s);
  const b = ensureMonth(s, clock);
  return a || b;
}

/** Whether opening would write (so the page can skip a commit). */
export function needsOpenWrite(s: Snapshot, clock: Clock): boolean {
  if (!s.qyx_months?.[currentYm(clock)]) return true;
  return Object.values(s.qyx_months || {}).some((l) => (l || []).some((a) => !a.id));
}

/* ---------------- goal actions ---------------- */

function aHist(a: MonthGoal, ev: string, clock: Clock) {
  a.hist = a.hist || [];
  a.hist.push({ t: clock.now(), ev });
  if (a.hist.length > 60) a.hist = a.hist.slice(-60);
}

export type AddGoalResult =
  | { ok: true; goal: MonthGoal }
  | { ok: false; reason: 'empty' | 'dup' | 'month-full' | 'goals-full' };

export const GOAL_MESSAGES = {
  dup: '这个月已经有同名的一条了。',
  'month-full': `这个月已经有 ${MONTH_MAX} 条了。想加，先删一个。`,
  'goals-full': `目标位只有 ${GOAL_MAX} 个，都在进行中。想加，先完成或删掉一个，或者放进观察位。`,
} as const;

export function addGoal(s: Snapshot, rawText: string, kind: 'goal' | 'watch', clock: Clock): AddGoalResult {
  const text = String(rawText || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  ensureMonth(s, clock);
  const ym = currentYm(clock);
  const list = s.qyx_months![ym];
  if (list.some((x) => x.text === text)) return { ok: false, reason: 'dup' };
  if (list.length >= MONTH_MAX) return { ok: false, reason: 'month-full' };
  if (kind === 'goal' && goalCount(list) >= GOAL_MAX) return { ok: false, reason: 'goals-full' };
  unbury(s, 'anchor:' + ym, text);
  // No `done` field until the next normMonths — identical to what legacy writes.
  const goal = {
    id: stableId('goal_', ym + '|' + text + '|' + clock.now()),
    text,
    kind,
    splits: [],
    hist: [{ t: clock.now(), ev: kind === 'watch' ? '开始观察' : '立下' }],
  } as unknown as MonthGoal;
  list.push(goal);
  return { ok: true, goal };
}

export type RenameResult = { ok: true } | { ok: false; reason: 'noop' | 'dup' | 'missing' };

export function renameGoal(s: Snapshot, id: string | number, rawText: string, clock: Clock): RenameResult {
  const ym = currentYm(clock);
  ensureMonth(s, clock);
  const a = findGoal(s, ym, id);
  if (!a) return { ok: false, reason: 'missing' };
  const next = String(rawText || '').trim();
  if (!next || next === a.text) return { ok: false, reason: 'noop' };
  if (monthGoals(s, ym).some((x) => x !== a && x.text === next)) return { ok: false, reason: 'dup' };
  const old = a.text;
  aHist(a, '改名：' + old + ' → ' + next, clock);
  a.text = next;
  bury(s, 'anchor:' + ym, old, clock);
  unbury(s, 'anchor:' + ym, next);
  renameScope(s, 'split:' + old, 'split:' + next);
  return { ok: true };
}

/** 完成 toggle (goals only). Un-doing only flips the flag, as in legacy. Returns the new state. */
export function toggleGoalDone(s: Snapshot, id: string | number, clock: Clock): boolean | null {
  ensureMonth(s, clock);
  const a = findGoal(s, currentYm(clock), id);
  if (!a || isWatch(a)) return null;
  a.done = !a.done;
  if (a.done) {
    addLog(s, { type: 'done', text: a.text, src: '月目标' }, clock);
    aHist(a, '完成 ✓', clock);
  }
  return a.done;
}

export function deleteGoal(s: Snapshot, id: string | number, clock: Clock): boolean {
  const ym = currentYm(clock);
  ensureMonth(s, clock);
  const anchors = monthGoals(s, ym);
  const a = anchors.find((x) => String(x.id) === String(id));
  if (!a) return false;
  anchors.splice(anchors.indexOf(a), 1);
  if (!anchors.some((x) => String(x.id) === String(a.id))) {
    const tg = (s.qyx_task_goals ||= {});
    Object.keys(tg).forEach((k) => { if (String(tg[k]) === String(a.id)) tg[k] = null; });
    if (s.qyx_goal_tags) delete s.qyx_goal_tags[String(a.id)];
  }
  (a.splits || []).forEach((sp) => bury(s, 'split:' + a.text, sp.text, clock));
  bury(s, 'anchor:' + ym, a.text, clock);
  return true;
}

/* ---------------- splits ---------------- */

export type SplitResult = { ok: true } | { ok: false; reason: 'noop' | 'dup' | 'missing' };

function goalOf(s: Snapshot, id: string | number, clock: Clock): MonthGoal | undefined {
  ensureMonth(s, clock);
  return findGoal(s, currentYm(clock), id);
}

export function addSplit(s: Snapshot, goalId: string | number, rawText: string, clock: Clock): SplitResult {
  const a = goalOf(s, goalId, clock);
  const v = String(rawText || '').trim();
  if (!a) return { ok: false, reason: 'missing' };
  if (!v) return { ok: false, reason: 'noop' };
  a.splits = a.splits || [];
  unbury(s, 'split:' + a.text, v);
  a.splits.push({ text: v, done: false });
  aHist(a, '加小项：' + v, clock);
  return { ok: true };
}

export function renameSplit(s: Snapshot, goalId: string | number, index: number, rawText: string, clock: Clock): SplitResult {
  const a = goalOf(s, goalId, clock);
  const sp = a?.splits?.[index];
  if (!a || !sp) return { ok: false, reason: 'missing' };
  const next = String(rawText || '').trim();
  if (!next || next === sp.text) return { ok: false, reason: 'noop' };
  if (a.splits.some((x) => x !== sp && x.text === next)) return { ok: false, reason: 'dup' };
  const old = sp.text;
  aHist(a, '改：' + old + ' → ' + next, clock);
  sp.text = next;
  bury(s, 'split:' + a.text, old, clock);
  unbury(s, 'split:' + a.text, next);
  return { ok: true };
}

/** Check a split (goals only). Becoming done logs a 完成 row; un-checking changes nothing else. */
export function toggleSplit(s: Snapshot, goalId: string | number, index: number, clock: Clock): boolean | null {
  const a = goalOf(s, goalId, clock);
  const sp = a?.splits?.[index];
  if (!a || !sp || isWatch(a)) return null;
  sp.done = !sp.done;
  if (sp.done) {
    addLog(s, { type: 'done', text: sp.text, src: '月目标·小项' }, clock);
    aHist(a, '完成：' + sp.text, clock);
  }
  return sp.done;
}

export function deleteSplit(s: Snapshot, goalId: string | number, index: number, clock: Clock): boolean {
  const a = goalOf(s, goalId, clock);
  const sp = a?.splits?.[index];
  if (!a || !sp) return false;
  a.splits.splice(index, 1);
  bury(s, 'split:' + a.text, sp.text, clock);
  aHist(a, '删：' + sp.text, clock);
  return true;
}

/* ---------------- AI split (explicit tap only) ---------------- */

export function splitPrompt(goalText: string): string {
  return `用户这个月的一个方向是「${goalText}」。把它拆成3到5个具体的小选项——具体到今天拿出20分钟就能做的程度，每个不超过15个字。直接列出，一行一个，不要编号，不要解释。`;
}

export function parseSplitLines(text: string): string[] {
  const lines = String(text || '').split(/\n+/).map((x) => x.replace(/^[\d.、\-*\s]+/, '').trim()).filter(Boolean).slice(0, 5);
  if (!lines.length) throw new Error('没拆出来');
  return lines;
}

/** Ask the AI for split suggestions. Sends only the goal text. Throws on failure (page shows the message). */
export async function suggestSplits(
  goalText: string,
  cfg: { provider: string | null | undefined; key: string },
  fetchImpl?: typeof fetch,
  opts: AiOptions = {},
): Promise<string[]> {
  const r = await runAI(cfg, splitPrompt(goalText), [{ role: 'user', content: '拆吧' }], opts, fetchImpl);
  return parseSplitLines(r.text);
}

export const splitErrorText = (e: unknown) => '拆不动：' + ((e as Error)?.message || String(e));

/**
 * Add AI lines as splits. Deviation: lines repeated inside one answer are added once
 * (legacy compared against the pre-answer set only). Returns how many were added.
 */
export function applySplitLines(s: Snapshot, goalId: string | number, lines: string[], clock: Clock): number {
  const a = goalOf(s, goalId, clock);
  if (!a) return 0;
  a.splits = a.splits || [];
  lines.forEach((l) => unbury(s, 'split:' + a.text, l));
  const have = new Set(a.splits.map((x) => x.text));
  let added = 0;
  lines.forEach((l) => {
    if (!have.has(l) && a.splits.length < SPLIT_AI_MAX) {
      a.splits.push({ text: l, done: false });
      have.add(l);
      aHist(a, '拆出：' + l, clock);
      added++;
    }
  });
  return added;
}

/* ---------------- tags ---------------- */

/**
 * 关联标签: replace the goal's tag list with the `#paths` in `input` (empty clears).
 * Deviation: every path is revived/created. Legacy passed `ensureTagPath` straight to
 * `Array.map`, so the first path got `revive=0` and was silently dropped when its tag
 * was tombstoned.
 */
export function setGoalTags(s: Snapshot, goalId: string | number, input: string, clock: Clock): string[] {
  const ids = parseTagPaths(input).map((p) => ensureTagPath(s, p, clock, true)).filter((x): x is string => !!x);
  (s.qyx_goal_tags ||= {})[String(goalId)] = ids;
  return ids;
}

/* 排进今天: use `planAddToToday`, `addToToday` and `addSubToItem` from domain/today.ts (they also rotate the day). */

/* ---------------- habits (qyx_habits, ≤ 3) ---------------- */

export const habitCount = (h: Habit, day: string) => (h.counts || {})[day] || 0;

/** Last 7 days (oldest first) with whether each had a count. */
export function habitSpark(h: Habit, nowMs: number): { day: string; hit: boolean }[] {
  const out: { day: string; hit: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dk = dayKey(nowMs - i * 864e5);
    out.push({ day: dk, hit: habitCount(h, dk) > 0 });
  }
  return out;
}

export type HabitResult = { ok: true } | { ok: false; reason: 'empty' | 'dup' | 'full' | 'noop' | 'missing' };

export function addHabit(s: Snapshot, rawName: string, clock: Clock): HabitResult {
  const name = String(rawName || '').trim();
  if (!name) return { ok: false, reason: 'empty' };
  const habits = (s.qyx_habits ||= []);
  if (habits.length >= HABIT_MAX) return { ok: false, reason: 'full' };
  // Deviation: legacy let you add the same name twice (merge then folds them by name anyway).
  if (habits.some((h) => h.name === name)) return { ok: false, reason: 'dup' };
  unbury(s, 'habit', name);
  let id = clock.now();
  while (habits.some((h) => h.id === id)) id++;
  habits.push({ id, name, counts: {}, updatedAt: clock.now() });
  return { ok: true };
}

const habitOf = (s: Snapshot, id: string | number) => (s.qyx_habits || []).find((h) => h.id === id);

/** Tap = +1 for today. There is no undo (legacy). */
export function tapHabit(s: Snapshot, id: string | number, clock: Clock): number | null {
  const h = habitOf(s, id);
  if (!h) return null;
  const today = dayKey(clock.now());
  h.counts = h.counts || {};
  h.counts[today] = (h.counts[today] || 0) + 1;
  h.updatedAt = clock.now();
  return h.counts[today];
}

export function renameHabit(s: Snapshot, id: string | number, rawName: string, clock: Clock): HabitResult {
  const h = habitOf(s, id);
  if (!h) return { ok: false, reason: 'missing' };
  const next = String(rawName || '').trim();
  if (!next || next === h.name) return { ok: false, reason: 'noop' };
  if ((s.qyx_habits || []).some((x) => x !== h && x.name === next)) return { ok: false, reason: 'dup' };
  bury(s, 'habit', h.name, clock);
  h.name = next;
  unbury(s, 'habit', next);
  h.updatedAt = clock.now();
  return { ok: true };
}

export function deleteHabit(s: Snapshot, id: string | number, clock: Clock): boolean {
  const h = habitOf(s, id);
  if (!h) return false;
  s.qyx_habits = (s.qyx_habits || []).filter((x) => x.id !== id);
  bury(s, 'habit', h.name, clock);
  return true;
}

/* 久坐提醒 (shown on the 说说 page; data helpers live here next to the habits) */

export const SIT_HABIT_RE = /站|走|起身|活动|运动/;
export const sitHabit = (s: Snapshot): Habit | undefined => (s.qyx_habits || []).find((h) => SIT_HABIT_RE.test(h.name));

/** Tap the reminder button: counts for today on the first matching habit, if there is one. */
export function tapSitReminder(s: Snapshot, clock: Clock): boolean {
  const h = sitHabit(s);
  if (!h) return false;
  tapHabit(s, h.id, clock);
  return true;
}
