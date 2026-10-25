/* Pure helpers behind the photo UI: layout choice, draft photo list, pick pipeline, save ordering. */
import type { PhotoRef } from '../src/core/types';
import {
  MAX_PHOTOS, addRef, clampIndex, commitThenDrain, gridColumns, moveRef, needsPermissionHelp, pendingPhotos, photoAlt, pickNotice,
  planPick, readDraftPhotos, removeRef, roomLeft, stagePicked, swipeStep, tileAspect,
} from '../src/pages/record/photos/photoLogic';

const ref = (id: string, w = 100, h = 100): PhotoRef => ({ id, path: `p/2026/10/${id}.jpg`, thumb: `t/2026/10/${id}.jpg`, w, h, bytes: 10, t: 1 });
const file = (name: string, type = 'image/jpeg') => ({ name, type }) as unknown as File;

describe('layout', () => {
  it('chooses columns by count', () => {
    expect([1, 2, 3, 4, 5, 9].map(gridColumns)).toEqual([1, 2, 2, 2, 3, 3]);
  });
  it('alt text counts from 1', () => expect(photoAlt(1, 5)).toBe('图片 2/5'));
  it('a single photo is wide but clamped; grids are square', () => {
    expect(tileAspect(1, { w: 4000, h: 1000 })).toBe(2);
    expect(tileAspect(1, { w: 1000, h: 4000 })).toBe(0.8);
    expect(tileAspect(1, { w: 1600, h: 1200 })).toBeCloseTo(4 / 3);
    expect(tileAspect(1, undefined)).toBeCloseTo(4 / 3);
    expect(tileAspect(4, { w: 4000, h: 1000 })).toBe(1);
  });
  it('viewer index and swipe', () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(9, 3)).toBe(2);
    expect(swipeStep(-80, 10)).toBe(-1);
    expect(swipeStep(80, 10)).toBe(1);
    expect(swipeStep(20, 0)).toBe(0);
    expect(swipeStep(60, 80)).toBe(0); // mostly vertical
  });
});

describe('draft photo list', () => {
  it('adds, ignores duplicates, stops at the limit', () => {
    let l: PhotoRef[] = [];
    for (let i = 0; i < 12; i++) l = addRef(l, ref('a' + i));
    expect(l).toHaveLength(MAX_PHOTOS);
    expect(addRef(l.slice(0, 2), ref('a0'))).toHaveLength(2);
  });
  it('removes and reorders without touching the input', () => {
    const l = [ref('a'), ref('b'), ref('c')];
    expect(removeRef(l, 'b').map((p) => p.id)).toEqual(['a', 'c']);
    expect(moveRef(l, 'b', -1).map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(moveRef(l, 'b', 1).map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(moveRef(l, 'a', -1)).toBe(l);
    expect(moveRef(l, 'c', 1)).toBe(l);
    expect(moveRef(l, 'zzz', 1)).toBe(l);
    expect(l.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('reads a draft defensively', () => {
    expect(readDraftPhotos(undefined)).toEqual([]);
    expect(readDraftPhotos('x')).toEqual([]);
    const ok = ref('a');
    expect(readDraftPhotos([ok, null, { id: 1 }, { id: 'b' }, ok, ref('c')]).map((p) => p.id)).toEqual(['a', 'c']);
  });
});

describe('pick planning', () => {
  it('keeps images only and respects room', () => {
    const p = planPick([file('a'), file('b.txt', 'text/plain'), file('c', 'image/png'), file('d')], 7);
    expect(p.accepted).toHaveLength(2);
    expect(p.dropped).toBe(1);
    expect(p.ignored).toBe(1);
    expect(roomLeft(9)).toBe(0);
    expect(roomLeft(12)).toBe(0);
  });
});

function fakes(over: { failPrepare?: string; failStage?: string } = {}) {
  const log: string[] = [];
  let n = 0;
  return {
    log,
    deps: (have = 0) => ({
      have,
      newId: () => 'id' + ++n,
      now: () => 5,
      prepare: async (f: File, id: string) => {
        log.push('prepare:' + f.name);
        if (f.name === over.failPrepare) throw new Error('处理不了');
        return { ref: ref(id), full: new Blob(['f']), thumb: new Blob(['t']) };
      },
      stage: async (r: PhotoRef) => {
        log.push('stage:' + r.id);
        if (r.id === over.failStage) throw new Error('存储空间不足');
      },
      onStaged: (r: PhotoRef) => { log.push('staged:' + r.id); },
    }),
  };
}

describe('pick → stage → commit → drain', () => {
  it('stages each photo before anything is committed, then drains after the commit', async () => {
    const f = fakes();
    const res = await stagePicked([file('a'), file('b')], f.deps());
    expect(res.added.map((r) => r.id)).toEqual(['id1', 'id2']);
    const out = commitThenDrain(true, () => { f.log.push('commit'); return { ok: true }; }, (r) => r.ok, () => f.log.push('drain'));
    expect(out.ok).toBe(true);
    expect(f.log).toEqual(['prepare:a', 'stage:id1', 'staged:id1', 'prepare:b', 'stage:id2', 'staged:id2', 'commit', 'drain']);
  });

  it('no drain when the commit reports failure or throws; text-only saves never drain', () => {
    const log: string[] = [];
    commitThenDrain(true, () => ({ ok: false }), (r) => r.ok, () => log.push('drain'));
    expect(() => commitThenDrain(true, () => { throw new Error('quota'); }, () => true, () => log.push('drain'))).toThrow('quota');
    commitThenDrain(false, () => ({ ok: true }), (r) => r.ok, () => log.push('drain'));
    expect(log).toEqual([]);
  });

  it('a file that fails to prepare is reported and does not block the others', async () => {
    const f = fakes({ failPrepare: 'bad' });
    const res = await stagePicked([file('bad'), file('good')], f.deps());
    expect(res.added).toHaveLength(1);
    expect(res.errors).toEqual(['处理不了']);
    expect(pickNotice(res)).toBe('处理不了');
    expect(f.log).not.toContain('staged:id1');
  });

  it('a failed stage never reaches onStaged (nothing half-saved)', async () => {
    const f = fakes({ failStage: 'id1' });
    const res = await stagePicked([file('a')], f.deps());
    expect(res.added).toEqual([]);
    expect(res.errors).toEqual(['存储空间不足']);
    expect(f.log).toEqual(['prepare:a', 'stage:id1']);
  });

  it('respects the limit and says so', async () => {
    const f = fakes();
    const res = await stagePicked([file('a'), file('b'), file('c')], f.deps(8));
    expect(res.added).toHaveLength(1);
    expect(res.dropped).toBe(2);
    expect(pickNotice(res)).toContain('最多 9 张');
  });

  it('reports work start/stop symmetrically', async () => {
    const f = fakes({ failPrepare: 'a' });
    let n = 0;
    const seen: number[] = [];
    await stagePicked([file('a'), file('b')], { ...f.deps(), onWork: (d) => { n += d; seen.push(n); } });
    expect(seen).toEqual([1, 2, 1, 0]);
  });
});

describe('settings helpers', () => {
  it('counts photos, not files', () => {
    expect([0, 1, 2, 3, 4].map(pendingPhotos)).toEqual([0, 1, 1, 2, 2]);
  });
  it('detects permission problems', () => {
    expect(needsPermissionHelp('上传图片失败：令牌没有图片仓库 chopchop-photos 的读写权限，去设置里换一个')).toBe(true);
    expect(needsPermissionHelp('GitHub: 500')).toBe(false);
    expect(needsPermissionHelp('')).toBe(false);
  });
});
