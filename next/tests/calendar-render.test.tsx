// @vitest-environment jsdom
/* Calendar render smoke: 42 cells, stars/dots/today, no writes while rendering. Run with TZ=Asia/Shanghai. */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { initState, now } from '../src/app/state';
import { route } from '../src/app/router';
import RecordPage from '../src/pages/record';
import { fixedClock, T0 } from './helpers/parity';

function kv(initial: Record<string, unknown>) {
  const m = new Map<string, string>(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const writes: string[] = [];
  return {
    writes,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { writes.push(k); m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}
const H = 36e5;
const data = {
  qyx_log: [
    { id: 'rec_a', t: T0, type: 'note', text: '合成记录 A', starredAt: T0 + 1 },
    { id: 'rec_b', t: T0 + H, type: 'note', text: '合成记录 B' },
    { id: 'rec_c', t: T0 - 3 * 864e5, type: 'note', text: '合成记录 C' },
  ],
};

async function mount(params: string[]) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  const store = kv(data);
  initState(store, fixedClock());
  store.writes.length = 0;
  now.value = T0;
  route.value = { page: 'record', params };
  const el = document.createElement('div');
  await act(() => { render(h(RecordPage, {}), el); });
  return { el, store };
}
afterEach(() => vi.useRealTimers());

describe('calendar render', () => {
  it('month view: 42 cells, today ringed, star, dots, no writes', async () => {
    const { el, store } = await mount(['cal', '2026-10']);
    expect(el.querySelectorAll('.cal-cell').length).toBe(42);
    expect(el.textContent).toContain('2026年10月');
    expect(el.querySelector('.cal-cell.today')?.getAttribute('data-day')).toBe('2026-10-24');
    expect(el.querySelector('[data-day="2026-10-24"] .cal-star')).not.toBeNull();
    expect(el.querySelectorAll('[data-day="2026-10-24"] .cal-dots i').length).toBe(2);
    expect(el.querySelector('.cal-starred')?.textContent).toContain('合成记录 A');
    expect(store.writes).toEqual([]);
  });

  it('day view: header, whole day, star button; no writes', async () => {
    const { el, store } = await mount(['day', '2026-10-24']);
    expect(el.textContent).toContain('10月24日 星期六');
    expect(el.textContent).toContain('合成记录 B');
    expect(el.querySelectorAll('.rec-compact').length).toBe(2);
    expect(el.querySelectorAll('.star-btn[aria-pressed="true"]').length).toBe(1);
    expect(store.writes).toEqual([]);
  });

  it('empty day offers 去写一笔', async () => {
    const { el } = await mount(['day', '2026-10-01']);
    expect(el.textContent).toContain('去写一笔');
  });
});
