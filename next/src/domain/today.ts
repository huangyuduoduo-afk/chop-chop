/*
 * Today page data: 三件事 (qyx_enough), bonus, opts/bench/dice/ongoing/drawers/routines/rules,
 * the 问一问 AI prompts, and selecting v5 checklist tasks / ideas into today (mirror rows).
 *
 * Port of legacy index.html (ensureEnough … rollDice, aiSend) + assets/v5.js (saveEnough /
 * renderEnough mirroring, selectTaskForToday / selectIdeaForToday). Every function takes a draft
 * Snapshot and mutates it; nothing here touches storage, the DOM, Date.now() or Math.random().
 *
 * Deliberate fixes (wire-compatible, asserted in tests/today-fixes.test.ts):
 *  F1  accepting a dice result also buries the `opt` tombstone (legacy: other devices re-added it)
 *  F2  adding to 定过的 unburies the `ongoing` tombstone (legacy: a later merge dropped it again)
 *  F3  the circle of a deleted row does nothing (legacy: resurrected it with its hidden old text)
 *  F4  mirroring a row into its plan / idea only writes when the text or done state really differs
 *      (legacy: selecting a plan marked qyx_ideas_v5 dirty and froze the idea's derived title)
 *  F5  deleting a rule that came without an id removes only that rule (legacy removed every id-less rule)
 *  F6  reconcile never revives a deleted row from its plan / idea
 */
import {
  blankEnoughItem, doneLogIdentity, enoughStatus, enoughSubStatus, logKey, normalizeEnoughItem, syncParentFromSubs,
} from '../core/merge';
import type { BonusDay, EnoughDay, EnoughItem, EnoughSub, Idea, PlanTask, Snapshot } from '../core/types';
import { dayKey, monthKey, pad, stableId, type Clock } from '../core/util';
import { findIdea, findTask, ideaTitle, ideasForWrite, readIdeas } from './ideas';
import { stripRefs } from './refs';
import { currentDicePool } from './settings';
import { addLog, bury, ensureTagPath, isDead, unbury } from './shared';

export const MAX_OPTS = 9;
export const MAX_DRAWERS = 6;
export const MAX_ROUTINES = 9;
export const MAX_ONGOING = 10;
export const SRC_PARENT = '三件';
export const SRC_SUB = '三件·小项';

const today = (clock: Clock) => dayKey(clock.now());
export const isAlive = (x: EnoughItem) => enoughStatus(x) !== 'deleted';
const isWritten = (x: EnoughItem) => isAlive(x) && !!String(x.text || '').trim();
export const isFree = (x: EnoughItem) => !isAlive(x) || !String(x.text || '').trim();

/* ================= done-log helpers (addDoneLogOnce / removeDoneLogToday) ================= */

export function addDoneLogOnce(s: Snapshot, text: string, src: string, clock: Clock) {
  const key = `${today(clock)}|done|${src || ''}|${text}`;
  const existing = (s.qyx_log || []).find((e) => e.type === 'done' && doneLogIdentity(e) === key);
  return existing || addLog(s, { type: 'done', text, src }, clock);
}

export function removeDoneLogToday(s: Snapshot, text: string, src: string, clock: Clock): boolean {
  const key = `${today(clock)}|done|${src || ''}|${text}`;
  const log = s.qyx_log || [];
  const idx = log.findIndex((e) => e.type === 'done' && doneLogIdentity(e) === key);
  if (idx < 0) return false;
  const e = log[idx];
  bury(s, 'log', logKey(e), clock);
  if (s.qyx_record_tags) delete s.qyx_record_tags[e.id];
  log.splice(idx, 1);
  return true;
}

/* ================= 往日写过的事项 history (qyx_opts_hist) ================= */

export const optsHistKey = (item: { t?: number; text?: string }) => (item.t || 0) + '|' + (item.text || '');

export function rememberOpt(s: Snapshot, text: string, t: number) {
  const hist = s.qyx_opts_hist ?? [];
  if (hist.some((item) => dayKey(item.t) === dayKey(t) && item.text === text)) return;
  s.qyx_opts_hist = [...hist, { t, text }].sort((a, b) => a.t - b.t).slice(-800);
}

/* ================= 三件事: rollover ================= */

/** True when the stored data is not yet today's three (missing / other day / wrong length). */
export function enoughNeedsEnsure(s: Snapshot, clock: Clock): boolean {
  const e = s.qyx_enough;
  return !e || e.d !== today(clock) || !Array.isArray(e.items) || e.items.length !== 3;
}

/**
 * Legacy ensureEnough. Rolls the day over (previous day -> qyx_enough_prev, unfinished 小项 -> history),
 * normalises to exactly 3 rows. Returns today's data (now owned by the draft).
 */
export function ensureEnough(s: Snapshot, clock: Clock): EnoughDay {
  const day = today(clock);
  let e = s.qyx_enough;
  if (!e || e.d !== day) {
    if (e && e.items && e.items.some((i) => i.text)) {
      const old = e;
      const previous: EnoughDay = {
        ...old,
        items: old.items.map((i) => normalizeEnoughItem(i, clock)).filter((i) => i.text.trim() && i.status !== 'deleted'),
      };
      if (previous.items.length) s.qyx_enough_prev = previous;
      const harvestT = new Date(old.d + 'T12:00:00').getTime();
      old.items.forEach((item) => {
        (item.subs || []).forEach((sub) => {
          if (sub.status === 'completed') return;
          if (!sub.text || !sub.text.trim()) return;
          if (isDead(s, 'esub:' + old.d, sub.text)) return;
          rememberOpt(s, sub.text, harvestT);
        });
      });
    }
    e = s.qyx_enough = { d: day, items: [blankEnoughItem(clock), blankEnoughItem(clock), blankEnoughItem(clock)] };
  }
  e.items = (e.items || []).map((i) => normalizeEnoughItem(i, clock)).slice(0, 3);
  e.items.forEach((i) => {
    if (!String(i.text || '').trim() && i.status !== 'incomplete') { i.status = 'incomplete'; i.done = false; }
  });
  e.items.forEach((i) => syncParentFromSubs(i));
  while (e.items.length < 3) e.items.push(blankEnoughItem(clock));
  return e;
}

