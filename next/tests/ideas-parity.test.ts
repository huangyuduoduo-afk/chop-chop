/* 消息盒子 data writes vs the legacy app (run with TZ=Asia/Shanghai). */
import {
  addRecordToIdea, addTask, editTask, moveRecord, moveTask, removeIdea, removeTask, renameIdea, scheduleIdea,
  scheduleTask, setIdeaIcon, toggleIdeaStatus, toggleTask,
} from '../src/domain/ideas';
import { actionParity, T0 } from './helpers/parity';

const H = 3600_000;
const rec = (id: string, hoursAgo: number, text: string, extra: Record<string, unknown> = {}) => ({
  id, t: T0 - hoursAgo * H, updatedAt: T0 - hoursAgo * H, type: 'note', text, mood: null, src: null, q: null, ...extra,
});
const idea = (id: string, root: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, icon: 'star', status: 'open', rootRecordId: root, createdAt: T0 - 9 * H, activityAt: T0 - 9 * H, updatedAt: T0 - 9 * H, ...extra,
});
const link = (id: string, ideaId: string, recordId: string, role: string) => ({ id, ideaId, recordId, role, linkedAt: T0 - 9 * H, updatedAt: T0 - 9 * H });
const task = (id: string, recordId: string, text: string, order: number) => ({ id, recordId, text, done: false, scheduledDate: null, order, createdAt: T0 - 9 * H, updatedAt: T0 - 9 * H });
const blank = (n: number) => ({ id: 'task_b' + n, text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] });

const seed = () => ({
  qyx_log: [
    rec('rec_a', 20, '合成记录 1'),
    rec('rec5_b', 12, '合成记录 2 根', { submissionId: 'b' }),
    rec('rec5_c', 11, '合成记录 3 补充', { submissionId: 'c' }),
    rec('rec5_d', 10, '合成记录 4 无归属', { submissionId: 'd' }),
  ],
  qyx_ideas_v5: {
    schema: 2,
    items: [idea('idea_one', 'rec5_b', ''), idea('idea_two', 'rec5_x', '第二个想法')],
    links: [link('link_rec5_b', 'idea_one', 'rec5_b', 'root'), link('link_rec5_c', 'idea_one', 'rec5_c', 'update')],
    events: [],
    tasks: [task('plan_t1', 'rec5_c', '合成清单 1', 0), task('plan_t2', 'rec5_c', '合成清单 2', 1)],
  },
});
const withToday = (extra: Record<string, unknown>) => ({
  ...seed(),
  qyx_enough: { d: '2026-10-24', items: [{ id: 'mirror', text: '', done: false, status: 'incomplete', updatedAt: T0 - 3 * H, subs: [], ...extra }, blank(2), blank(3)] },
});

