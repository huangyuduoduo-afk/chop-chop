/*
 * 说说 records: add (composer), edit, delete, yesterday card.
 *
 * Port of assets/v5.js submitComposer / recordMenu(edit, delete) and legacy renderV3Yesterday.
 * Wire promises: rec5_<submissionId> ids (a repeat submit finds the record, never adds another),
 * edits keep id and `t` and bump `updatedAt` (+ `v5StableId: true`), deletes are tombstones.
 */
import { enoughStatus, enoughSubStatus, logKey, normalizeEnoughSub, syncParentFromSubs } from '../core/merge';
import type { EnoughDay, Idea, IdeaLink, LogEntry, PlanTask, Snapshot } from '../core/types';
import { dayKey, pad, stableId, type Clock } from '../core/util';
import {
  bump, findIdea, ideasForWrite, ownerOf, readIdeas, recordTasks, removeTask, token, toggleTask,
} from './ideas';
import { storageReferences, type RefMap } from './refs';
import { bury, indexRecordTags, isDead } from './shared';

export const MOODS = ['😌', '😄', '😫', '😢', '😪', '🔥', '🥱', '🤯', '🥰', '😤', '🫠', '😶‍🌫️', '🤒', '🌧️', '☀️', '🌱'];

/* ---------------- checklist ---------------- */

export interface ParsedText { text: string; tasks: PlanTask[] }

/** `- [ ] x` / `- [x] x` lines leave the body and become tasks (V:139). */
export function extractChecklist(value: string, recordId: string, clock: Clock): ParsedText {
  const tasks: PlanTask[] = [];
  const body: string[] = [];
  for (const line of String(value || '').split('\n')) {
    const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (!m || !m[2].trim()) { body.push(line); continue; }
    const now = clock.now();
    tasks.push({
      id: 'plan_' + token(clock), recordId, text: m[2].trim(), done: m[1].toLowerCase() === 'x',
      scheduledDate: null, order: tasks.length, createdAt: now, updatedAt: now,
    });
  }
  return { text: body.join('\n').trim(), tasks };
}

