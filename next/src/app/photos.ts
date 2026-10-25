/*
 * App-wide photo service: one PhotoService bound to the GitHub token, an upload loop, and a
 * status signal for the UI. See core/photos.ts for the storage design.
 */
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { PhotoDB, PhotoRepo, PhotoService, type PhotoStatus } from '../core/photos';
import { IS_PREVIEW, getApp } from './state';

export const photoStatus = signal<PhotoStatus>({ pending: 0, lastError: '' });

let service: PhotoService | null = null;
let repo: { token: string; repo: PhotoRepo } | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;

export function photos(): PhotoService {
  service ||= new PhotoService(new PhotoDB(), () => {
    const token = IS_PREVIEW ? '' : getApp().store.token;
    if (!token) return null;
    if (!repo || repo.token !== token) repo = { token, repo: new PhotoRepo(token) };
    return repo.repo;
  });
  return service;
}

/** Upload whatever is queued; while anything is left, try again in a minute. */
export async function drainPhotos() {
  clearTimeout(retry);
  try {
    photoStatus.value = await photos().drain();
  } catch (e) {
    photoStatus.value = { pending: photoStatus.value.pending, lastError: (e as Error).message };
  }
  if (photoStatus.value.pending) retry = setTimeout(() => void drainPhotos(), 60_000);
}

export function startPhotoUploads() {
  if (typeof indexedDB === 'undefined') return;
  void drainPhotos();
  window.addEventListener('online', () => void drainPhotos());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void drainPhotos(); });
}

/** Object URL for a photo path, or null while it is not available (retries every 20 s). */
export function usePhotoUrl(path: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => photos().url(path).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else timer = setTimeout(load, 20_000);
    });
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, [path]);
  return url;
}
