/* Photo storage service (fake GitHub + fake IndexedDB) and moments domain. Run with TZ=Asia/Shanghai. */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { PhotoDB, PhotoRepo, PhotoService } from '../src/core/photos';
import type { LogEntry, PhotoRef, Snapshot } from '../src/core/types';
import { attachPhotos, dayHighlights, detachPhoto, monthGrid, toggleStar } from '../src/domain/moments';

const T0 = Date.parse('2026-10-24T09:00:00+08:00');
const clock = { now: () => T0, nonce: () => 'n' };

/** Minimal GitHub: /user and /repos/:o/:r/contents/:path (PUT, GET json/raw, DELETE). */
function fakeGitHub(opts: { failPuts?: number; status?: number } = {}) {
  const files = new Map<string, string>();
  let failPuts = opts.failPuts || 0;
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)); const method = init.method || 'GET';
    calls.push(method + ' ' + url.pathname);
    if (opts.status) return new Response('{}', { status: opts.status });
    if (url.pathname === '/user') return Response.json({ login: 'owner' });
    const m = url.pathname.match(/^\/repos\/owner\/chopchop-photos\/contents\/(.+)$/);
    if (!m) return new Response('{}', { status: 404 });
    const path = m[1];
    if (method === 'PUT') {
      if (failPuts-- > 0) return new Response('{}', { status: 502 });
      if (files.has(path)) return new Response('{}', { status: 422 });
      files.set(path, JSON.parse(String(init.body)).content);
      return Response.json({});
    }
    if (method === 'DELETE') { files.delete(path); return Response.json({}); }
    if (!files.has(path)) return new Response('{}', { status: 404 });
    const raw = new Headers(init.headers).get('Accept') === 'application/vnd.github.raw';
    return raw ? new Response(Uint8Array.from(atob(files.get(path)!), (c) => c.charCodeAt(0))) : Response.json({ sha: 'sha-' + path });
  }) as typeof fetch;
  return { files, calls, fetchImpl };
}

const ref = (id: string): PhotoRef => ({ id, path: `p/2026/10/${id}.jpg`, thumb: `t/2026/10/${id}.jpg`, w: 1600, h: 1200, bytes: 3, t: T0 });
const blob = (s: string) => new Blob([s], { type: 'image/jpeg' });

function service(gh: ReturnType<typeof fakeGitHub>, name = 'db' + Math.random()) {
  const db = new PhotoDB(new IDBFactory(), name);
  let n = 0;
  return { db, svc: new PhotoService(db, () => new PhotoRepo('tok', gh.fetchImpl), () => T0 + n++, () => 'blob:' + ++n) };
}

describe('photo service', () => {
  it('stages locally, uploads both files, and serves from cache', async () => {
    const gh = fakeGitHub();
    const { svc } = service(gh);
    await svc.stage(ref('a'), blob('FULL'), blob('THUMB'));
    expect(await svc.drain()).toEqual({ pending: 0, lastError: '' });
    expect([...gh.files.keys()].sort()).toEqual(['p/2026/10/a.jpg', 't/2026/10/a.jpg']);
    expect(atob(gh.files.get('p/2026/10/a.jpg')!)).toBe('FULL');
    expect(await svc.url('p/2026/10/a.jpg')).toMatch(/^blob:/);
  });

  it('keeps the photo queued through failures and retries until uploaded', async () => {
    const gh = fakeGitHub({ failPuts: 3 });
    const { svc } = service(gh);
    await svc.stage(ref('b'), blob('F'), blob('T'));
    const first = await svc.drain();
    expect(first.pending).toBe(2);
    expect(first.lastError).toContain('上传图片失败');
    await svc.drain();
    expect(await svc.drain()).toEqual({ pending: 0, lastError: '' });
    expect(gh.files.size).toBe(2);
  });

  it('treats an already-uploaded file as done (idempotent retry)', async () => {
    const gh = fakeGitHub();
    gh.files.set('p/2026/10/c.jpg', btoa('F'));
    gh.files.set('t/2026/10/c.jpg', btoa('T'));
    const { svc } = service(gh);
    await svc.stage(ref('c'), blob('F'), blob('T'));
    expect(await svc.drain()).toEqual({ pending: 0, lastError: '' });
  });

  it('another device fetches from the private repo through the API', async () => {
    const gh = fakeGitHub();
    await service(gh).svc.stage(ref('d'), blob('F'), blob('T')).then(() => undefined);
    await service(gh, 'x').svc.drain(); // nothing queued in this db
    const writer = service(gh, 'w');
    await writer.svc.stage(ref('d'), blob('FULL-D'), blob('T'));
    await writer.svc.drain();
    const reader = service(gh, 'r');
    expect(await reader.svc.url('p/2026/10/d.jpg')).toMatch(/^blob:/);
    expect(gh.calls.some((c) => c === 'GET /repos/owner/chopchop-photos/contents/p/2026/10/d.jpg')).toBe(true);
  });

  it('stops on a permission error and explains it', async () => {
    const gh = fakeGitHub({ status: 403 });
    const { svc } = service(gh);
    await svc.stage(ref('e'), blob('F'), blob('T'));
    const out = await svc.drain();
    expect(out.pending).toBe(2);
    expect(out.lastError).toContain('权限');
    expect(gh.calls.length).toBe(1);
  });

  it('discard removes local copies and deletes from the repo', async () => {
    const gh = fakeGitHub();
    const { svc, db } = service(gh);
    await svc.stage(ref('f'), blob('F'), blob('T'));
    await svc.drain();
    await svc.discard(ref('f'));
    expect(await db.getBlob('p/2026/10/f.jpg')).toBeUndefined();
    await svc.drain();
    expect(gh.files.size).toBe(0);
  });

  it('no token: nothing is lost, everything stays queued', async () => {
    const db = new PhotoDB(new IDBFactory(), 'nt');
    const svc = new PhotoService(db, () => null);
    await svc.stage(ref('g'), blob('F'), blob('T'));
    expect(await svc.drain()).toMatchObject({ pending: 2 });
    expect(await svc.url('p/2026/10/g.jpg')).toBeTruthy();
  });
});