/** What the page renders: today's three, normalised, without touching the stored data. */
export function viewEnough(s: Snapshot, clock: Clock): EnoughItem[] {
  const e = s.qyx_enough;
  const raw = e && e.d === today(clock) && Array.isArray(e.items) ? e.items : [];
  const rows = raw.slice(0, 3).map((x) => {
    const item = normalizeEnoughItem({ ...x }, clock);
    if (!String(item.text || '').trim() && item.status !== 'incomplete') { item.status = 'incomplete'; item.done = false; }
    syncParentFromSubs(item);
    return item;
  });
  while (rows.length < 3) rows.push({ id: 'blank' + rows.length, text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] });
  return rows;
}

/* ================= v5 mirror (patched saveEnough / renderEnough) ================= */

/**
 * Port of the patched `saveEnough`: today's rows push their text / done state into the plan task or
 * idea they mirror (rows newer than the source win). Called by every action that edits the three.
 * F4: nothing is written when the source already says the same.
 */
export function pushMirrors(s: Snapshot, clock: Clock) {
  const e = s.qyx_enough;
  if (!e || e.d !== today(clock)) return;
  const now = clock.now();
  for (const x of e.items) {
    if (!isAlive(x)) { delete x.v5TaskId; delete x.v5IdeaId; continue; }
    const completed = enoughStatus(x) === 'completed';
    if (x.v5TaskId) {
      const t = findTask(s, x.v5TaskId);
      if (!t) delete x.v5TaskId;
      else if ((x.updatedAt || 0) > (t.updatedAt || 0) && (t.text !== x.text || t.done !== completed)) {
        if (t.done && completed && t.text !== x.text) {
          removeDoneLogToday(s, t.text, SRC_PARENT, clock);
          addDoneLogOnce(s, x.text, SRC_PARENT, clock);
        }
        const live = ideasForWrite(s).tasks.find((k) => k.id === t.id)!;
        live.text = x.text; live.done = completed; live.updatedAt = x.updatedAt;
      }
    }
    if (x.v5IdeaId) {
      const idea = findIdea(s, x.v5IdeaId);
      if (!idea) { delete x.v5IdeaId; continue; }
      if ((x.updatedAt || 0) > (idea.statusUpdatedAt || 0)) {
        const next: Idea['status'] = completed ? 'completed' : 'open';
        const title = ideaTitle(s, idea);
        if (idea.status === next && title === x.text) continue;
        if (idea.status === 'completed' && next === 'completed' && title !== x.text) {
          removeDoneLogToday(s, title, SRC_PARENT, clock);
          addDoneLogOnce(s, x.text, SRC_PARENT, clock);
        }
        const st = ideasForWrite(s);
        const live = st.items.find((k) => k.id === idea.id)!;
        if (live.status !== next) {
          st.events.push({ id: 'ev_' + clock.nonce().replace(/[^-\w:.]/g, '_'), ideaId: live.id, event: next, t: now, updatedAt: now });
        }
        live.title = x.text; live.status = next; live.completedAt = next === 'completed' ? now : (null as any);
        live.statusUpdatedAt = x.updatedAt; live.updatedAt = Math.max(live.updatedAt || 0, x.updatedAt);
      }
    }
  }
}

/**
 * Port of the patched `renderEnough` pull: today's rows follow the plan task / idea they mirror when
 * the source is newer, and lose the mirror id when the source is gone. Returns whether anything
 * changed; with `apply=false` it only answers (the page uses that to commit only when needed).
 */
export function reconcileToday(s: Snapshot, clock: Clock, apply = true): boolean {
  const e = s.qyx_enough;
  if (!e || e.d !== today(clock) || !Array.isArray(e.items)) return false;
  const st = readIdeas(s);
  let changed = false;
  for (const x of e.items) {
    if (!x) continue;
    if (!isAlive(x)) {
      if (x.v5TaskId !== undefined || x.v5IdeaId !== undefined) { changed = true; if (apply) { delete x.v5TaskId; delete x.v5IdeaId; } }
      continue;
    }
    if (x.v5TaskId) {
      const t: PlanTask | undefined = st.tasks.find((k) => k.id === x.v5TaskId && !k.removedAt);
      if (!t) { changed = true; if (apply) delete x.v5TaskId; }
      else if ((t.updatedAt || 0) > (x.updatedAt || 0)) {
        changed = true;
        if (apply) { x.text = t.text; x.done = t.done; x.status = t.done ? 'completed' : 'incomplete'; x.updatedAt = t.updatedAt; }
      }
    }
    if (x.v5IdeaId) {
      const idea = st.items.find((k) => k.id === x.v5IdeaId && !k.removedAt);
      if (!idea) { changed = true; if (apply) delete x.v5IdeaId; }
      else if ((idea.statusUpdatedAt || 0) > (x.updatedAt || 0)) {
        changed = true;
        if (apply) {
          x.text = ideaTitle(s, idea); x.done = idea.status === 'completed';
          x.status = x.done ? 'completed' : 'incomplete'; x.updatedAt = idea.statusUpdatedAt!;
        }
      }
    }
  }
  return changed;
}

/* ================= selecting plans / ideas into today ================= */

function slotFor(e: EnoughDay, slot?: number): number {
  if (slot !== undefined) return Number.isInteger(slot) && slot >= 0 && slot <= 2 ? slot : -1;
  return e.items.findIndex(isFree);
}

/**
 * Put a v5 checklist task into today's three. Without `slot` it takes the first free (blank or deleted)
 * row; with `slot` it replaces that row (the page confirms first). Returns false if there is no free
 * slot or the task is gone. Already there counts as done (true).
 */
