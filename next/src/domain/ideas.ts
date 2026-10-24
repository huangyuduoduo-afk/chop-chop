/*
 * 消息盒子 (qyx_ideas_v5): ideas, links, events and checklist tasks.
 *
 * Port of assets/v5.js. Rules that matter on the wire:
 *  - rows are merged by id, newer `updatedAt` wins, so every change bumps `updatedAt`
 *    (strictly: max(now, old + 1)) and removal is soft (`removedAt`).
 *  - one record has at most ONE active owner idea. Legacy enforced it only in the UI; here every
 *    domain function that attaches/moves a record enforces it.
 */
import { enoughStatus } from '../core/merge';
import type { EnoughItem, Idea, IdeaLink, IdeasState, LogEntry, PlanTask, Snapshot } from '../core/types';
import { dayKey, type Clock } from '../core/util';
import { addDoneLogOnce, removeDoneLogToday } from './shared';
import { excerptText } from './refs';

/* ---------------- icons ---------------- */

export const IDEA_ICONS: { key: string; name: string }[] = [
  { key: 'star', name: '小星星' }, { key: 'sprout', name: '小芽' }, { key: 'cup', name: '杯子' },
  { key: 'note', name: '便笺' }, { key: 'camera', name: '相机' }, { key: 'plane', name: '小飞机' },
  { key: 'flower', name: '小花' }, { key: 'wave', name: '海浪' }, { key: 'light', name: '灯泡' },
  { key: 'bottle', name: '小瓶子' },
];
export const iconKey = (k: unknown): string => (IDEA_ICONS.some((i) => i.key === k) ? (k as string) : 'star');

/* ---------------- reading ---------------- */

const EMPTY = (): IdeasState => ({ schema: 2, items: [], links: [], events: [], tasks: [] });

/** Read-only view (never mutates the snapshot). */
export function readIdeas(s: Snapshot): IdeasState {
  const v = s.qyx_ideas_v5;
  return v ? { ...EMPTY(), ...v } : EMPTY();
}
/** Write access: creates the state and normalises schema to 2 like legacy mergeState. */
export function ideasForWrite(s: Snapshot): IdeasState {
  const st = (s.qyx_ideas_v5 ||= EMPTY());
  st.schema = 2;
  st.items ||= []; st.links ||= []; st.events ||= []; st.tasks ||= [];
  return st;
}

export const findIdea = (s: Snapshot, id: string | null | undefined): Idea | undefined =>
  id ? readIdeas(s).items.find((i) => i.id === id && !i.removedAt) : undefined;
export const liveIdeas = (s: Snapshot): Idea[] => readIdeas(s).items.filter((i) => !i.removedAt);
export const ideaLinks = (s: Snapshot, ideaId: string): IdeaLink[] =>
  readIdeas(s).links.filter((l) => l.ideaId === ideaId && !l.removedAt);
export const logRecord = (s: Snapshot, id: string): LogEntry | undefined => (s.qyx_log || []).find((r) => r.id === id);

/** Active owner link of a record (first by state order, like legacy `owner`). */
export function ownerOf(s: Snapshot, recordId: string): IdeaLink | undefined {
  const st = readIdeas(s);
  return st.links.find((l) => l.recordId === recordId && !l.removedAt && st.items.some((i) => i.id === l.ideaId && !i.removedAt));
}

export const findTask = (s: Snapshot, id: string): PlanTask | undefined => readIdeas(s).tasks.find((t) => t.id === id && !t.removedAt);
export function recordTasks(s: Snapshot, recordId: string): PlanTask[] {
  return readIdeas(s).tasks
    .filter((t) => t.recordId === recordId && !t.removedAt)
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
}

export function ideaTitle(s: Snapshot, i: Idea): string {
  if (i.title) return i.title;
  const root = logRecord(s, i.rootRecordId);
  const src = root?.text || recordTasks(s, i.rootRecordId).map((t) => t.text).join('、') || '暂存的想法';
  return excerptText(src.split(/[\n。！？]/)[0]).slice(0, 32);
}

/** "Update time" shown and sorted by: newest of creation and any linked record. */
export function contentTime(s: Snapshot, i: Idea): number {
  const times = ideaLinks(s, i.id).map((l) => {
    const r = logRecord(s, l.recordId);
    return r ? Number(r.updatedAt) || r.t : 0;
  });
  return Math.max(i.createdAt || 0, ...times);
}

export type IdeaFilter = 'all' | 'open' | 'completed';
export type IdeaOrder = 'recent' | 'oldest-update' | 'created-new' | 'created-old';

