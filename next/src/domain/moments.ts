/*
 * Memory moments: photos on records, stars (精选), and the calendar's per-day view.
 *
 * Highlights for a day = the owner's starred records first; if fewer than three, simple
 * rules top it up (photos, longer notes, notes that belong to an idea, a set mood). No AI.
 */
import type { LogEntry, PhotoRef, Snapshot } from '../core/types';
import { dayKey, pad, type Clock } from '../core/util';

const bump = (e: LogEntry, clock: Clock) => { e.updatedAt = Math.max(clock.now(), (e.updatedAt || e.t || 0) + 1); };
const find = (s: Snapshot, id: string) => (s.qyx_log || []).find((e) => e.id === id);

/* ---------------- writes ---------------- */

export function attachPhotos(s: Snapshot, recordId: string, refs: PhotoRef[], clock: Clock): boolean {
  const e = find(s, recordId);
  if (!e || !refs.length) return false;
  const have = new Set((e.images || []).map((p) => p.id));
  const fresh = refs.filter((r) => !have.has(r.id) && (have.add(r.id), true));
  if (!fresh.length) return false;
  e.images = [...(e.images || []), ...fresh];
  bump(e, clock);
  return true;
}

/** Remove one photo from a record; returns its ref so the caller can discard the files. */
export function detachPhoto(s: Snapshot, recordId: string, photoId: string, clock: Clock): PhotoRef | null {
  const e = find(s, recordId);
  const ref = e?.images?.find((p) => p.id === photoId);
  if (!e || !ref) return null;
  e.images = e.images!.filter((p) => p.id !== photoId);
  if (!e.images.length) delete e.images;
  bump(e, clock);
  return ref;
}

export function movePhoto(s: Snapshot, recordId: string, photoId: string, delta: -1 | 1, clock: Clock): boolean {
  const e = find(s, recordId);
  const list = e?.images;
  const i = list ? list.findIndex((p) => p.id === photoId) : -1;
  const j = i + delta;
  if (!e || !list || i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  bump(e, clock);
  return true;
}

export function toggleStar(s: Snapshot, recordId: string, clock: Clock): boolean {
  const e = find(s, recordId);
  if (!e) return false;
  e.starredAt = e.starredAt ? null : clock.now();
  bump(e, clock);
  return !!e.starredAt;
}

/* ---------------- reads ---------------- */

/** Record kinds shown in the day timeline; machine rows (AI answers, dice) stay out. */
const DAY_TYPES = new Set(['note', 'done', 'bonus']);

export function dayEntries(s: Snapshot, day: string): LogEntry[] {
  return (s.qyx_log || []).filter((e) => DAY_TYPES.has(e.type) && dayKey(e.t) === day).sort((a, b) => a.t - b.t);
}

export interface Highlight { entry: LogEntry; why: 'star' | 'auto' }

const linkedRecords = (s: Snapshot) =>
  new Set((s.qyx_ideas_v5?.links || []).filter((l) => !l.removedAt).map((l) => l.recordId));

export function autoScore(e: LogEntry, linked: Set<string>): number {
  if (e.type !== 'note') return e.type === 'done' ? 0.5 : 0;
  const len = String(e.text || '').trim().length;
  return (e.images?.length ? 4 : 0) + (len >= 80 ? 2 : len >= 30 ? 1 : 0) + (linked.has(e.id) ? 1 : 0) + (e.mood ? 1 : 0);
}

/** Up to `max` highlights in time order: all starred, then the best-scoring others (score > 0). */
export function dayHighlights(s: Snapshot, day: string, max = 3): Highlight[] {
  const rows = dayEntries(s, day);
  const starred: Highlight[] = rows.filter((e) => e.starredAt).map((entry) => ({ entry, why: 'star' }));
  const linked = linkedRecords(s);
  const auto: Highlight[] = rows
    .filter((e) => !e.starredAt)
    .map((entry) => ({ entry, score: autoScore(entry, linked) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.t - a.entry.t)
    .slice(0, Math.max(0, max - starred.length))
    .map(({ entry }) => ({ entry, why: 'auto' as const }));
  return [...starred, ...auto].sort((a, b) => a.entry.t - b.entry.t);
}

export interface CalendarDay {
  day: string;
  inMonth: boolean;
  records: number;
  photos: number;
  starred: number;
  cover: PhotoRef | null;
}

/** Monday-first 6×7 grid for `month` ("YYYY-MM"). */
export function monthGrid(s: Snapshot, month: string): CalendarDay[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7));
  const byDay = new Map<string, LogEntry[]>();
  for (const e of s.qyx_log || []) {
    if (!DAY_TYPES.has(e.type)) continue;
    const k = dayKey(e.t);
    if (k.slice(0, 7) !== month) continue;
    (byDay.get(k) || byDay.set(k, []).get(k)!).push(e);
  }
  const out: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const rows = (byDay.get(day) || []).sort((a, b) => a.t - b.t);
    const withPhoto = [...rows.filter((e) => e.starredAt), ...rows].find((e) => e.images?.length);
    out.push({
      day,
      inMonth: day.slice(0, 7) === month,
      records: rows.length,
      photos: rows.reduce((n, e) => n + (e.images?.length || 0), 0),
      starred: rows.filter((e) => e.starredAt).length,
      cover: withPhoto?.images?.[0] || null,
    });
  }
  return out;
}