export function selectTaskForToday(s: Snapshot, taskId: string, clock: Clock, slot?: number): boolean {
  const t = findTask(s, taskId);
  if (!t) return false;
  const e = ensureEnough(s, clock);
  if (e.items.some((x) => x.v5TaskId === taskId && isAlive(x))) return true;
  const at = slotFor(e, slot);
  if (at < 0) return false;
  e.items[at] = {
    id: t.id, v5TaskId: t.id, text: t.text, done: t.done, status: t.done ? 'completed' : 'incomplete',
    updatedAt: Math.max(clock.now(), (t.updatedAt || 0) + 1), subs: [],
  };
  return true;
}

/** Put a v5 idea into today's three (same rules as selectTaskForToday). */
export function selectIdeaForToday(s: Snapshot, ideaId: string, clock: Clock, slot?: number): boolean {
  const idea = findIdea(s, ideaId);
  if (!idea) return false;
  const e = ensureEnough(s, clock);
  if (e.items.some((x) => x.v5IdeaId === ideaId && isAlive(x))) return true;
  const at = slotFor(e, slot);
  if (at < 0) return false;
  const done = idea.status === 'completed';
  e.items[at] = {
    id: idea.id, v5IdeaId: idea.id, text: ideaTitle(s, idea), done, status: done ? 'completed' : 'incomplete',
    updatedAt: Math.max(clock.now(), (idea.statusUpdatedAt || 0) + 1), subs: [],
  };
  return true;
}

export interface DayPlans { ideas: Idea[]; tasks: PlanTask[] }

/** 安排到这一天: ideas / checklist tasks scheduled for `day`, minus those already in today's three. */
export function dayPlans(s: Snapshot, day: string): DayPlans {
  const st = readIdeas(s);
  const e = s.qyx_enough;
  const rows = e && e.d === day ? e.items || [] : [];
  const log = s.qyx_log || [];
  const contentTime = (i: Idea) => Math.max(i.createdAt || 0, ...st.links.filter((l) => l.ideaId === i.id && !l.removedAt).map((l) => {
    const r = log.find((k) => k.id === l.recordId);
    return r ? Number(r.updatedAt) || r.t : 0;
  }));
  const ideas = st.items
    .filter((i) => !i.removedAt && i.scheduledDate === day && !rows.some((x) => x.v5IdeaId === i.id && isAlive(x)))
    .sort((a, b) => contentTime(b) - contentTime(a) || a.id.localeCompare(b.id));
  const tasks = st.tasks
    .filter((t) => !t.removedAt && t.scheduledDate === day && log.some((r) => r.id === t.recordId) && !rows.some((x) => x.v5TaskId === t.id && isAlive(x)))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
  return { ideas, tasks };
}

/* ================= 三件事: row actions ================= */

export type RowOutcome = 'blank' | 'completed' | 'all-done' | 'reopened' | 'expired' | 'needs-subs' | 'noop';

/** Typing into a row (legacy `input` handler; the page calls it on blur / Enter). */
export function setEnoughText(s: Snapshot, i: number, value: string, clock: Clock): boolean {
  const e = ensureEnough(s, clock);
  const item = e.items[i];
  if (!item) return false;
  if (value === (isAlive(item) ? item.text : '')) return false;
  const wasCompleted = item.status === 'completed';
  const prevText = item.text;
  item.text = value;
  if (item.status === 'deleted') item.status = 'incomplete';
  if (!value.trim()) {
    if (wasCompleted) removeDoneLogToday(s, prevText, SRC_PARENT, clock);
    item.status = 'incomplete';
    item.subs = [];
  }
  item.done = item.status === 'completed';
  item.updatedAt = clock.now();
  pushMirrors(s, clock);
  return true;
}

export function setEnoughStatus(s: Snapshot, i: number, status: EnoughItem['status'], clock: Clock): RowOutcome {
  const e = ensureEnough(s, clock);
  const item = e.items[i];
  if (!item || !item.text.trim() || !isAlive(item)) return 'blank'; // F3: deleted rows stay deleted
  const before = enoughStatus(item);
  item.status = before === status ? 'incomplete' : status;
  item.done = item.status === 'completed';
  item.updatedAt = clock.now();
  pushMirrors(s, clock);
  if (item.status === 'completed' && before !== 'completed') {
    addDoneLogOnce(s, item.text, SRC_PARENT, clock);
    const filled = e.items.filter(isWritten);
    return filled.length === 3 && filled.every((x) => enoughStatus(x) === 'completed') ? 'all-done' : 'completed';
  }
  if (before === 'completed' && item.status !== 'completed') removeDoneLogToday(s, item.text, SRC_PARENT, clock);
  return item.status === 'expired' ? 'expired' : before === 'completed' ? 'reopened' : 'noop';
}

/** The row's circle. With 小项 the parent only follows its subs. */
export function toggleEnough(s: Snapshot, i: number, clock: Clock): RowOutcome {
  const e = ensureEnough(s, clock);
  const item = e.items[i];
  if (!item) return 'noop';
  if (!isAlive(item)) return 'blank';
  if (item.subs.length) {
    syncParentFromSubs(item);
    pushMirrors(s, clock);
    return item.status !== 'completed' ? 'needs-subs' : 'noop';
  }
  return setEnoughStatus(s, i, enoughStatus(item) === 'completed' ? 'incomplete' : 'completed', clock);
}

/** 删除这件事. */
export function deleteEnough(s: Snapshot, i: number, clock: Clock): boolean {
  const e = ensureEnough(s, clock);
  const item = e.items[i];
  if (!item || !item.text.trim() || !isAlive(item)) return false;
  (item.subs || []).forEach((sub) => bury(s, 'esub:' + e.d, sub.text, clock));
  if (s.qyx_task_tags) delete s.qyx_task_tags[item.id];
  (s.qyx_task_goals ||= {})[item.id] = null;
  item.subs = []; item.done = false; item.status = 'deleted'; item.updatedAt = clock.now();
  pushMirrors(s, clock);
  return true;
}