export function listIdeas(s: Snapshot, opts: { filter?: IdeaFilter; query?: string; order?: IdeaOrder } = {}): Idea[] {
  const { filter = 'all', query = '', order = 'recent' } = opts;
  const needle = query.trim().toLocaleLowerCase();
  const hits = (i: Idea) => ideaLinks(s, i.id).map((l) => logRecord(s, l.recordId))
    .filter((r): r is LogEntry => !!r && (r.text.toLocaleLowerCase().includes(needle) || recordTasks(s, r.id).some((t) => t.text.toLocaleLowerCase().includes(needle))));
  const list = liveIdeas(s).filter((i) => (filter === 'all' || i.status === filter) && (!needle || ideaTitle(s, i).toLocaleLowerCase().includes(needle) || hits(i).length));
  const created = order.startsWith('created');
  const desc = order === 'recent' || order === 'created-new';
  return list.sort((a, b) => {
    const av = created ? a.createdAt : contentTime(s, a);
    const bv = created ? b.createdAt : contentTime(s, b);
    return (desc ? bv - av : av - bv) || a.id.localeCompare(b.id);
  });
}

/** Search hits (records) of one idea, newest first. */
export function ideaHits(s: Snapshot, i: Idea, query: string): LogEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return ideaLinks(s, i.id).map((l) => logRecord(s, l.recordId))
    .filter((r): r is LogEntry => !!r && (r.text.toLocaleLowerCase().includes(needle) || recordTasks(s, r.id).some((t) => t.text.toLocaleLowerCase().includes(needle))))
    .sort((a, b) => b.t - a.t);
}

/* ---------------- helpers ---------------- */

/** Safe id token from the clock nonce (ids must match /^[-\w:.]+$/). */
export const token = (clock: Clock) => clock.nonce().replace(/[^-\w:.]/g, '_');
export const bump = (prev: number | undefined, now: number) => Math.max(now, (prev || 0) + 1);

export function validDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T12:00:00');
  return Number.isFinite(d.getTime()) && dayKey(d.getTime()) === v;
}
export const todayKey = (clock: Clock) => dayKey(clock.now());
export function tomorrowKey(clock: Clock) {
  const d = new Date(clock.now());
  d.setDate(d.getDate() + 1);
  return dayKey(d.getTime());
}

/** Insert or revive a link by id (a retired link with the same id is reused, never duplicated). */
function upsertLink(st: IdeasState, link: { id: string; ideaId: string; recordId: string; role: 'root' | 'update' }, now: number): IdeaLink {
  const old = st.links.find((l) => l.id === link.id);
  if (old) {
    Object.assign(old, { ideaId: link.ideaId, recordId: link.recordId, role: link.role, linkedAt: now, updatedAt: bump(old.updatedAt, now) });
    delete old.removedAt;
    return old;
  }
  const l: IdeaLink = { ...link, linkedAt: now, updatedAt: now };
  st.links.push(l);
  return l;
}

/* ---------------- today mirror (qyx_enough rows that mirror a task / idea) ---------------- */

const todayRows = (s: Snapshot, clock: Clock): EnoughItem[] =>
  s.qyx_enough && s.qyx_enough.d === dayKey(clock.now()) ? s.qyx_enough.items || [] : [];

/** Legacy renderEnough reconcile: today's rows follow the task / idea they mirror. */
function reconcileToday(s: Snapshot, clock: Clock) {
  const st = readIdeas(s);
  for (const x of todayRows(s, clock)) {
    if (x.v5TaskId) {
      const t = st.tasks.find((k) => k.id === x.v5TaskId && !k.removedAt);
      if (!t) delete x.v5TaskId;
      else if ((t.updatedAt || 0) > (x.updatedAt || 0)) {
        x.text = t.text; x.done = t.done; x.status = t.done ? 'completed' : 'incomplete'; x.updatedAt = t.updatedAt;
      }
    }
    if (x.v5IdeaId) {
      const idea = st.items.find((k) => k.id === x.v5IdeaId && !k.removedAt);
      if (!idea) delete x.v5IdeaId;
      else if ((idea.statusUpdatedAt || 0) > (x.updatedAt || 0)) {
        x.text = ideaTitle(s, idea); x.done = idea.status === 'completed'; x.status = x.done ? 'completed' : 'incomplete'; x.updatedAt = idea.statusUpdatedAt!;
      }
    }
  }
}

/* ---------------- one owner per record ---------------- */

export type OpResult = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): OpResult => ({ ok: false, reason });

/** 收进消息盒子 → 补充到. Enforces one owner. Does not bump the idea (legacy O16). */
export function addRecordToIdea(s: Snapshot, recordId: string, ideaId: string, clock: Clock): OpResult {
  if (!logRecord(s, recordId)) return fail('记录不存在');
  if (!findIdea(s, ideaId)) return fail('想法不存在');
  const owner = ownerOf(s, recordId);
  if (owner && owner.ideaId === ideaId) return { ok: true };
  if (owner) return fail('这条记录已经属于另一条想法。');
  upsertLink(ideasForWrite(s), { id: `link_${recordId}_${ideaId}`, ideaId, recordId, role: 'update' }, clock.now());
  return { ok: true };
}

