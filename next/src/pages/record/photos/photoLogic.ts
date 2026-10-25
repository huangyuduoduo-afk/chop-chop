/*
 * Pure helpers for the photo UI (no DOM, no storage): grid choice, draft photo list edits,
 * the pick → prepare → stage pipeline and the "commit, then drain" save step. Everything that
 * touches IndexedDB, canvas or the record store is injected so it can be tested in node.
 */
import type { PhotoRef } from '../../../core/types';

export const MAX_PHOTOS = 9;
/** Wait this long for a thumbnail before saying it has not arrived on this device yet. */
export const LATE_MS = 1500;

/** 1 photo = wide, 2–4 = two columns, more = three. */
export const gridColumns = (n: number): 1 | 2 | 3 => (n <= 1 ? 1 : n <= 4 ? 2 : 3);

export const photoAlt = (index: number, total: number) => `图片 ${index + 1}/${total}`;

/** Tile aspect ratio (w/h): a single photo is shown wide but never taller than 4:5 or flatter than 2:1. */
export function tileAspect(n: number, ref: Pick<PhotoRef, 'w' | 'h'> | undefined): number {
  if (n !== 1) return 1;
  const r = ref && ref.w > 0 && ref.h > 0 ? ref.w / ref.h : 4 / 3;
  return Math.min(2, Math.max(0.8, r));
}

export const roomLeft = (have: number, max = MAX_PHOTOS) => Math.max(0, max - have);

export const isImageFile = (f: { type?: string }) => /^image\//i.test(f.type || '');

/** Keep image files only, and only as many as still fit. `dropped` = images that did not fit. */
export function planPick<F extends { type?: string }>(files: ArrayLike<F>, have: number, max = MAX_PHOTOS) {
  const images = Array.from(files).filter(isImageFile);
  const room = roomLeft(have, max);
  return { accepted: images.slice(0, room), dropped: Math.max(0, images.length - room), ignored: files.length - images.length };
}

/* ---------------- draft photo list ---------------- */

/** Photos stored in a draft come back from localStorage: accept only well-formed refs. */
export function readDraftPhotos(raw: unknown): PhotoRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PhotoRef[] = [];
  for (const p of raw) {
    const r = p as Partial<PhotoRef> | null;
    if (!r || typeof r.id !== 'string' || typeof r.path !== 'string' || typeof r.thumb !== 'string' || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r as PhotoRef);
  }
  return out.slice(0, MAX_PHOTOS);
}

/** Append; ignores duplicates and anything past the limit. */
export function addRef(list: PhotoRef[], ref: PhotoRef, max = MAX_PHOTOS): PhotoRef[] {
  if (list.length >= max || list.some((p) => p.id === ref.id)) return list;
  return [...list, ref];
}

export const removeRef = (list: PhotoRef[], id: string): PhotoRef[] => list.filter((p) => p.id !== id);

export function moveRef(list: PhotoRef[], id: string, delta: -1 | 1): PhotoRef[] {
  const i = list.findIndex((p) => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/* ---------------- pick → prepare → stage ---------------- */

export interface PickDeps {
  /** Photos the record/draft already has. */
  have: number;
  max?: number;
  prepare: (file: File, id: string, now: number) => Promise<{ ref: PhotoRef; full: Blob; thumb: Blob }>;
  /** Store blobs locally + queue upload (PhotoService.stage). */
  stage: (ref: PhotoRef, full: Blob, thumb: Blob) => Promise<void>;
  newId: () => string;
  now: () => number;
  /** Called after each photo is safely staged, so callers can persist it right away. */
  onStaged?: (ref: PhotoRef) => void | Promise<void>;
  /** Called when a file starts / stops being worked on (drives the placeholder tiles). */
  onWork?: (delta: 1 | -1) => void;
}

export interface PickResult { added: PhotoRef[]; errors: string[]; dropped: number }

/** One file at a time; a bad file never stops the others. Nothing is returned that was not staged. */
export async function stagePicked(files: ArrayLike<File>, deps: PickDeps): Promise<PickResult> {
  const plan = planPick(files, deps.have, deps.max ?? MAX_PHOTOS);
  const added: PhotoRef[] = [];
  const errors: string[] = [];
  deps.onWork && plan.accepted.forEach(() => deps.onWork!(1));
  for (const file of plan.accepted) {
    try {
      const { ref, full, thumb } = await deps.prepare(file, deps.newId(), deps.now());
      await deps.stage(ref, full, thumb);
      added.push(ref);
      await deps.onStaged?.(ref);
    } catch (e) {
      errors.push(e instanceof Error && e.message ? e.message : '这张图片没存下来');
    } finally {
      deps.onWork?.(-1);
    }
  }
  return { added, errors, dropped: plan.dropped };
}

/** Message for the toast after a pick, or '' when everything went through. */
export function pickNotice(r: PickResult, max = MAX_PHOTOS): string {
  const parts: string[] = [];
  if (r.errors.length) parts.push(r.errors[0] + (r.errors.length > 1 ? `（共 ${r.errors.length} 张）` : ''));
  if (r.dropped) parts.push(`最多 ${max} 张，多出的 ${r.dropped} 张没有加入`);
  return parts.join('；');
}

/**
 * The save step after staging: commit the record (with its photo refs), and only if that worked
 * kick off the upload. A failed or throwing commit leaves the staged photos untouched in the draft.
 */
export function commitThenDrain<R>(hasPhotos: boolean, doCommit: () => R, isOk: (r: R) => boolean, drain: () => void): R {
  const r = doCommit();
  if (hasPhotos && isOk(r)) drain();
  return r;
}

/* ---------------- viewer ---------------- */

export const clampIndex = (i: number, n: number) => Math.min(Math.max(0, i), Math.max(0, n - 1));

/** -1 = next photo (swipe left), 1 = previous, 0 = not a horizontal swipe. */
export function swipeStep(dx: number, dy: number, min = 48): -1 | 0 | 1 {
  if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.4) return 0;
  return dx < 0 ? -1 : 1;
}

/* ---------------- settings ---------------- */

/** The outbox holds two files per photo (full + thumbnail). */
export const pendingPhotos = (outboxItems: number) => Math.ceil(outboxItems / 2);

export const needsPermissionHelp = (err: string) => /权限|令牌|token/i.test(err || '');

export const newPhotoId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
