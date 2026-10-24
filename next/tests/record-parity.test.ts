/* 说说 data writes vs the legacy app (run with TZ=Asia/Shanghai). */
import { deleteRecord, editRecord, fixYesterdaySub, submitRecord } from '../src/domain/records';
import { actionParity, T0 } from './helpers/parity';

const H = 3600_000;
const rec = (id: string, hoursAgo: number, text: string, extra: Record<string, unknown> = {}) => ({
  id, t: T0 - hoursAgo * H, updatedAt: T0 - hoursAgo * H, type: 'note', text, mood: null, src: null, q: null, ...extra,
});
const idea = (id: string, root: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, icon: 'star', status: 'open', rootRecordId: root, createdAt: T0 - 9 * H, activityAt: T0 - 9 * H, updatedAt: T0 - 9 * H, ...extra,
});
const link = (id: string, ideaId: string, recordId: string, role: string) => ({ id, ideaId, recordId, role, linkedAt: T0 - 9 * H, updatedAt: T0 - 9 * H });

export const seed = () => ({
  qyx_log: [
    rec('rec_a', 20, '合成记录 1 #标签甲'),
    rec('rec5_b', 12, '合成记录 2 根', { submissionId: 'b' }),
    rec('rec5_c', 11, '合成记录 3 补充', { submissionId: 'c' }),
    rec('rec5_d', 10, '合成记录 4 无归属', { submissionId: 'd' }),
  ],
  qyx_ideas_v5: {
    schema: 2,
    items: [idea('idea_one', 'rec5_b', ''), idea('idea_two', 'rec5_x', '第二个想法')],
    links: [link('link_rec5_b', 'idea_one', 'rec5_b', 'root'), link('link_rec5_c', 'idea_one', 'rec5_c', 'update')],
    events: [],
    tasks: [{ id: 'plan_t1', recordId: 'rec5_c', text: '合成清单 1', done: false, scheduledDate: null, order: 0, createdAt: T0 - 9 * H, updatedAt: T0 - 9 * H }],
  },
});

/* ---- legacy DOM driver ---- */
const tick = () => new Promise<void>((r) => setImmediate(r));
export const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const $ = (w: any, id: string) => w.document.getElementById(id);
export function pick(w: any, label: string) {
  const row = [...w.document.querySelectorAll('#appDialogPick .pick-row')].find((b: any) => b.textContent.trim() === label) as any;
  if (!row) throw new Error('no pick row ' + label + ' in ' + [...w.document.querySelectorAll('#appDialogPick .pick-row')].map((b: any) => b.textContent).join('|'));
  row.click();
}
export async function recordMenu(w: any, id: string, label: string) {
  (w.document.querySelector(`#logList .entry[data-record-id="${id}"] .ex`) as any).click();
  await settle();
  pick(w, label);
  await settle();
}
export const okDialog = async (w: any) => { $(w, 'appDialogOk').click(); await settle(); };
export function typeInto(w: any, el: any, value: string) {
  el.value = value;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
}

/** Align generated values: ids from different generators, timestamps from different clocks. */
export function normalize(b: any, keepIds: string[] = []) {
  delete b.qyx_lastchange; delete b.qyx_lastbackup;
  const ts = ['t', 'updatedAt', 'createdAt', 'activityAt', 'statusUpdatedAt', 'completedAt', 'linkedAt', 'removedAt', 'wall', 'active', 'created_time', 'updated_time'];
  const zero = (o: any) => { for (const k of ts) if (typeof o?.[k] === 'number' && o[k] >= T0) o[k] = -1; };
  for (const r of b.qyx_log || []) { zero(r); if (r.submissionId === undefined) delete r.submissionId; delete r.wall; delete r.active; }
  for (const d of b.qyx_dead || []) zero(d);
  for (const t of b.qyx_tags || []) zero(t);
  const st = b.qyx_ideas_v5;
  if (st) {
    for (const k of ['items', 'links', 'events', 'tasks']) st[k].forEach(zero);
    st.events.forEach((e: any) => { e.id = '<evt>'; });
    st.tasks.forEach((t: any) => { if (!keepIds.includes(t.id)) t.id = '<plan>'; });
    for (const k of ['items', 'links', 'events']) st[k].sort((a: any, b: any) => a.id.localeCompare(b.id));
    st.tasks.sort((a: any, b: any) => a.recordId.localeCompare(b.recordId) || a.order - b.order || a.text.localeCompare(b.text));
  }
  for (const k of ['qyx_enough', 'qyx_enough_prev']) for (const i of b[k]?.items || []) zero(i);
  b.qyx_log?.sort((a: any, b2: any) => String(a.id).localeCompare(String(b2.id)));
  return b;
}
const mask = (keep: string[] = []) => (b: any) => normalize(b, keep);

