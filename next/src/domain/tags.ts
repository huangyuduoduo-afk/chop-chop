/*
 * Tag library: tree, usage, rename/merge (migrateTag) and delete.
 * Ports of legacy index.html l.1356-1402 and 4837. Writes mutate a draft Snapshot.
 *
 * Deliberate deviations from legacy migrateTag (both wire-compatible):
 *  - rewritten record text bumps `updatedAt`, so other devices (newer updatedAt wins) receive the rename;
 *  - only whole tags are rewritten (`#学习` no longer touches `#学习笔记`); sub-tags (`#学习/高数`) follow.
 */
import type { LogEntry, Snapshot, Tag } from '../core/types';
import type { Clock } from '../core/util';
import { bury, ensureTagPath, normalizeTagPath } from './shared';

export type TagSort = 'recent' | 'count' | 'created';

const tagsOf = (s: Snapshot): Tag[] => s.qyx_tags || [];
export const tagById = (s: Snapshot, id: string) => tagsOf(s).find((t) => t.id === id);

export function tagPath(s: Snapshot, id: string): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let t = tagById(s, id);
  while (t && !seen.has(t.id)) {
    seen.add(t.id);
    parts.unshift(t.name);
    t = t.parent_id ? tagById(s, t.parent_id) : undefined;
  }
  return parts.join('/');
}

/** The tag itself plus all descendants (legacy order: repeated scans). */
export function descendantTagIds(s: Snapshot, id: string): string[] {
  const set = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    tagsOf(s).forEach((t) => {
      if (t.parent_id && set.has(t.parent_id) && !set.has(t.id)) { set.add(t.id); changed = true; }
    });
  }
  return [...set];
}

export function allTagPaths(s: Snapshot): { id: string; path: string }[] {
  return tagsOf(s).map((t) => ({ id: t.id, path: tagPath(s, t.id) })).filter((x) => x.path)
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
}

/** Records carrying the tag or any descendant, newest first. */
export function tagRecordRows(s: Snapshot, id: string): LogEntry[] {
  const wanted = new Set(descendantTagIds(s, id));
  const rt = s.qyx_record_tags || {};
  return (s.qyx_log || []).filter((e) => (rt[e.id] || []).some((t) => wanted.has(t))).sort((a, b) => b.t - a.t);
}

export function tagGoalRows(s: Snapshot, id: string): { ym: string; id: string | number; text: string }[] {
  const wanted = new Set(descendantTagIds(s, id));
  const gt = s.qyx_goal_tags || {};
  const rows: { ym: string; id: string | number; text: string }[] = [];
  Object.keys(s.qyx_months || {}).forEach((ym) => (s.qyx_months![ym] || []).forEach((g) => {
    if ((gt[String(g.id)] || []).some((t) => wanted.has(t))) rows.push({ ym, id: g.id, text: g.text });
  }));
  return rows;
}

export function tagUsage(s: Snapshot, id: string) {
  const rows = tagRecordRows(s, id);
  return { count: rows.length, first: rows.length ? Math.min(...rows.map((e) => e.t)) : 0, recent: rows.length ? Math.max(...rows.map((e) => e.t)) : 0 };
}

export interface TagNode { tag: Tag; count: number; first: number; recent: number; created: number; children: TagNode[] }

/** Roots = tags whose parent is missing. Sorted per level by the chosen key. */
export function tagTree(s: Snapshot, sort: TagSort = 'recent'): TagNode[] {
  const all = tagsOf(s);
  const compare = (a: TagNode, b: TagNode) =>
    sort === 'count' ? b.count - a.count : sort === 'created' ? b.created - a.created : b.recent - a.recent;
  const branch = (parent: string | null, guard: Set<string>): TagNode[] =>
    all.filter((t) => (parent ? t.parent_id === parent : !t.parent_id || !tagById(s, t.parent_id)) && !guard.has(t.id))
      .map((tag): TagNode => {
        const g = new Set(guard).add(tag.id);
        return { tag, ...tagUsage(s, tag.id), created: tag.created_time || 0, children: branch(tag.id, g) };
      })
      .sort(compare);
  return branch(null, new Set());
}