/** Editor text of a record: body plus its live checklist lines (so editing never hides tasks, O4/O5). */
export function editableText(s: Snapshot, r: LogEntry): string {
  const lines = recordTasks(s, r.id).map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`);
  return [r.text, ...lines].filter((x) => x !== '').join('\n');
}

/* ---------------- add ---------------- */

export interface SubmitInput {
  submissionId: string;
  /** Text as typed (readable ref labels allowed; `refs` maps them back to tokens). */
  text: string;
  refs?: RefMap | Record<string, string> | null;
  mood?: string | null;
  /** Append to this idea (role `update`). Missing/removed ideas fall back to 说说 only: text is never lost. */
  ideaId?: string | null;
  /** Create a new idea with this record as its root. */
  newIdea?: { title: string; icon: string } | null;
  trace?: { wall: number; active: number } | null;
  /** A photo-only note may have no text. */
  allowEmpty?: boolean;
}
export type SubmitResult =
  | { ok: true; recordId: string; ideaId: string | null; duplicate: boolean }
  | { ok: false; reason: 'empty' };

export function submitRecord(s: Snapshot, input: SubmitInput, clock: Clock): SubmitResult {
  const value = String(input.text || '').trim();
  if (!value && !input.allowEmpty) return { ok: false, reason: 'empty' };
  const sid = input.submissionId;
  const recordId = 'rec5_' + sid;
  const log = (s.qyx_log ||= []);

  // Idempotent: a second submit of the same draft (double tap, retry after crash) is a no-op.
  if (log.some((r) => r.id === recordId) || isDead(s, 'log', recordId)) {
    const link = readIdeas(s).links.find((l) => l.recordId === recordId && !l.removedAt);
    return { ok: true, recordId, ideaId: link?.ideaId ?? (input.newIdea ? 'idea_' + sid : null), duplicate: true };
  }

  const now = clock.now();
  const parsed = extractChecklist(storageReferences(value, input.refs), recordId, clock);
  const r: LogEntry = { id: recordId, t: now, updatedAt: now, type: 'note', text: parsed.text, mood: input.mood || null, submissionId: sid };
  if (input.trace) { r.wall = input.trace.wall; r.active = input.trace.active; }
  log.push(r);
  indexRecordTags(s, r, clock, true);

  let ideaId: string | null = null;
  const needsIdeas = parsed.tasks.length || input.newIdea || input.ideaId;
  if (needsIdeas) {
    const st = ideasForWrite(s);
    st.tasks.push(...parsed.tasks);
    if (input.newIdea) {
      ideaId = 'idea_' + sid;
      st.items.push({
        id: ideaId, title: input.newIdea.title, icon: input.newIdea.icon || 'star', status: 'open',
        rootRecordId: recordId, createdAt: now, activityAt: now, updatedAt: now,
      });
    } else if (input.ideaId && findIdea(s, input.ideaId)) ideaId = input.ideaId;
    if (ideaId) {
      st.links.push({ id: 'link_' + recordId, ideaId, recordId, role: input.newIdea ? 'root' : 'update', linkedAt: now, updatedAt: now });
      const i = st.items.find((x) => x.id === ideaId);
      if (i && !input.newIdea) { i.activityAt = now; i.updatedAt = bump(i.updatedAt, now); }
    }
  }
  return { ok: true, recordId, ideaId, duplicate: false };
}

/* ---------------- edit ---------------- */

export type EditResult = { ok: true } | { ok: false; reason: string };

export function editRecord(s: Snapshot, id: string, text: string, refs: RefMap | Record<string, string> | null | undefined, clock: Clock): EditResult {
  const r = (s.qyx_log || []).find((x) => x.id === id);
  if (!r) return { ok: false, reason: '记录不存在' };
  const value = String(text || '').trim();
  if (!value) return { ok: false, reason: 'empty' };
  const now = clock.now();
  const parsed = extractChecklist(storageReferences(value, refs), r.id, clock);
  r.text = parsed.text;
  r.updatedAt = bump(r.updatedAt || r.t, now);
  (r as { v5StableId: unknown }).v5StableId = true; // wire: boolean true (types.ts says string; only truthiness is read)

  if (parsed.tasks.length || recordTasks(s, r.id).length) reconcileTasks(s, r, parsed.tasks, clock);

  (s.qyx_record_tags ||= {})[r.id] = [];
  indexRecordTags(s, r, clock, true);

  const owner = ownerOf(s, r.id);
  const idea = owner && findIdea(s, owner.ideaId);
  if (idea) { idea.activityAt = r.updatedAt; idea.updatedAt = bump(idea.updatedAt, r.updatedAt); }
  return { ok: true };
}

/**
 * Edited checklist lines vs the record's live tasks (fixes O5): same text keeps the task (done state
 * follows the line), new lines add tasks, lines that vanished soft-remove their task.
 */
function reconcileTasks(s: Snapshot, r: LogEntry, wanted: PlanTask[], clock: Clock) {
  const st = ideasForWrite(s);
  const existing = recordTasks(s, r.id);
  const used = new Set<string>();
  const now = clock.now();
  for (const w of wanted) {
    const hit = existing.find((t) => !used.has(t.id) && t.text === w.text);
    if (!hit) { st.tasks.push(w); continue; }
    used.add(hit.id);
    if (hit.done !== w.done) toggleTask(s, hit.id, clock);
    if (hit.order !== w.order) { hit.order = w.order; hit.updatedAt = bump(hit.updatedAt, now); }
  }
  for (const t of existing) if (!used.has(t.id)) removeTask(s, t.id, clock);
}

/* ---------------- delete ---------------- */

/**
 * Tombstone the record (scope `log`). Also soft-retires its idea links and checklist tasks so nothing
 * dangles; old clients ignore links/tasks whose record is gone, and merge keeps `removedAt`.
 */
export function deleteRecord(s: Snapshot, id: string, clock: Clock): EditResult {
  const log = s.qyx_log || [];
  const r = log.find((x) => x.id === id);
  if (!r) return { ok: false, reason: '记录不存在' };
  bury(s, 'log', logKey(r), clock);
  s.qyx_log = log.filter((x) => x.id !== id);
  if (s.qyx_record_tags) delete s.qyx_record_tags[id];
  const st = s.qyx_ideas_v5;
  if (st) {
    const now = clock.now();
    for (const l of st.links || []) if (l.recordId === id && !l.removedAt) { l.removedAt = now; l.updatedAt = bump(l.updatedAt, now); }
    for (const t of recordTasks(s, id)) removeTask(s, t.id, clock);
  }
  return { ok: true };
}

/* ---------------- list helpers ---------------- */

/** Newest first; only notes and other user-visible rows (marks stay in data, shown like legacy). */
export function recordsNewestFirst(s: Snapshot): LogEntry[] {
  return [...(s.qyx_log || [])].sort((a, b) => b.t - a.t || String(b.id).localeCompare(String(a.id)));
}

export interface DayGroup { day: string; rows: LogEntry[] }
export function groupByDay(rows: LogEntry[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const r of rows) {
    const day = dayKey(r.t);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}

export function dayTitle(day: string, clock: Clock): string {
  const today = dayKey(clock.now());
  const yest = dayKey(clock.now() - 864e5);
  const [, m, d] = day.split('-');
  const base = `${parseInt(m)}月${parseInt(d)}日`;
  return day === today ? '今天 · ' + base : day === yest ? '昨天 · ' + base : base;
}

export function matchRecord(s: Snapshot, r: LogEntry, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return r.text.toLocaleLowerCase().includes(q) || recordTasks(s, r.id).some((t) => t.text.toLocaleLowerCase().includes(q));
}

/** Owner idea of a record, for the row chip. */
export function ownerIdea(s: Snapshot, recordId: string): Idea | undefined {
  const l: IdeaLink | undefined = ownerOf(s, recordId);
  return l ? findIdea(s, l.ideaId) : undefined;
}

/* ---------------- yesterday card ---------------- */

export interface YesterdaySub { text: string; status: 'completed' | 'incomplete' | 'expired'; count: number }
export interface YesterdayItem { text: string; status: 'completed' | 'incomplete'; expired: boolean; progress: number; subs: YesterdaySub[] }
export interface YesterdayView {
  key: string;
  dateLabel: string;
  items: YesterdayItem[];
  completed: number;
  percent: number;
  stats: { cut: number; notes: number; done: number };
  bonus: { text: string; done: boolean }[];
  questions: { q: string; text: string }[];
  insight: string;
  habits: string[];
  /** 补勾 needs the stored daily summary. */
  canFix: boolean;
}

export function cleanAIText(raw: unknown): string {
  return String(raw || '')
    .replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)、]\s*/gm, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/"/g, '')
    .replace(/^[“”]+|[“”]+$/gm, '')
    .split('\n').map((line) => line.trim().replace(/[ \t]+/g, ' ')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function yesterdayReview(s: Snapshot, clock: Clock): YesterdayView {
  const t = clock.now() - 864e5;
  const key = dayKey(t);
  const d = new Date(t);
  const sum = s.qyx_sums?.[key];
  const prev = s.qyx_enough_prev;
  const source: any[] = prev && prev.d === key ? prev.items || [] : sum?.three || [];
  const items: YesterdayItem[] = source
    .filter((i) => i && i.text && String(i.text).trim() && enoughStatus(i) !== 'deleted')
    .slice(0, 3)
    .map((i) => {
      const subs = (i.subs || []).filter((x: any) => x && x.text && String(x.text).trim()).map(normalizeEnoughSub);
      const raw = enoughStatus(i);
      const status = raw === 'completed' ? 'completed' : 'incomplete';
      const doneCount = subs.filter((x: any) => enoughSubStatus(x) === 'completed').length;
      const progress = status === 'completed' ? 100 : subs.length ? Math.round((doneCount / subs.length) * 100) : 0;
      return {
        text: String(i.text), status, expired: raw === 'expired', progress,
        subs: subs.map((x: any) => ({ text: x.text, status: enoughSubStatus(x), count: Math.max(0, Math.floor(+x.c || 0)) || (enoughSubStatus(x) === 'completed' ? 1 : 0) })),
      } as YesterdayItem;
    });
  const completed = items.filter((i) => i.status === 'completed').length;
  const dayLog = (s.qyx_log || []).filter((e) => dayKey(e.t) === key);
  const stats = {
    cut: dayLog.filter((e) => e.type === 'dice' || e.type === 'ai').length,
    notes: dayLog.filter((e) => e.type === 'note').length,
    done: dayLog.filter((e) => e.type === 'done').length,
  };
  const bp = s.qyx_bonus_prev;
  const bonus = (bp && bp.d === key ? bp.items || [] : sum?.bonus || []).filter((i: any) => i.text && String(i.text).trim()).map((i: any) => ({ text: String(i.text), done: !!i.done }));
  const questions = dayLog.filter((e) => e.type === 'ai' && e.q).slice(-2).map((e) => ({ q: String(e.q), text: cleanAIText(e.text) }));
  const insight = sum?.obs
    ? cleanAIText(sum.obs)
    : questions.length ? `昨天你用“问一问”梳理了 ${questions.length} 次，也把当时的选择过程留下来了。`
    : stats.notes ? `昨天你留下了 ${stats.notes} 笔记录，先把当时的自己保存了下来。`
    : '昨天留下的内容不多，空白也可以被回望。';
  return {
    key, dateLabel: `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${WEEK[d.getDay()]}`, items, completed,
    percent: Math.round((completed / 3) * 100), stats, bonus, questions, insight, habits: [...(sum?.habits || [])], canFix: !!sum,
  };
}

/** 补勾: mark a yesterday sub-item done, log it on yesterday (legacy bindSumFix). */
export function fixYesterdaySub(s: Snapshot, itemText: string, subText: string, clock: Clock): EditResult {
  const yk = dayKey(clock.now() - 864e5);
  const sum = s.qyx_sums?.[yk];
  if (!sum) return { ok: false, reason: '昨天还没有总结' };
  const three: any[] = sum.three || [];
  const it = three.find((x) => String(x.text || '').trim() === itemText.trim());
  const sub = it && (it.subs || []).find((x: any) => String(x.text || '').trim() === subText.trim());
  if (!sub) return { ok: false, reason: '找不到这个小项' };
  const now = clock.now();
  sub.status = 'completed'; sub.done = true; if (!(+sub.c > 0)) sub.c = 1;

  const p = s.qyx_enough_prev as EnoughDay | null | undefined;
  if (p && p.d === yk) {
    const pi: any = (p.items || []).find((x) => String(x.text || '').trim() === itemText.trim());
    const ps = pi && (pi.subs || []).find((x: any) => String(x.text || '').trim() === subText.trim());
    if (ps) {
      ps.status = 'completed'; ps.done = true; if (!(+ps.c > 0)) ps.c = 1; ps.updatedAt = now;
      syncParentFromSubs(pi);
    }
  }
  const src = '三件·小项';
  const log = (s.qyx_log ||= []);
  if (!log.some((e) => e.type === 'done' && dayKey(e.t) === yk && (e.src || '') === src && e.text === subText)) {
    log.push({ id: stableId('done_', yk + '|' + subText), t: new Date(yk + 'T23:59:00').getTime(), type: 'done', text: subText, src, updatedAt: now });
  }
  // recountSummary
  const day = log.filter((e) => dayKey(e.t) === yk);
  sum.stats = {
    cut: day.filter((e) => e.type === 'dice').length + day.filter((e) => e.type === 'ai').length,
    notes: day.filter((e) => e.type === 'note').length,
    done: day.filter((e) => e.type === 'done').length,
  };
  for (const x of three) {
    const subs = x.subs || [];
    if (subs.length) { x.done = subs.every((k: any) => k.done); x.status = x.done ? 'completed' : 'incomplete'; }
  }
  return { ok: true };
}

/** Greeting line (legacy logGreet), deterministic given `pick`. */
const GREETS = [
  { h: [5, 11], arr: ['早。今天从哪一笔开始？', '早上好。', '醒了？先记一笔。'] },
  { h: [11, 14], arr: ['中午好。', '吃了吗？顺手记一笔。'] },
  { h: [14, 18], arr: ['下午了。', '下午好，记点什么？'] },
  { h: [18, 22], arr: ['晚上好。', '今天过得怎么样，写两句？'] },
  { h: [22, 29], arr: ['夜里了，写完早点睡。', '还没睡？记完就收。'] },
];
export function greeting(s: Snapshot, clock: Clock, pick: number): string {
  let hr = new Date(clock.now()).getHours();
  if (hr < 5) hr += 24;
  const g = GREETS.find((x) => hr >= x.h[0] && hr < x.h[1]) || GREETS[0];
  const n = (s.qyx_log || []).filter((e) => dayKey(e.t) === dayKey(clock.now()) && e.type === 'note').length;
  return g.arr[pick % g.arr.length] + (n ? ` 今天已记 ${n} 笔。` : '');
}
