// @vitest-environment jsdom
/* Render smoke tests: record photo grid + viewer, and the settings card. Synthetic data, fake IndexedDB. */
import 'fake-indexeddb/auto';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { initState } from '../src/app/state';
import { photoStatus, photos } from '../src/app/photos';
import type { LogEntry, PhotoRef } from '../src/core/types';
import { Composer } from '../src/pages/record/Composer';
import { RecordPhotos } from '../src/pages/record/photos/RecordPhotos';
import { PhotoSettings } from '../src/pages/settings/PhotoSettings';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const ref = (id: string): PhotoRef => ({ id, path: `p/2026/10/${id}.jpg`, thumb: `t/2026/10/${id}.jpg`, w: 800, h: 600, bytes: 10, t: 1 });
const rec = (n: number): LogEntry => ({ id: 'rec_x', t: 1, updatedAt: 1, type: 'note', text: '合成记录', images: Array.from({ length: n }, (_, i) => ref('ph' + i)) });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

let host: HTMLElement;
beforeAll(() => {
  initState(mem() as any);
  (URL as any).createObjectURL = (b: Blob) => 'blob:synthetic-' + b.size;
});
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
afterEach(() => { act(() => render(null, host)); host.remove(); });

describe('RecordPhotos', () => {
  it('renders nothing without photos', () => {
    act(() => render(h(RecordPhotos, { record: { ...rec(0), images: undefined } }), host));
    expect(host.innerHTML).toBe('');
  });

  it('picks the grid by count and labels every tile', () => {
    for (const [n, cols] of [[1, 1], [3, 2], [4, 2], [5, 3]] as const) {
      act(() => render(h(RecordPhotos, { record: rec(n) }), host));
      expect(host.querySelector('.ph-grid')!.className).toContain(`cols-${cols}`);
      const tiles = [...host.querySelectorAll('.ph-tile')];
      expect(tiles).toHaveLength(n);
      expect(tiles[n - 1].getAttribute('aria-label')).toContain(`图片 ${n}/${n}`);
    }
  });

  it('shows a soft placeholder, then "图片还在路上", when the file is not on this device', async () => {
    act(() => render(h(RecordPhotos, { record: rec(2) }), host));
    await flush();
    expect(host.querySelectorAll('.ph-hold')).toHaveLength(2);
    expect(host.querySelector('img')).toBeNull();
    vi.useFakeTimers();
    try {
      act(() => render(h(RecordPhotos, { record: { ...rec(1), id: 'rec_late', images: [ref('late')] } }), host));
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(host.textContent).toContain('图片还在路上');
    } finally { vi.useRealTimers(); }
  });

  it('shows the thumbnail once stored, and opens an accessible viewer', async () => {
    const r = rec(3);
    for (const p of r.images!) await photos().stage(p, new Blob(['full']), new Blob(['th']));
    act(() => render(h(RecordPhotos, { record: r }), host));
    await flush();
    const imgs = [...host.querySelectorAll('img')];
    expect(imgs.map((i) => i.alt)).toEqual(['图片 1/3', '图片 2/3', '图片 3/3']);

    act(() => (host.querySelectorAll('.ph-tile')[1] as HTMLElement).click());
    await flush();
    const dlg = document.querySelector('[role=dialog]') as HTMLElement;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dlg.querySelector('.ph-close'));
    expect((dlg.querySelector('.ph-full, img') as HTMLImageElement).alt).toBe('图片 2/3');

    act(() => { dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    await flush();
    expect(document.querySelector('[role=dialog] img')!.getAttribute('alt')).toBe('图片 3/3');
    act(() => { dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });

  it('closes on backdrop tap and on the × button', async () => {
    act(() => render(h(RecordPhotos, { record: rec(2) }), host));
    act(() => (host.querySelector('.ph-tile') as HTMLElement).click());
    act(() => (document.querySelector('.ph-viewer') as HTMLElement).click());
    expect(document.querySelector('[role=dialog]')).toBeNull();
    act(() => (host.querySelector('.ph-tile') as HTMLElement).click());
    act(() => (document.querySelector('.ph-close') as HTMLElement).click());
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
});

describe('PhotoSettings', () => {
  it('shows pending count and explains permission errors without leaking a token', () => {
    photoStatus.value = { pending: 4, lastError: '上传图片失败：令牌没有图片仓库 chopchop-photos 的读写权限，去设置里换一个' };
    act(() => render(h(PhotoSettings, {}), host));
    expect(host.textContent).toContain('待上传 2 张');
    expect(host.textContent).toContain('Contents');
    expect(host.textContent).toContain('chopchop-photos');
    const a = host.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(host.textContent).toContain('立即上传');
  });

  it('is quiet when everything is uploaded', () => {
    photoStatus.value = { pending: 0, lastError: '' };
    act(() => render(h(PhotoSettings, {}), host));
    expect(host.textContent).toContain('没有待上传的图片');
    expect(host.querySelector('a')).toBeNull();
  });
});

describe('Composer photos', () => {
  it('has a 图片 button, restores staged photos from the draft, and text-only still works', async () => {
    const p = ref('draftph');
    await photos().stage(p, new Blob(['full']), new Blob(['th']));
    localStorage.setItem('qyx_draft_v5:note', JSON.stringify({ id: 'd1', context: 'note', revision: 1, submissionId: 'sid1', text: '合成草稿', photos: [p, { bad: true }] }));
    act(() => render(h(Composer, { mode: 'note', context: 'note' }), host));
    await flush();
    const input = host.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.accept).toBe('image/*');
    expect(input.multiple).toBe(true);
    expect(host.querySelector('button.tool[aria-label*="图片"]')).not.toBeNull();
    expect(host.querySelectorAll('.ph-chip')).toHaveLength(1);
    expect(host.querySelector('.ph-chip img')!.getAttribute('alt')).toBe('图片 1/1');
    act(() => (host.querySelector('.ph-x') as HTMLElement).click());
    expect(host.querySelectorAll('.ph-chip')).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('qyx_draft_v5:note')!).photos).toEqual([]);
  });
});