/* ---------------- 小项 ---------------- */

export const subDoneSrc = (n: number) => (n >= 2 ? `${SRC_SUB} ×${n}` : SRC_SUB);

function subDoneCount(s: Snapshot, text: string, clock: Clock): number {
  const day = today(clock);
  const t = String(text || '').trim();
  return (s.qyx_log || [])
    .filter((e) => e.type === 'done' && dayKey(e.t) === day && String(e.text || '').trim() === t && String(e.src || '').startsWith(SRC_SUB))
    .reduce((n, e) => {
      const m = String(e.src || '').match(/^三件·小项 ×(\d+)$/);
      return Math.max(n, m ? +m[1] || 0 : 1);
    }, 0);
}

/** How many times this 小项 was done today (done log is the source; `c` is the pre-4.5.5 fallback). */
export function subCount(s: Snapshot, sub: EnoughSub, clock: Clock): number {
  const n = subDoneCount(s, sub && sub.text, clock);
  const legacy = Math.max(0, Math.floor(+(sub?.c ?? 0) || 0));
  if (n > 0) return Math.max(n, legacy);
  if (legacy > 0) return legacy;
  return enoughSubStatus(sub) === 'completed' ? 1 : 0;
}

/** 拆小项. Returns how many were added. */
export function addSubs(s: Snapshot, i: number, texts: string[], clock: Clock): number {
  const e = ensureEnough(s, clock);
  const item = e.items[i];
  if (!item || !item.text.trim() || !isAlive(item)) return 0;
  let added = 0;
  for (const t of texts) {
    const text = String(t || '').trim();
    if (!text) continue;
    if ((item.subs || []).some((x) => String(x.text || '').trim() === text)) continue;
    unbury(s, 'esub:' + e.d, text);
    item.subs.push({ text, done: false, status: 'incomplete', updatedAt: clock.now() });
    added++;
  }
  if (!added) return 0;
  item.updatedAt = clock.now();
  syncParentFromSubs(item);
  pushMirrors(s, clock);
  return added;
}

/** Tap on the sub's check: incomplete -> completed -> expired -> incomplete. */
export function cycleSub(s: Snapshot, i: number, si: number, clock: Clock): boolean {
  const e = ensureEnough(s, clock);
  const item = e.items[i];
  const sub = item && item.subs[si];
  if (!sub) return false;
  const prev = sub.status;
  sub.status = sub.status === 'incomplete' ? 'completed' : sub.status === 'completed' ? 'expired' : 'incomplete';
  sub.done = sub.status === 'completed';
  if (sub.status !== 'completed') {
    const n = subCount(s, sub, clock);
    for (let k = n; k >= 2; k--) removeDoneLogToday(s, sub.text, subDoneSrc(k), clock);
    sub.c = 0;
  }
  sub.updatedAt = clock.now();
  syncParentFromSubs(item);
  pushMirrors(s, clock);
  if (sub.status === 'completed') addDoneLogOnce(s, sub.text, SRC_SUB, clock);
  else if (prev === 'completed') removeDoneLogToday(s, sub.text, SRC_SUB, clock);
  return true;
}

/** 再做一次. */
export function subAgain(s: Snapshot, i: number, si: number, clock: Clock): boolean {
  const e = ensureEnough(s, clock);
  const item = e.items[i];
  const sub = item && item.subs[si];
  if (!sub) return false;
  const n = subCount(s, sub, clock) + 1;
  sub.c = n; sub.status = 'completed'; sub.done = true; sub.updatedAt = clock.now();
  syncParentFromSubs(item);
  pushMirrors(s, clock);
  addDoneLogOnce(s, sub.text, subDoneSrc(n), clock);
  return true;
}

/** `×N` chip: one time less. */
export function subMinus(s: Snapshot, i: number, si: number, clock: Clock): boolean {
  const e = ensureEnough(s, clock);
  const sub = e.items[i] && e.items[i].subs[si];
  if (!sub) return false;
  const n = subCount(s, sub, clock);
  if (n <= 1) return false;
  removeDoneLogToday(s, sub.text, subDoneSrc(n), clock);
  sub.c = n - 1; sub.updatedAt = clock.now();
  pushMirrors(s, clock);
  return true;
}

export function editSub(s: Snapshot, i: number, si: number, value: string, clock: Clock): 'empty' | 'same' | 'ok' {
  const next = value.trim();
  if (!next) return 'empty';
  const e = ensureEnough(s, clock);
  const item = e.items[i];
  const current = item && item.subs[si];
  if (!current || next === current.text) return 'same';
  bury(s, 'esub:' + e.d, current.text, clock);
  unbury(s, 'esub:' + e.d, next);
  if (current.status === 'completed') {
    removeDoneLogToday(s, current.text, SRC_SUB, clock);
    addDoneLogOnce(s, next, SRC_SUB, clock);
  }
  current.text = next; current.updatedAt = clock.now();
  syncParentFromSubs(item);
  pushMirrors(s, clock);
  return 'ok';
}

export function removeSub(s: Snapshot, i: number, si: number, clock: Clock): boolean {
  const e = ensureEnough(s, clock);
  const item = e.items[i];
  const sub = item && item.subs[si];
  if (!sub) return false;
  item.subs.splice(si, 1);
  item.updatedAt = clock.now();
  syncParentFromSubs(item);
  bury(s, 'esub:' + e.d, sub.text, clock);
  pushMirrors(s, clock);
  return true;
}

/** 交给随机 on a sub: it stays, and is also put in the 打转区. */
export function subToOpts(s: Snapshot, i: number, si: number, clock: Clock): AddOptResult | null {
  const sub = viewEnough(s, clock)[i]?.subs[si];
  return sub ? addToOpts(s, sub.text, clock) : null;
}

/* ---------------- goal / tags ---------------- */