/** 作为新想法 (fixes O1): the record becomes the root of a new idea; no new record is made. */
export function createIdeaFromRecord(s: Snapshot, recordId: string, opts: { title?: string; icon?: string }, clock: Clock): { ok: true; ideaId: string } | { ok: false; reason: string } {
  if (!logRecord(s, recordId)) return fail('记录不存在') as { ok: false; reason: string };
  if (ownerOf(s, recordId)) return { ok: false, reason: '这条记录已经属于另一条想法。' };
  const st = ideasForWrite(s);
  const now = clock.now();
  const id = 'idea_' + token(clock);
  st.items.push({ id, title: (opts.title || '').trim(), icon: iconKey(opts.icon), status: 'open', rootRecordId: recordId, createdAt: now, activityAt: now, updatedAt: now });
  upsertLink(st, { id: 'link_' + recordId, ideaId: id, recordId, role: 'root' }, now);
  return { ok: true, ideaId: id };
}

/**
 * 更改归属 / 移出此想法. target null = leave the idea, keep the record in 说说.
 * Root records cannot move. Retires every active link of the record, so no second owner can survive.
 */
export function moveRecord(s: Snapshot, recordId: string, target: string | null, clock: Clock): OpResult {
  const st = ideasForWrite(s);
  const active = st.links.filter((l) => l.recordId === recordId && !l.removedAt && st.items.some((i) => i.id === l.ideaId && !i.removedAt));
  if (!active.length) return fail('这条记录不在任何想法里。');
  if (active.some((l) => l.role === 'root')) return fail('最初记录是这条想法的起点，不能单独移走。');
  if (target && !findIdea(s, target)) return fail('想法不存在');
  const now = clock.now();
  if (target && active.length === 1 && active[0].ideaId === target) return { ok: true };
  for (const l of st.links.filter((k) => k.recordId === recordId && !k.removedAt)) { l.removedAt = now; l.updatedAt = bump(l.updatedAt, now); }
  if (target) upsertLink(st, { id: `link_${recordId}_${target}`, ideaId: target, recordId, role: 'update' }, now);
  return { ok: true };
}

/* ---------------- idea actions ---------------- */

function touchIdea(i: Idea, now: number, status = false) {
  i.updatedAt = bump(i.updatedAt, now);
  if (status) i.statusUpdatedAt = i.updatedAt;
}

export function renameIdea(s: Snapshot, id: string, title: string, clock: Clock): OpResult {
  const i = readIdeas(s).items.find((x) => x.id === id && !x.removedAt);
  if (!i) return fail('想法不存在');
  const prev = ideaTitle(s, i);
  ideasForWrite(s);
  i.title = title.trim();
  touchIdea(i, clock.now(), true);
  if (todayRows(s, clock).some((x) => x.v5IdeaId === id) && i.status === 'completed' && prev !== ideaTitle(s, i)) {
    removeDoneLogToday(s, prev, '三件', clock);
    addDoneLogOnce(s, ideaTitle(s, i), '三件', clock);
  }
  reconcileToday(s, clock);
  return { ok: true };
}

export function setIdeaIcon(s: Snapshot, id: string, icon: string, clock: Clock): OpResult {
  const i = readIdeas(s).items.find((x) => x.id === id && !x.removedAt);
  if (!i) return fail('想法不存在');
  ideasForWrite(s);
  i.icon = iconKey(icon);
  touchIdea(i, clock.now());
  return { ok: true };
}

/** day = YYYY-MM-DD or null to clear. */
export function scheduleIdea(s: Snapshot, id: string, day: string | null, clock: Clock): OpResult {
  const i = readIdeas(s).items.find((x) => x.id === id && !x.removedAt);
  if (!i) return fail('想法不存在');
  if (day && !validDay(day)) return fail('日期格式不正确，安排没有改变。');
  ideasForWrite(s);
  i.scheduledDate = day || null;
  touchIdea(i, clock.now());
  return { ok: true };
}

export function toggleIdeaStatus(s: Snapshot, id: string, clock: Clock): OpResult {
  const i = readIdeas(s).items.find((x) => x.id === id && !x.removedAt);
  if (!i) return fail('想法不存在');
  const st = ideasForWrite(s);
  const prevTitle = ideaTitle(s, i);
  const now = clock.now();
  i.status = i.status === 'completed' ? 'open' : 'completed';
  i.completedAt = i.status === 'completed' ? now : (null as unknown as undefined);
  st.events.push({ id: 'evt_' + token(clock), ideaId: id, event: i.status === 'completed' ? 'completed' : 'open', t: now, updatedAt: now });
  touchIdea(i, now, true);
  if (todayRows(s, clock).some((x) => x.v5IdeaId === id)) {
    if (i.status === 'completed') addDoneLogOnce(s, ideaTitle(s, i), '三件', clock);
    else removeDoneLogToday(s, prevTitle, '三件', clock);
  }
  reconcileToday(s, clock);
  return { ok: true };
}