const rec = (id: string, hour: number, text: string, extra: Partial<LogEntry> = {}): LogEntry =>
  ({ id, t: Date.parse(`2026-10-24T${String(hour).padStart(2, '0')}:00:00+08:00`), updatedAt: 1, type: 'note', text, mood: null, ...extra });

describe('moments', () => {
  const base = (): Snapshot => ({
    qyx_log: [
      rec('r1', 8, '早上'),
      rec('r2', 10, '一段比较长的记录'.repeat(11)),
      rec('r3', 12, '午饭', { images: [ref('p1')] }),
      rec('r4', 15, '下午'),
      rec('r5', 20, 'AI 的回答', { type: 'ai' }),
      rec('r6', 21, '晚上记了一句心情', { mood: '开心' }),
    ],
  });

  it('starred first, then rule picks, shown in time order', () => {
    const s = base();
    toggleStar(s, 'r4', clock);
    expect(dayHighlights(s, '2026-10-24').map((h) => [h.entry.id, h.why])).toEqual([['r2', 'auto'], ['r3', 'auto'], ['r4', 'star']]);
  });

  it('never picks machine rows; empty-ish days give fewer highlights', () => {
    const s: Snapshot = { qyx_log: [rec('a', 9, '嗯'), rec('b', 10, '答案', { type: 'ai' })] };
    expect(dayHighlights(s, '2026-10-24')).toEqual([]);
  });

  it('star and photo edits bump updatedAt so other devices take them', () => {
    const s = base();
    expect(toggleStar(s, 'r1', clock)).toBe(true);
    expect(s.qyx_log![0].updatedAt).toBe(T0);
    expect(toggleStar(s, 'r1', clock)).toBe(false);
    attachPhotos(s, 'r1', [ref('x'), ref('x')], clock);
    expect(s.qyx_log![0].images!.map((p) => p.id)).toEqual(['x']);
    expect(detachPhoto(s, 'r1', 'x', clock)?.id).toBe('x');
    expect(s.qyx_log![0].images).toBeUndefined();
  });

  it('month grid: Monday first, counts and cover', () => {
    const s = base();
    toggleStar(s, 'r3', clock);
    const g = monthGrid(s, '2026-10');
    expect(g).toHaveLength(42);
    expect(g[0].day).toBe('2026-09-28'); // Oct 1 2026 is a Thursday
    const d = g.find((x) => x.day === '2026-10-24')!;
    expect(d).toMatchObject({ inMonth: true, records: 5, photos: 1, starred: 1 });
    expect(d.cover?.id).toBe('p1');
  });
});

import { submitRecord } from '../src/domain/records';
describe('photo-only note', () => {
  it('empty text is rejected unless the note carries photos', () => {
    const s: Snapshot = {};
    expect(submitRecord(s, { submissionId: 'a', text: '  ' }, clock)).toMatchObject({ ok: false });
    const out = submitRecord(s, { submissionId: 'b', text: '', allowEmpty: true }, clock);
    expect(out).toMatchObject({ ok: true, recordId: 'rec5_b' });
    expect(attachPhotos(s, 'rec5_b', [ref('only')], clock)).toBe(true);
    expect(s.qyx_log![0]).toMatchObject({ text: '', images: [{ id: 'only' }] });
  });
});