export function setTaskGoal(s: Snapshot, itemId: string, goalId: string | number | null) {
  (s.qyx_task_goals ||= {})[itemId] = goalId;
}

/** 关联标签: replaces the item's tags with the given `#paths`. */
export function setTaskTags(s: Snapshot, itemId: string, paths: string[], clock: Clock) {
  const ids = paths.map((p) => ensureTagPath(s, p, clock)).filter((x): x is string => !!x);
  (s.qyx_task_tags ||= {})[itemId] = ids;
}

const ymNow = (clock: Clock) => monthKey(clock.now());
const prevYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};

/** Legacy monthAnchors: the month is created lazily, carrying last month's 观察位. */
export function ensureMonthAnchors(s: Snapshot, clock: Clock) {
  const ym = ymNow(clock);
  const months = (s.qyx_months ||= {});
  if (!months[ym]) {
    const prev = months[prevYm(ym)] || [];
    const watch = prev.filter((a) => a && a.kind === 'watch');
    months[ym] = watch.map((a) => ({
      id: stableId('goal_', ym + '|' + a.text + '|' + clock.nonce()),
      text: a.text, kind: 'watch' as const, done: false,
      splits: (a.splits || []).map((x: any) => ({ text: (x && x.text) || String(x || ''), done: false })),
      hist: [], carriedFrom: prevYm(ym),
    })).slice(0, 12);
    watch.forEach((a, i) => {
      const tags = s.qyx_goal_tags && s.qyx_goal_tags[String(a.id)];
      if (tags && tags.length && months[ym][i]) (s.qyx_goal_tags![String(months[ym][i].id)] = [...tags]);
    });
  }
  return months[ym];
}

export const goalsOfMonth = (s: Snapshot, clock: Clock) => (s.qyx_months || {})[ymNow(clock)] || [];

export function goalById(s: Snapshot, id: unknown) {
  if (id === null || id === undefined || id === '') return null;
  for (const ym of Object.keys(s.qyx_months || {})) {
    const found = (s.qyx_months![ym] || []).find((a) => String(a.id) === String(id));
    if (found) return found;
  }
  return null;
}

/** 挂了 N 天: distinct recent days where the goal's task was written but not done. */
export function waitingDays(s: Snapshot, goalId: unknown, clock: Clock): number {
  if (!goalId) return 0;
  const goal = goalById(s, goalId);
  if (goal && goal.kind === 'watch') return 0;
  const now = clock.now();
  const sums = s.qyx_sums || {};
  const day = today(clock);
  let n = 0;
  for (let k = 0; k < 10; k++) {
    const sum = sums[dayKey(now - k * 86400000)];
    if (sum && sum.three && sum.three.some((x: any) => String(x.goal) === String(goalId) && !x.done)) n++;
  }
  const e = s.qyx_enough;
  if (!sums[day] && e && e.d === day && e.items.some((x) => String((s.qyx_task_goals || {})[x.id]) === String(goalId) && x.text.trim() && enoughStatus(x) !== 'completed' && enoughStatus(x) !== 'deleted')) n++;
  return n;
}

/** 20 分钟 button: a note in 说说 (the countdown itself is page-only). */
export function startTwentyMinutes(s: Snapshot, text: string, clock: Clock) {
  addLog(s, { type: 'note', text: `开始 20 分钟：${text}` }, clock);
}

/* ---------------- adding to today from the lists ---------------- */

export type AddTodayResult = 'today' | 'full' | 'exists';

export function addToToday(s: Snapshot, text: string, goalId: string | number | null | undefined, clock: Clock): AddTodayResult {
  const e = ensureEnough(s, clock);
  const t = String(text || '').trim();
  if (!t || e.items.some((x) => isAlive(x) && x.text.trim() === t)) return 'exists';
  const slot = e.items.find(isFree);
  if (!slot) return 'full';
  slot.text = t; slot.status = 'incomplete'; slot.done = false; slot.subs = []; slot.updatedAt = clock.now();
  if (goalId) (s.qyx_task_goals ||= {})[slot.id] = goalId;
  pushMirrors(s, clock);
  return 'today';
}

export interface SmartPlan {
  r: 'cancel' | 'exists' | 'direct' | 'ask';
  canTop: boolean;
  parents: { i: number; text: string }[];
}

/** First half of addToTodaySmart: where could this text go? `direct` = no written row yet, just add it. */
export function planAddToToday(s: Snapshot, text: string, clock: Clock): SmartPlan {
  const rows = viewEnough(s, clock);
  const t = String(text || '').trim();
  if (!t) return { r: 'cancel', canTop: false, parents: [] };
  const dup = rows.some((x) => isAlive(x) && (x.text.trim() === t || (x.subs || []).some((k) => String(k.text || '').trim() === t)));
  if (dup) return { r: 'exists', canTop: false, parents: [] };
  const parents = rows.map((x, i) => ({ x, i })).filter((o) => isWritten(o.x)).map((o) => ({ i: o.i, text: o.x.text.trim() }));
  const canTop = rows.some(isFree);
  return { r: parents.length ? 'ask' : 'direct', canTop, parents };
}

/** 放到「X」下面. */
export function addSubToItem(s: Snapshot, i: number, text: string, goalId: string | number | null | undefined, clock: Clock) {
  const e = ensureEnough(s, clock);
  const item = e.items[i];
  const t = String(text || '').trim();
  if (!item || !t) return null;
  unbury(s, 'esub:' + e.d, t);
  item.subs.push({ text: t, done: false, status: 'incomplete', updatedAt: clock.now() });
  item.updatedAt = clock.now();
  syncParentFromSubs(item);
  let noted = false;
  const goals = (s.qyx_task_goals ||= {});
  if (goalId && !goals[item.id]) { goals[item.id] = goalId; noted = true; }
  pushMirrors(s, clock);
  return { parent: item.text.trim(), noted, goalConflict: !!(goalId && goals[item.id] && String(goals[item.id]) !== String(goalId)) };
}