/** 从消息盒子移除: soft; records, links and tasks stay. */
export function removeIdea(s: Snapshot, id: string, clock: Clock): OpResult {
  const i = readIdeas(s).items.find((x) => x.id === id && !x.removedAt);
  if (!i) return fail('想法不存在');
  ideasForWrite(s);
  i.removedAt = clock.now();
  touchIdea(i, clock.now());
  reconcileToday(s, clock);
  return { ok: true };
}

/* ---------------- checklist tasks ---------------- */

function saveTask(s: Snapshot, t: PlanTask, clock: Clock) {
  t.updatedAt = bump(t.updatedAt, clock.now());
  reconcileToday(s, clock);
}

export function addTask(s: Snapshot, recordId: string, text: string, clock: Clock): PlanTask | null {
  const v = text.trim();
  if (!v || !logRecord(s, recordId)) return null;
  const st = ideasForWrite(s);
  const now = clock.now();
  const t: PlanTask = { id: 'plan_' + token(clock), recordId, text: v, done: false, scheduledDate: null, order: recordTasks(s, recordId).length, createdAt: now, updatedAt: now };
  st.tasks.push(t);
  return t;
}

export function toggleTask(s: Snapshot, taskId: string, clock: Clock): OpResult {
  const t = findTask(s, taskId);
  if (!t) return fail('清单项不存在');
  ideasForWrite(s);
  const inToday = todayRows(s, clock).some((x) => x.v5TaskId === taskId && enoughStatus(x) !== 'deleted');
  t.done = !t.done;
  saveTask(s, t, clock);
  if (inToday) {
    if (t.done) addDoneLogOnce(s, t.text, '三件', clock);
    else removeDoneLogToday(s, t.text, '三件', clock);
  }
  return { ok: true };
}

export function editTask(s: Snapshot, taskId: string, text: string, clock: Clock): OpResult {
  const t = findTask(s, taskId);
  if (!t) return fail('清单项不存在');
  if (!text.trim()) return fail('清单文字不能为空。');
  ideasForWrite(s);
  const inToday = todayRows(s, clock).some((x) => x.v5TaskId === taskId && enoughStatus(x) !== 'deleted');
  const prev = t.text;
  t.text = text.trim();
  if (inToday && t.done && prev !== t.text) {
    removeDoneLogToday(s, prev, '三件', clock);
    addDoneLogOnce(s, t.text, '三件', clock);
  }
  saveTask(s, t, clock);
  return { ok: true };
}

export function scheduleTask(s: Snapshot, taskId: string, day: string | null, clock: Clock): OpResult {
  const t = findTask(s, taskId);
  if (!t) return fail('清单项不存在');
  if (day && !validDay(day)) return fail('日期格式不正确，安排没有改变。');
  ideasForWrite(s);
  t.scheduledDate = day || null;
  saveTask(s, t, clock);
  return { ok: true };
}

export function moveTask(s: Snapshot, taskId: string, dir: 'up' | 'down', clock: Clock): OpResult {
  const t = findTask(s, taskId);
  if (!t) return fail('清单项不存在');
  const rows = recordTasks(s, t.recordId);
  const at = rows.findIndex((x) => x.id === taskId);
  const other = rows[at + (dir === 'up' ? -1 : 1)];
  if (!other) return { ok: true };
  ideasForWrite(s);
  [t.order, other.order] = [other.order, t.order];
  other.updatedAt = bump(other.updatedAt, clock.now());
  saveTask(s, t, clock);
  return { ok: true };
}

/** 删除清单项: soft; the mirrored today row (if any) is blanked. */
export function removeTask(s: Snapshot, taskId: string, clock: Clock): OpResult {
  const t = findTask(s, taskId);
  if (!t) return fail('清单项不存在');
  ideasForWrite(s);
  t.removedAt = clock.now();
  t.updatedAt = bump(t.updatedAt, clock.now());
  for (const x of todayRows(s, clock)) {
    if (x.v5TaskId !== t.id) continue;
    (x as { v5TaskId: string | null }).v5TaskId = null;
    x.text = ''; x.status = 'incomplete'; x.done = false; x.updatedAt = t.updatedAt;
  }
  reconcileToday(s, clock);
  return { ok: true };
}

export const isTaskInToday = (s: Snapshot, taskId: string, clock: Clock) =>
  todayRows(s, clock).some((x) => x.v5TaskId === taskId && enoughStatus(x) !== 'deleted');
