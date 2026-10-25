// @vitest-environment jsdom
/* Render smoke: both pages draw from a snapshot and write nothing while rendering. */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { initState } from '../src/app/state';
import GoalsPage from '../src/pages/goals';
import SeaPage from '../src/pages/sea';
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
const DAY = 864e5;
const data = {
  qyx_months: { '2026-10': [{ id: 'goal_a', text: '合成 目标', kind: 'goal', done: false, splits: [{ text: '合成 小项', done: false }], hist: [] }] },
  qyx_habits: [{ id: 1, name: '合成 站起来', counts: {}, updatedAt: 1 }],
  qyx_bottles: [{ id: 7, t: T0 - 3 * DAY, text: '合成 旧瓶子', followups: [] }],
  qyx_log: [{ id: 'rec_1', t: T0 - 40 * DAY, type: 'note', text: '合成 旧记录' }],
};

describe('pages render without writing', () => {
  it('goals page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const store = kv(data);
    initState(store, fixedClock());
    store.writes.length = 0; // the app's own boot work is not the page's
    const el = document.createElement('div');
    await act(() => { render(h(GoalsPage, {}), el); });
    expect(el.textContent).toContain('成长地图');
    expect(el.textContent).toContain('合成 目标');
    expect(el.textContent).toContain('合成 站起来');
    expect(store.writes).toEqual([]);
    vi.useRealTimers();
  });

  it('goals page opens a new month with one write (carry-over), once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const store = kv({ qyx_months: { '2026-09': [{ id: 'goal_p', text: '合成 观察', kind: 'watch', done: false, splits: [], hist: [] }] } });
    initState(store, fixedClock());
    store.writes.length = 0; // the app's own boot work is not the page's
    const el = document.createElement('div');
    await act(() => { render(h(GoalsPage, {}), el); });
    expect(store.writes.filter((k) => k === 'qyx_months')).toHaveLength(1);
    expect(el.textContent).toContain('合成 观察');
    vi.useRealTimers();
  });

  it('sea page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const store = kv(data);
    initState(store, fixedClock());
    store.writes.length = 0; // the app's own boot work is not the page's
    const el = document.createElement('div');
    await act(() => { render(h(SeaPage, {}), el); });
    expect(el.textContent).toContain('海里漂着 1 个瓶子。');
    expect(el.textContent).toContain('事件图回望');
    expect(store.writes).toEqual([]);
    vi.useRealTimers();
  });
});