/* ================= 抽屉 / 常规 ================= */

type Named = { id: string; text: string; updatedAt?: number };

export function recentDrawerTexts(s: Snapshot, clock: Clock): string[] {
  const cut = clock.now() - 30 * 864e5;
  const seen = new Map<string, number>();
  const sums = s.qyx_sums || {};
  Object.keys(sums).forEach((k) => {
    const t = new Date(k + 'T12:00:00').getTime();
    if (!t || t < cut) return;
    ((sums[k] || {}).three || []).forEach((x: any) => {
      const text = String((x && x.text) || '').trim();
      if (!text) return;
      if (!seen.has(text) || seen.get(text)! < t) seen.set(text, t);
    });
  });
  const used = new Set((s.qyx_enough?.items || []).filter(isAlive).map((x) => String(x.text || '').trim()).filter(Boolean));
  return [...seen.entries()].filter(([t]) => !used.has(t)).sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/** The very first time qyx_drawers is null the page seeds it — but only when there is something to seed. */
export function drawersNeedSeed(s: Snapshot, clock: Clock): boolean {
  return !s.qyx_drawers && recentDrawerTexts(s, clock).length > 0;
}

/** Legacy ensureDrawers: the very first time (qyx_drawers is null) seed from the last 30 days. */
export function ensureDrawers(s: Snapshot, clock: Clock): boolean {
  if (s.qyx_drawers) return false;
  const now = clock.now();
  s.qyx_drawers = recentDrawerTexts(s, clock).slice(0, 5).map((text, i) => ({ id: stableId('drawer_', text + '|' + now + '|' + i), text, updatedAt: now + i }));
  return true;
}

/** Use a drawer: type its text into the first empty row. */
export function useDrawer(s: Snapshot, text: string, clock: Clock): boolean {
  const e = ensureEnough(s, clock);
  const at = e.items.findIndex(isFree);
  if (at < 0) return false;
  return setEnoughText(s, at, text, clock);
}

export function addDrawer(s: Snapshot, text: string, clock: Clock): 'ok' | 'full' | 'dup' | 'blank' {
  const list: Named[] = s.qyx_drawers ?? [];
  if (list.length >= MAX_DRAWERS) return 'full';
  const t = text.trim();
  if (!t) return 'blank';
  if (list.some((x) => String(x.text || '').trim() === t)) return 'dup';
  const now = clock.now();
  const id = stableId('drawer_', t + '|' + now + '|' + clock.nonce());
  unbury(s, 'drawer', id);
  s.qyx_drawers = [...list, { id, text: t, updatedAt: now }];
  return 'ok';
}

export function editDrawer(s: Snapshot, id: string, text: string, clock: Clock): 'ok' | 'dup' | 'blank' | 'gone' {
  const t = text.trim();
  const list = s.qyx_drawers ?? [];
  const d = list.find((x) => String(x.id) === String(id));
  if (!d) return 'gone';
  if (!t) return 'blank';
  if (list.some((x) => x !== d && String(x.text || '').trim() === t)) return 'dup';
  d.text = t; d.updatedAt = clock.now();
  return 'ok';
}

export function removeDrawer(s: Snapshot, id: string, clock: Clock) {
  s.qyx_drawers = (s.qyx_drawers ?? []).filter((x) => String(x.id) !== String(id));
  bury(s, 'drawer', id, clock);
}

export function addRoutine(s: Snapshot, text: string, clock: Clock): 'ok' | 'full' | 'dup' | 'blank' {
  const list: Named[] = s.qyx_routines ?? [];
  if (list.length >= MAX_ROUTINES) return 'full';
  const t = text.trim();
  if (!t) return 'blank';
  if (list.some((r) => String(r.text || '').trim() === t)) return 'dup';
  const now = clock.now();
  const id = stableId('routine_', t + '|' + now + '|' + clock.nonce());
  unbury(s, 'routine', id);
  s.qyx_routines = [...list, { id, text: t, updatedAt: now }]
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0) || String(a.id).localeCompare(String(b.id)));
  return 'ok';
}

export function removeRoutine(s: Snapshot, id: string, clock: Clock) {
  s.qyx_routines = (s.qyx_routines ?? []).filter((r) => String(r.id) !== String(id));
  bury(s, 'routine', id, clock);
}

/* ================= 打转区 / 待选 / 定过的 ================= */

export type AddOptResult = 'opts' | 'bench' | 'dup';

export function addToOpts(s: Snapshot, text: string, clock: Clock): AddOptResult {
  unbury(s, 'opt', text);
  const opts = s.qyx_opts ?? [];
  const bench = s.qyx_bench ?? [];
  if (opts.includes(text) || bench.includes(text)) return 'dup';
  if (opts.length >= MAX_OPTS) {
    s.qyx_bench = [...bench, text];
    rememberOpt(s, text, clock.now());
    return 'bench';
  }
  s.qyx_opts = [...opts, text];
  rememberOpt(s, text, clock.now());
  return 'opts';
}

/** ⌄ 这次不掷它. (No tombstone: `opt` is shared by both lists.) */
export function benchOpt(s: Snapshot, text: string) {
  const opts = s.qyx_opts ?? [];
  const at = opts.indexOf(text);
  if (at < 0) return;
  s.qyx_opts = opts.filter((_, k) => k !== at);
  if (!(s.qyx_bench ?? []).includes(text)) s.qyx_bench = [...(s.qyx_bench ?? []), text];
}

export function removeOpt(s: Snapshot, text: string, clock: Clock) {
  const opts = s.qyx_opts ?? [];
  const at = opts.indexOf(text);
  if (at < 0) return;
  s.qyx_opts = opts.filter((_, k) => k !== at);
  bury(s, 'opt', text, clock);
}

