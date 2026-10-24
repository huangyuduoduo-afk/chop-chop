/*
 * Shared data primitives used by every area. Domain functions take a draft Snapshot
 * (already a private copy inside `commit`) and mutate it; they never touch storage.
 *
 * Ports of legacy helpers: bury/unbury, addLog, tag indexing. Keep semantics identical
 * — old clients merge what these write.
 */
import { Tombstones } from '../core/merge';
import type { LogEntry, Snapshot, Tag } from '../core/types';
import { stableId, type Clock } from '../core/util';

/* ---------------- tombstones ---------------- */

export function bury(s: Snapshot, scope: string, value: string | number, clock: Clock) {
  const d = new Tombstones(s.qyx_dead);
  d.bury(scope, value, clock.now());
  s.qyx_dead = d.list;
}

export function unbury(s: Snapshot, scope: string, value: unknown) {
  const d = new Tombstones(s.qyx_dead);
  const before = d.list.length;
  d.unbury(scope, value);
  if (d.list.length !== before) s.qyx_dead = d.list;
}

export function isDead(s: Snapshot, scope: string, value: unknown): boolean {
  return new Tombstones(s.qyx_dead).has(scope, value);
}

/* ---------------- tags ---------------- */

export function normalizeTagPath(raw: string): string {
  return String(raw || '').replace(/^#+/, '').split('/').map((x) => x.trim()).filter(Boolean).join('/');
}

/** `#a/b` style tags in free text, in order, unique. Same rules as legacy parseTagPaths. */
export function parseTagPaths(text: string): string[] {
  const out: string[] = [];
  String(text || '').replace(/#([^\s#，。！？；：、]+)/g, (m, v: string) => {
    const p = normalizeTagPath(v.replace(/[\]\[()（）【】{}<>《》"'“”‘’.,!?;:]+$/g, ''));
    if (p && !out.includes(p)) out.push(p);
    return m;
  });
  return out;
}

/** Create the tag chain for a path; returns the leaf id, or null if blocked by a tombstone. */
export function ensureTagPath(s: Snapshot, raw: string, clock: Clock, revive = true): string | null {
  const path = normalizeTagPath(raw);
  if (!path) return null;
  const tags: Tag[] = (s.qyx_tags ||= []);
  let parent: string | null = null;
  let full = '';
  for (const name of path.split('/')) {
    full = full ? full + '/' + name : name;
    const id = stableId('tag_', full);
    if (!revive && isDead(s, 'tag', id)) return null;
    if (revive) unbury(s, 'tag', id);
    let t = tags.find((x) => x.id === id || (x.parent_id === parent && x.name === name));
    if (!t) {
      const now = clock.now();
      t = { id, name, parent_id: parent, created_time: now, updated_time: now };
      tags.push(t);
    }
    parent = t.id;
  }
  return parent;
}

/** Legacy indexRecordTags: `force` replaces the record's tags with what its text says now. */
export function indexRecordTags(s: Snapshot, e: LogEntry, clock: Clock, force = false): string[] {
  const rt = (s.qyx_record_tags ||= {});
  const parsed = parseTagPaths(e.text).map((p) => ensureTagPath(s, p, clock, force)).filter((x): x is string => !!x);
  rt[e.id] = force || rt[e.id] === undefined ? parsed : [...new Set([...(rt[e.id] || []), ...parsed])];
  return rt[e.id];
}

/* ---------------- log ---------------- */

export interface NewLog {
  type: LogEntry['type'];
  text: string;
  mood?: string | null;
  src?: string | null;
  q?: string | null;
  /** v5 composer submissions: record id becomes `rec5_<submissionId>` and repeat submits are no-ops. */
  submissionId?: string;
  extra?: Partial<LogEntry>;
}

/** Append a record (legacy addLog). Returns the entry; for a known submissionId, the existing one. */
export function addLog(s: Snapshot, input: NewLog, clock: Clock): LogEntry {
  const log = (s.qyx_log ||= []);
  if (input.submissionId) {
    const existing = log.find((e) => e.id === 'rec5_' + input.submissionId);
    if (existing) return existing;
  }
  const now = clock.now();
  const entry: LogEntry = {
    id: input.submissionId ? 'rec5_' + input.submissionId : stableId('rec_', now + '|' + clock.nonce()),
    t: now,
    updatedAt: now,
    type: input.type,
    text: input.text,
    mood: input.mood || null,
    src: input.src || (null as any),
    q: input.q || (null as any),
    ...(input.submissionId ? { submissionId: input.submissionId } : {}),
    ...(input.extra || {}),
  };
  log.push(entry);
  indexRecordTags(s, entry, clock, true);
  return entry;
}

export const findLog = (s: Snapshot, id: string) => (s.qyx_log || []).find((e) => e.id === id);

/**
 * Legacy initTagSystem, run at boot and after every cloud merge: every record gets an id
 * and its #tags indexed (union with what is stored, tombstoned tags stay dead).
 * Returns true if anything changed. Writes are "silent" (not a user edit).
 */
export function indexAllRecordTags(s: Snapshot, clock: Clock): boolean {
  const before = JSON.stringify([s.qyx_log, s.qyx_tags, s.qyx_record_tags]);
  (s.qyx_log || []).forEach((e, i) => {
    if (!e.id) e.id = stableId('rec_', (e.t || 0) + '|' + (e.type || '') + '|' + (e.text || '') + '|' + i);
    indexRecordTags(s, e, clock, false);
  });
  return JSON.stringify([s.qyx_log, s.qyx_tags, s.qyx_record_tags]) !== before;
}