/* ---- legacy DOM driver ---- */
const tick = () => new Promise<void>((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const $ = (w: any, id: string) => w.document.getElementById(id);
function pick(w: any, label: string) {
  const row = [...w.document.querySelectorAll('#appDialogPick .pick-row')].find((b: any) => b.textContent.trim() === label) as any;
  if (!row) throw new Error('no pick row ' + label + ' in ' + [...w.document.querySelectorAll('#appDialogPick .pick-row')].map((b: any) => b.textContent).join('|'));
  row.click();
}
const okDialog = async (w: any) => { $(w, 'appDialogOk').click(); await settle(); };
function typeInto(w: any, el: any, value: string) { el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); }
async function ideaMenu(w: any, id: string, label: string) {
  w.document.querySelector(`[data-menu="${id}"]`).click(); await settle();
  pick(w, label); await settle();
}
async function recordMenu(w: any, id: string, label: string) {
  (w.document.querySelector(`#logList .entry[data-record-id="${id}"] .ex`) as any).click(); await settle();
  pick(w, label); await settle();
}
async function taskMenu(w: any, id: string, label: string) {
  w.document.querySelector(`[data-task-menu="${id}"]`).click(); await settle();
  pick(w, label); await settle();
}

function normalize(b: any) {
  delete b.qyx_lastchange; delete b.qyx_lastbackup;
  const ts = ['t', 'updatedAt', 'createdAt', 'activityAt', 'statusUpdatedAt', 'completedAt', 'linkedAt', 'removedAt'];
  const zero = (o: any) => { for (const k of ts) if (typeof o?.[k] === 'number' && o[k] >= T0) o[k] = -1; };
  const known = ['rec_a', 'rec5_b', 'rec5_c', 'rec5_d'];
  for (const r of b.qyx_log || []) {
    zero(r);
    if (!known.includes(r.id)) { delete b.qyx_record_tags?.[r.id]; r.id = '<gen>'; }
  }
  for (const d of b.qyx_dead || []) { zero(d); if (d.s === 'log' && !known.includes(d.v)) d.v = '<gen>'; }
  for (const t of b.qyx_tags || []) zero(t);
  const st = b.qyx_ideas_v5;
  for (const k of ['items', 'links', 'events', 'tasks']) st[k].forEach(zero);
  st.events.forEach((e: any) => { e.id = '<evt>'; });
  st.tasks.forEach((t: any) => { if (!/^plan_t\d$/.test(t.id)) t.id = '<plan>'; });
  for (const k of ['items', 'links', 'events']) st[k].sort((a: any, c: any) => a.id.localeCompare(c.id));
  st.tasks.sort((a: any, c: any) => a.recordId.localeCompare(c.recordId) || a.order - c.order || a.text.localeCompare(c.text));
  for (const k of ['qyx_enough', 'qyx_enough_prev']) for (const i of b[k]?.items || []) zero(i);
  b.qyx_log?.sort((a: any, c: any) => String(a.id).localeCompare(String(c.id)) || a.text.localeCompare(c.text));
  return b;
}
const run = (local: any, legacy: (w: any) => Promise<void>, next: (d: any, c: any) => unknown, mask: (b: any) => void = normalize) =>
  actionParity({ local, legacy, next, mask: (b) => { normalize(b); mask(b); } });
const expectSame = (r: { errors: string[]; diffs: string[] }) => { expect(r.errors).toEqual([]); expect(r.diffs).toEqual([]); };

describe('idea writes match legacy', () => {
  it('rename', async () => expectSame(await run(seed(),
    async (w) => { await ideaMenu(w, 'idea_one', '修改标题'); typeInto(w, $(w, 'appDialogLine'), '合成新标题'); await okDialog(w); },
    (d, c) => renameIdea(d, 'idea_one', '合成新标题', c))));

  it('rename back to automatic title', async () => expectSame(await run(seed(),
    async (w) => { await ideaMenu(w, 'idea_two', '修改标题'); typeInto(w, $(w, 'appDialogLine'), '  '); await okDialog(w); },
    (d, c) => renameIdea(d, 'idea_two', '  ', c))));

  it('change icon', async () => expectSame(await run(seed(),
    async (w) => { await ideaMenu(w, 'idea_one', '更换图标'); pick(w, '小飞机'); await settle(); },
    (d, c) => setIdeaIcon(d, 'idea_one', 'plane', c))));

  it('schedule: today / clear / custom date', async () => {
    expectSame(await run(seed(),
      async (w) => { await ideaMenu(w, 'idea_one', '安排到某天'); pick(w, '今天'); await settle(); },
      (d, c) => scheduleIdea(d, 'idea_one', '2026-10-24', c)));
    expectSame(await run(seed(),
      async (w) => { await ideaMenu(w, 'idea_one', '安排到某天'); pick(w, '明天'); await settle(); },
      (d, c) => scheduleIdea(d, 'idea_one', '2026-10-25', c)));
    expectSame(await run(seed(),
      async (w) => { await ideaMenu(w, 'idea_one', '安排到某天'); pick(w, '选择日期'); await settle(); typeInto(w, $(w, 'appDialogLine'), '2026-12-01'); await okDialog(w); },
      (d, c) => scheduleIdea(d, 'idea_one', '2026-12-01', c)));
    expectSame(await run({ ...seed(), qyx_ideas_v5: { ...seed().qyx_ideas_v5, items: [idea('idea_one', 'rec5_b', '', { scheduledDate: '2026-10-30' }), idea('idea_two', 'rec5_x', '第二个想法')] } },
      async (w) => { await ideaMenu(w, 'idea_one', '安排到某天'); pick(w, '清除安排'); await settle(); },
      (d, c) => scheduleIdea(d, 'idea_one', null, c)));
  });

  it('complete, then reopen (events, completedAt, statusUpdatedAt)', async () => {
    expectSame(await run(seed(),
      async (w) => { await ideaMenu(w, 'idea_one', '标记完成'); },
      (d, c) => toggleIdeaStatus(d, 'idea_one', c)));
    expectSame(await run({ ...seed(), qyx_ideas_v5: { ...seed().qyx_ideas_v5, items: [idea('idea_one', 'rec5_b', '', { status: 'completed', completedAt: T0 - 5 * H }), idea('idea_two', 'rec5_x', '第二个想法')] } },
      async (w) => { await ideaMenu(w, 'idea_one', '重新打开'); },
      (d, c) => toggleIdeaStatus(d, 'idea_one', c)));
  });

  it('complete / reopen / rename an idea that is in today\'s three (done log + mirror row)', async () => {
    const today = (done: boolean) => withToday({ id: 'idea_one', v5IdeaId: 'idea_one', text: '合成记录 2 根', done, status: done ? 'completed' : 'incomplete' });
    expectSame(await run(today(false),
      async (w) => { await ideaMenu(w, 'idea_one', '标记完成'); },
      (d, c) => toggleIdeaStatus(d, 'idea_one', c)));
    const doneState = { ...today(true), qyx_ideas_v5: { ...seed().qyx_ideas_v5, items: [idea('idea_one', 'rec5_b', '', { status: 'completed', completedAt: T0 - 5 * H, statusUpdatedAt: T0 - 3 * H }), idea('idea_two', 'rec5_x', '第二个想法')] }, qyx_log: [...seed().qyx_log, { id: 'done_seed', t: T0 - H, updatedAt: T0 - H, type: 'done', text: '合成记录 2 根', src: '三件' }] };
    expectSame(await run(doneState,
      async (w) => { await ideaMenu(w, 'idea_one', '重新打开'); },
      (d, c) => toggleIdeaStatus(d, 'idea_one', c),
      (b) => { for (const r of b.qyx_log) if (r.id === 'done_seed') r.id = 'done_seed'; }));
  });

  it('remove from the box (soft)', async () => expectSame(await run(seed(),
    async (w) => { await ideaMenu(w, 'idea_two', '从消息盒子移除（保留说说）'); await okDialog(w); },
    (d, c) => removeIdea(d, 'idea_two', c))));

  it('收进消息盒子 → 补充到 (link, no idea bump)', async () => expectSame(await run(seed(),
    async (w) => { await recordMenu(w, 'rec5_d', '收进消息盒子'); pick(w, '补充到：第二个想法'); await settle(); },
    (d, c) => addRecordToIdea(d, 'rec5_d', 'idea_two', c))));

  it('更改归属: move to another idea / leave the idea', async () => {
    expectSame(await run(seed(),
      async (w) => { await recordMenu(w, 'rec5_c', '更改归属'); pick(w, '移到：第二个想法'); await settle(); },
      (d, c) => moveRecord(d, 'rec5_c', 'idea_two', c)));
    expectSame(await run(seed(),
      async (w) => { await recordMenu(w, 'rec5_c', '更改归属'); pick(w, '移出此想法，保留说说'); await settle(); },
      (d, c) => moveRecord(d, 'rec5_c', null, c)));
  });

  it('移出此想法 button in the timeline', async () => expectSame(await run(seed(),
    async (w) => { w.document.querySelector('[data-open="idea_one"]').click(); await settle(); w.document.querySelector('[data-unlink="link_rec5_c"]').click(); await settle(); },
    (d, c) => moveRecord(d, 'rec5_c', null, c))));
});

describe('checklist task writes match legacy', () => {
  it('toggle done / undone', async () => {
    expectSame(await run(seed(),
      async (w) => { w.document.querySelector('[data-task-toggle="plan_t1"]').click(); await settle(); },
      (d, c) => toggleTask(d, 'plan_t1', c)));
  });

  it('toggle a task that is in today\'s three (mirror row + done log)', async () => {
    const local = withToday({ id: 'plan_t1', v5TaskId: 'plan_t1', text: '合成清单 1' });
    expectSame(await run(local,
      async (w) => { w.document.querySelector('[data-task-toggle="plan_t1"]').click(); await settle(); },
      (d, c) => toggleTask(d, 'plan_t1', c)));
  });

  it('add a task from the record menu', async () => expectSame(await run(seed(),
    async (w) => { await recordMenu(w, 'rec5_d', '添加清单项'); typeInto(w, $(w, 'appDialogLine'), '合成新清单'); await okDialog(w); },
    (d, c) => addTask(d, 'rec5_d', '合成新清单', c))));

  it('edit text, schedule, move down, delete', async () => {
    expectSame(await run(seed(),
      async (w) => { await taskMenu(w, 'plan_t1', '修改文字'); typeInto(w, $(w, 'appDialogLine'), '合成清单 改'); await okDialog(w); },
      (d, c) => editTask(d, 'plan_t1', '合成清单 改', c)));
    expectSame(await run(seed(),
      async (w) => { await taskMenu(w, 'plan_t1', '安排到某天'); pick(w, '今天'); await settle(); },
      (d, c) => scheduleTask(d, 'plan_t1', '2026-10-24', c)));
    expectSame(await run(seed(),
      async (w) => { await taskMenu(w, 'plan_t1', '下移'); },
      (d, c) => moveTask(d, 'plan_t1', 'down', c)));
    expectSame(await run(seed(),
      async (w) => { await taskMenu(w, 'plan_t1', '删除清单项'); await okDialog(w); },
      (d, c) => removeTask(d, 'plan_t1', c)));
  });

  it('delete a task that is in today\'s three blanks the mirror row', async () => {
    const local = withToday({ id: 'plan_t1', v5TaskId: 'plan_t1', text: '合成清单 1' });
    expectSame(await run(local,
      async (w) => { await taskMenu(w, 'plan_t1', '删除清单项'); await okDialog(w); },
      (d, c) => removeTask(d, 'plan_t1', c)));
  });
});
