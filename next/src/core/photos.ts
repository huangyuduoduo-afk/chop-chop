/*
 * Private photos.
 *
 * Files live in the owner's private GitHub repo (`<owner>/chopchop-photos`), read and written
 * with her token through the API — never through public or guessable URLs. Records only carry
 * PhotoRef metadata (types.ts).
 *
 * Reliability: a photo is compressed and stored in IndexedDB *before* the record is saved, and
 * queued in an outbox. The uploader drains the outbox with retries, so the record never points
 * at a photo that exists nowhere. Blobs stay cached locally for display and offline use.
 * Photos are never sent to AI.
 */
import type { PhotoRef } from './types';

export const PHOTO_REPO_NAME = 'chopchop-photos';
const API = 'https://api.github.com';
const DB_NAME = 'chopchop-photos';
type Fetch = typeof fetch;

/* ---------------- IndexedDB: blob cache + outbox ---------------- */

export interface OutboxItem {
  path: string;
  op: 'put' | 'delete';
  createdAt: number;
  tries: number;
  lastError?: string;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export class PhotoDB {
  private db: Promise<IDBDatabase>;
  constructor(idb: IDBFactory = indexedDB, name = DB_NAME) {
    this.db = new Promise((resolve, reject) => {
      const open = idb.open(name, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('blobs');
        open.result.createObjectStore('outbox', { keyPath: 'path' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  private async store(name: 'blobs' | 'outbox', mode: IDBTransactionMode) {
    return (await this.db).transaction(name, mode).objectStore(name);
  }
  async getBlob(path: string): Promise<Blob | undefined> { return req((await this.store('blobs', 'readonly')).get(path)); }
  async putBlob(path: string, blob: Blob) { await req((await this.store('blobs', 'readwrite')).put(blob, path)); }
  async deleteBlob(path: string) { await req((await this.store('blobs', 'readwrite')).delete(path)); }
  async outbox(): Promise<OutboxItem[]> { return req((await this.store('outbox', 'readonly')).getAll()); }
  async enqueue(path: string, op: OutboxItem['op'], now: number) {
    await req((await this.store('outbox', 'readwrite')).put({ path, op, createdAt: now, tries: 0 } satisfies OutboxItem));
  }
  async updateOutbox(item: OutboxItem) { await req((await this.store('outbox', 'readwrite')).put(item)); }
  async dequeue(path: string) { await req((await this.store('outbox', 'readwrite')).delete(path)); }
}

/* ---------------- GitHub contents client ---------------- */

export class PhotoRepoError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export class PhotoRepo {
  private ownerLogin: Promise<string> | null = null;
  constructor(private token: string, private fetchImpl: Fetch = (...a) => fetch(...a), private repoName = PHOTO_REPO_NAME) {}

  private async call(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
    if (!this.token) throw new PhotoRepoError('先在设置里填 GitHub 令牌');
    return this.fetchImpl(API + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + this.token, Accept: accept, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  }

  private fail(res: Response, what: string): never {
    const hint = res.status === 401 ? '令牌无效或过期'
      : res.status === 403 || res.status === 404 ? `令牌没有图片仓库 ${this.repoName} 的读写权限，去设置里换一个`
      : 'GitHub: ' + res.status;
    throw new PhotoRepoError(`${what}失败：${hint}`, res.status);
  }

  owner(): Promise<string> {
    this.ownerLogin ||= this.call('/user').then(async (r) => (r.ok ? (await r.json()).login : this.fail(r, '读取账号')));
    return this.ownerLogin;
  }

  private async contents(path: string) { return `/repos/${await this.owner()}/${this.repoName}/contents/${path}`; }

  /** Upload; an existing file at the same path counts as success (retries are idempotent). */
  async put(path: string, blob: Blob): Promise<void> {
    const body = JSON.stringify({ message: 'add ' + path, content: toBase64(await blob.arrayBuffer()) });
    const res = await this.call(await this.contents(path), { method: 'PUT', body });
    if (res.ok) return;
    if (res.status === 422) {
      const head = await this.call(await this.contents(path));
      if (head.ok) return;
    }
    this.fail(res, '上传图片');
  }

  async get(path: string): Promise<Blob> {
    const res = await this.call(await this.contents(path), {}, 'application/vnd.github.raw');
    if (!res.ok) this.fail(res, '读取图片');
    return res.blob();
  }

  async remove(path: string): Promise<void> {
    const head = await this.call(await this.contents(path));
    if (head.status === 404) return;
    if (!head.ok) this.fail(head, '删除图片');
    const { sha } = await head.json();
    const res = await this.call(await this.contents(path), { method: 'DELETE', body: JSON.stringify({ message: 'remove ' + path, sha }) });
    if (!res.ok && res.status !== 404) this.fail(res, '删除图片');
  }
}

/* ---------------- service: outbox draining + display URLs ---------------- */

export interface PhotoStatus { pending: number; lastError: string }

export class PhotoService {
  private urls = new Map<string, string>();
  private loading = new Map<string, Promise<string | null>>();
  private draining: Promise<PhotoStatus> | null = null;

  constructor(
    private db: PhotoDB,
    private repo: () => PhotoRepo | null,
    private now: () => number = () => Date.now(),
    private makeUrl: (b: Blob) => string = (b) => URL.createObjectURL(b),
  ) {}

  /** Keep a prepared photo locally and queue both files for upload. Call before saving the record. */
  async stage(ref: PhotoRef, full: Blob, thumb: Blob) {
    await this.db.putBlob(ref.path, full);
    await this.db.putBlob(ref.thumb, thumb);
    await this.db.enqueue(ref.path, 'put', this.now());
    await this.db.enqueue(ref.thumb, 'put', this.now());
  }

  /** Queue deletion of a photo's files in the repo (local copies go now). */
  async discard(ref: PhotoRef) {
    for (const p of [ref.path, ref.thumb]) {
      await this.db.deleteBlob(p);
      await this.db.enqueue(p, 'delete', this.now());
      this.urls.delete(p);
    }
  }

  /** Upload/delete everything queued. Safe to call often; concurrent calls share one run. */
  drain(): Promise<PhotoStatus> {
    this.draining ||= this.run().finally(() => { this.draining = null; });
    return this.draining;
  }

  private async run(): Promise<PhotoStatus> {
    const repo = this.repo();
    let lastError = '';
    const items = await this.db.outbox();
    if (!repo) return { pending: items.length, lastError: items.length ? '先在设置里填 GitHub 令牌' : '' };
    for (const item of items.sort((a, b) => a.createdAt - b.createdAt)) {
      try {
        if (item.op === 'put') {
          const blob = await this.db.getBlob(item.path);
          if (blob) await repo.put(item.path, blob);
        } else {
          await repo.remove(item.path);
        }
        await this.db.dequeue(item.path);
      } catch (e) {
        lastError = (e as Error).message;
        await this.db.updateOutbox({ ...item, tries: item.tries + 1, lastError });
        if (e instanceof PhotoRepoError && (e.status === 401 || e.status === 403 || e.status === 404)) break; // permission problem: stop, don't hammer
      }
    }
    return { pending: (await this.db.outbox()).length, lastError };
  }

  /** Object URL for a stored photo: local cache first, then the private repo. null if unavailable yet. */
  url(path: string): Promise<string | null> {
    const ready = this.urls.get(path);
    if (ready) return Promise.resolve(ready);
    let p = this.loading.get(path);
    if (!p) {
      p = (async () => {
        let blob = await this.db.getBlob(path);
        if (!blob) {
          const repo = this.repo();
          if (!repo) return null;
          try {
            blob = await repo.get(path);
            await this.db.putBlob(path, blob);
          } catch {
            return null; // not uploaded yet by the other device, or offline: caller may retry later
          }
        }
        const u = this.makeUrl(blob);
        this.urls.set(path, u);
        return u;
      })().finally(() => this.loading.delete(path));
      this.loading.set(path, p);
    }
    return p;
  }
}

/* ---------------- browser-only: compress a picked file ---------------- */

export const FULL_EDGE = 1600;
export const THUMB_EDGE = 480;

async function encode(bitmap: ImageBitmap, edge: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
  if (!blob) throw new Error('这张图片处理不了，换一张试试');
  return { blob, w, h };
}

/** Resize to JPEG (long edge 1600) plus a 480px thumbnail. EXIF orientation is applied by the browser. */
export async function preparePhoto(file: Blob, id: string, now: number): Promise<{ ref: PhotoRef; full: Blob; thumb: Blob }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  try {
    const full = await encode(bitmap, FULL_EDGE, 0.82);
    const thumb = await encode(bitmap, THUMB_EDGE, 0.78);
    const d = new Date(now);
    const dir = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const ref: PhotoRef = { id, path: `p/${dir}/${id}.jpg`, thumb: `t/${dir}/${id}.jpg`, w: full.w, h: full.h, bytes: full.blob.size, t: now };
    return { ref, full: full.blob, thumb: thumb.blob };
  } finally {
    bitmap.close?.();
  }
}