/** ⌃ 放回打转区. Returns false when the 打转区 is full. */
export function benchBack(s: Snapshot, text: string): boolean {
  const opts = s.qyx_opts ?? [];
  const bench = s.qyx_bench ?? [];
  const at = bench.indexOf(text);
  if (at < 0) return true;
  if (opts.length >= MAX_OPTS) return false;
  s.qyx_bench = bench.filter((_, k) => k !== at);
  s.qyx_opts = [...opts, text];
  return true;
}

export function removeBench(s: Snapshot, text: string, clock: Clock) {
  const bench = s.qyx_bench ?? [];
  const at = bench.indexOf(text);
  if (at < 0) return;
  s.qyx_bench = bench.filter((_, k) => k !== at);
  bury(s, 'opt', text, clock);
}

/** F2: unburies `ongoing` (legacy never did, so a re-added item was dropped by the next merge). */
export function pushOngoing(s: Snapshot, text: string, clock: Clock) {
  unbury(s, 'ongoing', text);
  const list = s.qyx_ongoing ?? [];
  if (list.some((o) => o.text === text)) return;
  const now = clock.now();
  s.qyx_ongoing = [{ id: now, text, t: now }, ...list].slice(0, MAX_ONGOING);
}

/** 就这个: logs the dice, takes it out of the 打转区 (F1: with a tombstone) and puts it into 定过的. */
export function acceptDice(s: Snapshot, text: string, clock: Clock) {
  addLog(s, { type: 'dice', text }, clock);
  s.qyx_opts = (s.qyx_opts ?? []).filter((o) => o !== text);
  bury(s, 'opt', text, clock);
  pushOngoing(s, text, clock);
}

/** 动不了的时候 -> 就这个. */
export function acceptMicro(s: Snapshot, text: string, clock: Clock) {
  addLog(s, { type: 'dice', text }, clock);
}

/** ✓ on a 定过的 chip. */
export function completeOngoing(s: Snapshot, id: number | string, clock: Clock): boolean {
  const o = (s.qyx_ongoing ?? []).find((x) => x.id === id);
  if (!o) return false;
  s.qyx_ongoing = (s.qyx_ongoing ?? []).filter((x) => x.id !== id);
  bury(s, 'ongoing', o.text, clock);
  addLog(s, { type: 'done', text: o.text, src: '定过的' }, clock);
  return true;
}

/** Pick for 交给随机: never the same twice in a row when there is a choice. */
export function pickRandom(pool: string[], last: string | null | undefined, rand: () => number): string {
  let pick: string;
  do { pick = pool[Math.floor(rand() * pool.length)]; } while (pool.length > 1 && last === pick);
  return pick;
}

/** 动作池: the dice pool plus this month's split texts. */
export function microPool(s: Snapshot, clock: Clock): string[] {
  const splits: string[] = [];
  (s.qyx_months?.[ymNow(clock)] || []).forEach((a) => (a.splits || []).forEach((x: any) => splits.push(x.text || x)));
  return [...new Set([...currentDicePool(s), ...splits])];
}

/* ================= 往日写过的事项 ================= */

