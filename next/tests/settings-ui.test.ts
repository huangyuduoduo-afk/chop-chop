// @vitest-environment jsdom
/* Render smoke test for the settings pages (synthetic data, in-memory storage). */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { initState, snapshot } from '../src/app/state';
import { route } from '../src/app/router';
import SettingsPage from '../src/pages/settings';
import { stableId } from '../src/core/util';

const T0 = Date.parse('2026-10-24T09:00:00+08:00');
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const tid = (p: string) => stableId('tag_', p);

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(SettingsPage, {}), host));
  return host;
}
const go = (...params: string[]) => act(() => { route.value = { page: 'settings', params }; });

describe('settings pages render', () => {
  const kv = mem();
  kv.setItem('qyx_ghtoken', JSON.stringify('ghp_SYNTHETIC_TOKEN'));
  kv.setItem('qyx_key', JSON.stringify('sk-SYNTHETIC_KEY'));
  kv.setItem('qyx_log', JSON.stringify([{ id: 'rec_1', t: T0 - 1000, updatedAt: T0 - 1000, type: 'note', text: '合成 记录 #学习/英语' }]));
  kv.setItem('qyx_tags', JSON.stringify([
    { id: tid('学习'), name: '学习', parent_id: null, created_time: 1, updated_time: 1 },
    { id: tid('学习/英语'), name: '英语', parent_id: tid('学习'), created_time: 2, updated_time: 2 },
  ]));
  kv.setItem('qyx_record_tags', JSON.stringify({ rec_1: [tid('学习/英语')] }));
  initState(kv as any);

  it('main page never shows the token or key', () => {
    go();
    const host = mount();
    expect(host.textContent).toContain('云同步（GitHub）');
    expect(host.textContent).toContain('下载完整备份');
    expect(host.innerHTML).not.toContain('SYNTHETIC');
    const pw = [...host.querySelectorAll('input[type=password]')] as HTMLInputElement[];
    expect(pw).toHaveLength(2);
    expect(pw.every((i) => i.value === '')).toBe(true);
    expect(snapshot.value.qyx_log).toHaveLength(1);
  });

  it('export center', () => {
    go('export');
    const host = mount();
    expect(host.textContent).toContain('导出中心');
    expect(host.textContent).toContain('下载 Markdown');
    expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(5);
  });

  it('tag library, tree toggle, detail', () => {
    go('tags');
    const host = mount();
    expect(host.textContent).toContain('#学习');
    expect(host.textContent).toContain('1 条记录');
    const toggle = host.querySelector('.tag-toggle:not(.spacer)') as HTMLButtonElement;
    act(() => toggle.click());
    expect(host.textContent).toContain('#英语');
    expect(JSON.parse(kv.getItem('qyx_tag_tree_open')!)).toEqual([tid('学习')]);
    go('tags', tid('学习/英语'));
    const d = mount();
    expect(d.textContent).toContain('#学习/英语');
    expect(d.textContent).toContain('合成 记录 #学习/英语');
    go('tags', 'tag_missing');
    expect(mount().textContent).toContain('这个标签已经不在了。');
  });
});