/** Id of the record the legacy run added (so the new side can use the same submissionId). */
export const newSid = (w: any, known: string[]) => {
  const log = JSON.parse(w.eval('JSON.stringify(log)')) as { id: string }[];
  const r = log.find((x) => x.id.startsWith('rec5_') && !known.includes(x.id));
  return r ? r.id.slice(5) : '';
};

describe('record writes match legacy', () => {
  it('add note with mood and #tags', async () => {
    let sid = '';
    const r = await actionParity({
      local: seed(),
      legacy: async (w) => {
        typeInto(w, $(w, 'noteText'), '合成新记录 #生活/做饭 #想法');
        w.document.querySelector('.mood-btn[data-m="😄"]').click();
        $(w, 'saveNote').click();
        await settle();
        sid = newSid(w, ['rec5_b', 'rec5_c', 'rec5_d']);
      },
      next: (d, c) => { expect(submitRecord(d, { submissionId: sid, text: '合成新记录 #生活/做饭 #想法', mood: '😄' }, c).ok).toBe(true); },
      mask: mask(),
    });
    expect(sid).not.toBe('');
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
  });

  it('add note with checklist lines (tasks extracted, body kept)', async () => {
    let sid = '';
    const text = '合成正文\n- [ ] 清单甲\n- [x] 清单乙';
    const r = await actionParity({
      local: seed(),
      legacy: async (w) => { typeInto(w, $(w, 'noteText'), text); $(w, 'saveNote').click(); await settle(); sid = newSid(w, ['rec5_b', 'rec5_c', 'rec5_d']); },
      next: (d, c) => { submitRecord(d, { submissionId: sid, text }, c); },
      mask: mask(['plan_t1']),
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
  });

  it('add note into an existing idea', async () => {
    let sid = '';
    const r = await actionParity({
      local: seed(),
      legacy: async (w) => {
        typeInto(w, $(w, 'noteText'), '合成补充 到想法');
        const sel = $(w, 'v5NoteTarget'); sel.value = 'idea_two'; sel.dispatchEvent(new w.Event('change'));
        $(w, 'saveNote').click(); await settle(); sid = newSid(w, ['rec5_b', 'rec5_c', 'rec5_d']);
      },
      next: (d, c) => { submitRecord(d, { submissionId: sid, text: '合成补充 到想法', ideaId: 'idea_two' }, c); },
      mask: mask(),
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
  });

  it('new idea from the 记个想法 composer', async () => {
    let sid = '';
    const r = await actionParity({
      local: seed(),
      legacy: async (w) => {
        $(w, 'ideaNew').click(); await settle();
        typeInto(w, $(w, 'ideaBody'), '合成新想法 正文');
        typeInto(w, $(w, 'ideaTitle'), '合成标题');
        w.document.querySelector('[data-icon="plane"]').click();
        $(w, 'ideaSave').click(); await settle();
        sid = newSid(w, ['rec5_b', 'rec5_c', 'rec5_d']);
      },
      next: (d, c) => { submitRecord(d, { submissionId: sid, text: '合成新想法 正文', newIdea: { title: '合成标题', icon: 'plane' } }, c); },
      mask: mask(),
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
  });

  it('append to an idea from its timeline', async () => {
    let sid = '';
    const r = await actionParity({
      local: seed(),
      legacy: async (w) => {
        w.document.querySelector('[data-open="idea_one"]').click(); await settle();
        typeInto(w, $(w, 'ideaBody'), '合成 接着写');
        $(w, 'ideaSave').click(); await settle();
        sid = newSid(w, ['rec5_b', 'rec5_c', 'rec5_d']);
      },
      next: (d, c) => { submitRecord(d, { submissionId: sid, text: '合成 接着写', ideaId: 'idea_one' }, c); },
      mask: mask(),
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
  });

  it('edit keeps id and t, bumps updatedAt, sets v5StableId, re-indexes tags', async () => {
    const r = await actionParity({
      local: seed(),
      legacy: async (w) => {
        (w.document.querySelector('#logList .entry[data-record-id="rec5_d"] .ex') as any).click(); await settle();
        pick(w, '编辑文字'); await settle();
        typeInto(w, $(w, 'appDialogArea'), '合成记录 4 改过 #新标签');
        await okDialog(w);
      },
      next: (d, c) => { expect(editRecord(d, 'rec5_d', '合成记录 4 改过 #新标签', null, c).ok).toBe(true); },
      mask: mask(),
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
  });

  it('edit of an idea record bumps the idea activity', async () => {
    const r = await actionParity({
      local: seed(),
      legacy: async (w) => {
        (w.document.querySelector('#logList .entry[data-record-id="rec5_c"] .ex') as any).click(); await settle();
        pick(w, '编辑文字'); await settle();
        typeInto(w, $(w, 'appDialogArea'), '合成记录 3 改过');
        await okDialog(w);
      },
      // the 6.x editor shows the record's checklist lines too, so an unchanged checklist stays
      next: (d, c) => { editRecord(d, 'rec5_c', '合成记录 3 改过\n- [ ] 合成清单 1', null, c); },
      mask: mask(),
    });
    expect(r.diffs).toEqual([]);
  });

  it('edit adding checklist lines to a record without tasks', async () => {
    const text = '合成记录 4\n- [ ] 新清单';
    const r = await actionParity({
      local: seed(),
      legacy: async (w) => {
        (w.document.querySelector('#logList .entry[data-record-id="rec5_d"] .ex') as any).click(); await settle();
        pick(w, '编辑文字'); await settle();
        typeInto(w, $(w, 'appDialogArea'), text);
        await okDialog(w);
      },
      next: (d, c) => { editRecord(d, 'rec5_d', text, null, c); },
      mask: mask(['plan_t1']),
    });
    expect(r.diffs).toEqual([]);
  });

  it('delete a record without owner = tombstone + removal', async () => {
    const r = await actionParity({
      local: seed(),
      legacy: async (w) => { await recordMenu(w, 'rec5_d', '删除记录'); await okDialog(w); },
      next: (d, c) => { deleteRecord(d, 'rec5_d', c); },
      mask: mask(),
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
  });

  it('delete a record inside an idea: same as legacy except links/tasks are retired (deliberate)', async () => {
    const r = await actionParity({
      local: seed(),
      legacy: async (w) => { await recordMenu(w, 'rec5_c', '删除记录'); await okDialog(w); },
      next: (d, c) => { deleteRecord(d, 'rec5_c', c); },
      mask: (b, side) => {
        normalize(b, ['plan_t1']);
        if (side === 'next') {
          const link = b.qyx_ideas_v5.links.find((l: any) => l.id === 'link_rec5_c');
          const task = b.qyx_ideas_v5.tasks.find((t: any) => t.id === 'plan_t1');
          expect(link.removedAt).toBe(-1);
          expect(task.removedAt).toBe(-1);
          delete link.removedAt; delete task.removedAt;
          link.updatedAt = task.updatedAt = T0 - 9 * H;
        }
      },
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
  });
});

describe('yesterday 补勾 matches legacy', () => {
  const yk = '2026-10-23';
  const local = () => ({
    ...seed(),
    qyx_sums: { [yk]: { t: T0 - 12 * H, v2: 1, stats: { cut: 0, notes: 0, done: 0 }, three: [{ text: '合成事项', status: 'incomplete', done: false, subs: [{ text: '合成小项', status: 'incomplete', done: false }] }], bonus: [], habits: [], obs: '' } },
    qyx_enough_prev: { d: yk, items: [{ id: 'task_x', text: '合成事项', done: false, status: 'incomplete', updatedAt: T0 - 12 * H, subs: [{ text: '合成小项', done: false, status: 'incomplete', updatedAt: T0 - 12 * H }] }, { id: 'task_y', text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] }, { id: 'task_z', text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] }] },
  });
  it('fix a sub-item', async () => {
    const r = await actionParity({
      local: local(),
      legacy: async (w) => { (w.document.querySelector('#yesterdayBody [data-fix-sub]') as any).click(); await settle(); },
      next: (d, c) => { expect(fixYesterdaySub(d, '合成事项', '合成小项', c).ok).toBe(true); },
      mask: (b) => {
        normalize(b);
        for (const i of b.qyx_enough_prev.items) for (const s of i.subs) if (typeof s.updatedAt === 'number' && s.updatedAt >= T0) s.updatedAt = -1;
        if (b.qyx_enough_prev.items[0].updatedAt >= T0) b.qyx_enough_prev.items[0].updatedAt = -1;
      },
    });
    expect(r.errors).toEqual([]);
    expect(r.diffs).toEqual([]);
  });
});