export function pastOptsHistory(s: Snapshot, clock: Clock) {
  const day = today(clock);
  const doneTexts = new Set((s.qyx_log || []).filter((e) => e.type === 'done').map((e) => String(e.text || '').trim()));
  const routineTexts = new Set((s.qyx_routines || []).map((r) => String(r.text || '').trim()));
  const opts = s.qyx_opts || [];
  const bench = s.qyx_bench || [];
  const inPlay = new Set<string>();
  (s.qyx_enough?.items || []).forEach((x) => {
    const t = String(x.text || '').trim();
    if (t) inPlay.add(t);
    (x.subs || []).forEach((k) => { const st = String(k.text || '').trim(); if (st) inPlay.add(st); });
  });
  const seen = new Set<string>();
  return (s.qyx_opts_hist || [])
    .filter((item) => {
      const t = String(item.text || '').trim();
      return dayKey(item.t) !== day && !isDead(s, 'ohist', optsHistKey(item))
        && !doneTexts.has(t) && !opts.includes(item.text) && !bench.includes(item.text) && !inPlay.has(t) && !routineTexts.has(t);
    })
    .sort((a, b) => b.t - a.t)
    .filter((item) => {
      const t = String(item.text || '').trim();
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

export function editOptsHist(s: Snapshot, key: string, value: string, clock: Clock): 'ok' | 'empty' | 'same' | 'gone' {
  const next = value.trim();
  if (!next) return 'empty';
  const hist = s.qyx_opts_hist ?? [];
  const cur = hist.find((x) => optsHistKey(x) === key);
  if (!cur) return 'gone';
  if (next === cur.text) return 'same';
  bury(s, 'ohist', optsHistKey(cur), clock);
  cur.text = next;
  unbury(s, 'ohist', optsHistKey(cur));
  return 'ok';
}

export function removeOptsHist(s: Snapshot, key: string, clock: Clock) {
  s.qyx_opts_hist = (s.qyx_opts_hist ?? []).filter((x) => optsHistKey(x) !== key);
  bury(s, 'ohist', key, clock);
}

/* ================= Bonus ================= */

export function bonusNeedsEnsure(s: Snapshot, clock: Clock) {
  return !s.qyx_bonus || s.qyx_bonus.d !== today(clock);
}

export function ensureBonus(s: Snapshot, clock: Clock): BonusDay {
  const day = today(clock);
  let b = s.qyx_bonus;
  if (!b || b.d !== day) {
    if (b && b.items && b.items.some((i) => i.text)) s.qyx_bonus_prev = b;
    b = s.qyx_bonus = { d: day, items: [{ text: '', done: false }, { text: '', done: false }] };
  }
  return b;
}

export function setBonusText(s: Snapshot, i: number, value: string, clock: Clock): boolean {
  const b = ensureBonus(s, clock);
  if (!b.items[i] || b.items[i].text === value) return false;
  b.items[i].text = value;
  return true;
}

export function toggleBonus(s: Snapshot, i: number, clock: Clock): boolean | null {
  const b = ensureBonus(s, clock);
  const it = b.items[i];
  if (!it || !it.text.trim()) return null;
  it.done = !it.done;
  if (it.done) addLog(s, { type: 'bonus', text: it.text }, clock);
  return it.done;
}

/* ================= 问一问 ================= */

export interface AiContext { timeStr: string; optStr: string; threeStr: string; ruleStr: string }

export function aiContext(s: Snapshot, clock: Clock): AiContext {
  const now = new Date(clock.now());
  const timeStr = `现在是${now.getHours()}点${pad(now.getMinutes())}分`;
  const opts = s.qyx_opts ?? [];
  const optStr = opts.length ? `用户今天的事项区里有：${opts.map((o, i) => `${i + 1}.${o}`).join('；')}。` : '';
  const threeArr = (s.qyx_enough?.items || []).filter((i) => (i.text || '').trim());
  const status = (i: EnoughItem) => enoughStatus(i);
  const threeStr = threeArr.length
    ? `用户今天留下的三件：${threeArr.filter((i) => status(i) !== 'deleted').map((i) => `${i.text}${status(i) === 'completed' ? '（已完成）' : status(i) === 'expired' ? '（时间结束）' : ''}`).join('；')}。`
    : '';
  const rules = s.qyx_rules ?? [];
  const ruleStr = rules.length ? `用户给自己立过的决策准则：${rules.slice(0, 12).map((r, i) => `${i + 1}.${r.text}`).join('；')}。` : '';
  return { timeStr, optStr, threeStr, ruleStr };
}

export function aiFirstSystem(ctx: AiContext): string {
  const { timeStr, optStr, threeStr, ruleStr } = ctx;
  return `${timeStr}。${threeStr}${optStr}${ruleStr}用户带着一个决策卡点来。先在心里完成判断（不输出思考过程）：
第一步，判断本次真正要优化什么——不套固定规则，每次重新判断。常见维度：
- 碎片时间利用：离下一个固定时间点还剩多久？哪个候选能完整装进这个窗口？
- 可中断性：哪个候选一旦展开就难收摊？窗口小的时候避开它。
- 精力与身体状态、长期目标推进、晚间收尾。
截止点/时间窗口是最常见的隐藏约束，永远先算时间。
第二步，若用户消息里已流露倾向，优先确认其倾向，不另起炉灶。

输出恰好按此格式（只写两行，总共不超过60字，大白话）：
第1行：「这次按X算：」+一句关键约束。例：「这次按碎片时间算：离验血只剩24分钟。」
第2行：裁决+第一步，动词开头，具体到现在就能做。例：「做YTWL，现在摆好垫子。」

规则：
- 有适用旧准则直接用并点明「按你的准则：X」。
- 纠结成本明显高于事情本身：第1行写「这题不值得纠结」，第2行随便定一个+第一步。
- 大额金钱、重大健康决定、重要关系不拍板，改说「这个值得慢慢想」+一句原因。
- 不解释利弊清单，不安慰，不抒情，不用「她」。`;
}

export function aiArgueSystem(ctx: AiContext): string {
  const { timeStr, optStr, threeStr, ruleStr } = ctx;
  return `${timeStr}。${threeStr}${optStr}${ruleStr}用户对上一轮裁决追问或不服。把这条新消息当作对「本次优化什么」的修正信息：
重新判断优化维度，输出三行（总≤70字）：第1行写新的关键约束；第2行写裁决+立即行动；第3行必须写「下次：」+从这次反驳中提炼出的具体准则（≤20字）。
严格禁止：复述或评论对话过程（禁说「你刚才说」「你驳我」）；揣测用户动机（禁说「你其实是怕/在意…」）；为上一轮裁决辩护。只输出重新判断后的结果。
维持原判时，第1行必须给出新信息为何不改变框架的那个约束，而不是重复旧理由。`;
}

/** The first user turn: the textarea, or a stand-in when it is empty. */
export function aiFirstUser(s: Snapshot, typed: string): string {
  const ctx = typed.trim();
  const msg = ctx || ((s.qyx_opts ?? []).length ? '（没写背景，看选项和时间直接切）' : '（没写选项也没写背景，就是卡住了，给一个此刻就能动的最小动作）');
  return stripRefs(s.qyx_log || [], msg);
}

export const aiArgueUser = (s: Snapshot, answer: string) => stripRefs(s.qyx_log || [], answer.trim());

/** A successful first round is logged with the raw textarea as `q`. */
export function logAiFirst(s: Snapshot, reply: string, typed: string, clock: Clock) {
  return addLog(s, { type: 'ai', text: reply, q: typed.trim() || '（没写背景，直接切）' }, clock);
}

export function logAiArgue(s: Snapshot, reply: string, answer: string, clock: Clock) {
  return addLog(s, { type: 'ai', text: reply, q: '不服：' + answer.trim() }, clock);
}

/** 存准则 seed: the 下次 line of the reply, else the whole reply. */
export function ruleSeed(reply: string): string {
  const nl = reply.split('\n').find((l) => l.includes('下次'));
  return nl ? nl.replace(/^下次[：:]?\s*/, '').trim() : reply.trim();
}

export function saveRule(s: Snapshot, text: string, clock: Clock): 'saved' | 'dup' | 'blank' {
  const v = text.trim();
  if (!v) return 'blank';
  unbury(s, 'rule', v);
  const rules = s.qyx_rules ?? [];
  if (rules.some((x) => x.text === v)) return 'dup';
  s.qyx_rules = [{ id: clock.now(), t: clock.now(), text: v }, ...rules].slice(0, 30);
  return 'saved';
}

/** F5: matches by id when the rule has one, otherwise by text. */
export function removeRule(s: Snapshot, rule: { id?: unknown; text: string }, clock: Clock) {
  s.qyx_rules = (s.qyx_rules ?? []).filter((x) => (rule.id !== undefined && rule.id !== null ? x.id !== rule.id : x.text !== rule.text));
  bury(s, 'rule', rule.text, clock);
}