/** Would moving `sourceId` to `targetPath` put it inside its own subtree? */
export function targetInsideSource(s: Snapshot, sourceId: string, targetPath: string): boolean {
  const base = tagPath(s, sourceId);
  const target = normalizeTagPath(targetPath);
  return !!base && (target === base || target.startsWith(base + '/'));
}

function replaceRelationIds(s: Snapshot, map: Record<string, string[]> | null | undefined, mapping: Record<string, string | null>, removed: Set<string>) {
  if (!map) return;
  Object.keys(map).forEach((k) => {
    map[k] = [...new Set((map[k] || []).map((id) => mapping[id] || id).filter((id): id is string => !removed.has(id) && !!tagById(s, id)))];
  });
}

const TAG_TOKEN = /#([^\s#，。！？；：、]+)/g;
const TRAILING = /[\]\[()（）【】{}<>《》"'“”‘’.,!?;:]+$/;

/** Rewrite whole tags `#old` / `#old/sub` to `#new` / `#new/sub`; anything else is left alone. */
export function rewriteTagText(text: string, oldBase: string, newBase: string): string {
  return String(text || '').replace(TAG_TOKEN, (all, v: string) => {
    const trail = (v.match(TRAILING) || [''])[0];
    const core = trail ? v.slice(0, v.length - trail.length) : v;
    const p = normalizeTagPath(core);
    if (p === oldBase || p.startsWith(oldBase + '/')) return '#' + newBase + p.slice(oldBase.length) + trail;
    return all;
  });
}

/**
 * Rename / merge: move the tag and its subtree to `targetPath`. Returns the new id of the moved tag,
 * or null when nothing was done. Throws a user-facing Error for a target inside the tag's own subtree.
 */
export function migrateTag(s: Snapshot, sourceId: string, targetPath: string, clock: Clock): string | null {
  const target = normalizeTagPath(targetPath);
  if (!tagById(s, sourceId) || !target) return null;
  if (targetInsideSource(s, sourceId, target)) throw new Error('新标签不能放进自己的子层级。');
  const oldBase = tagPath(s, sourceId);
  const sourceIds = descendantTagIds(s, sourceId);
  const mapping: Record<string, string | null> = {};
  sourceIds.sort((a, b) => tagPath(s, a).split('/').length - tagPath(s, b).split('/').length).forEach((id) => {
    const old = tagPath(s, id);
    const suffix = old.slice(oldBase.length).replace(/^\//, '');
    mapping[id] = ensureTagPath(s, target + (suffix ? '/' + suffix : ''), clock);
  });
  const removed = new Set(sourceIds);
  replaceRelationIds(s, s.qyx_record_tags, mapping, removed);
  replaceRelationIds(s, s.qyx_goal_tags, mapping, removed);
  replaceRelationIds(s, s.qyx_task_tags, mapping, removed);
  const now = clock.now();
  (s.qyx_log || []).forEach((e) => {
    const next = rewriteTagText(e.text, oldBase, target);
    if (next !== String(e.text || '')) { e.text = next; e.updatedAt = now; }
  });
  s.qyx_tags = tagsOf(s).filter((t) => !removed.has(t.id));
  sourceIds.forEach((id) => bury(s, 'tag', id, clock));
  return mapping[sourceId] ?? null;
}

/** Delete the tag and its subtree from the library and from all relations. Records keep their text. */
export function deleteTag(s: Snapshot, id: string, clock: Clock): string[] {
  const ids = descendantTagIds(s, id);
  const removed = new Set(ids);
  replaceRelationIds(s, s.qyx_record_tags, {}, removed);
  replaceRelationIds(s, s.qyx_goal_tags, {}, removed);
  replaceRelationIds(s, s.qyx_task_tags, {}, removed);
  ids.forEach((x) => bury(s, 'tag', x, clock));
  s.qyx_tags = tagsOf(s).filter((t) => !removed.has(t.id));
  return ids;
}
