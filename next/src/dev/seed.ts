/*
 * Dev-only demo data so pages can be reviewed without real records.
 * Loaded when the dev server runs with ?seed=demo. Wipes only this origin's qyx_* keys.
 * Never shipped: main.tsx imports it behind import.meta.env.DEV.
 */
import { stableId, dayKey, monthKey } from '../core/util';

export function seedDemo(now = Date.now()) {
  for (const k of Object.keys(localStorage)) if (k.startsWith('qyx_')) localStorage.removeItem(k);
  const H = 3600_000, D = 24 * H;
  const rec = (i: number, ago: number, text: string, extra: object = {}) =>
    ({ id: stableId('rec_', 'demo' + i), t: now - ago, updatedAt: now - ago, type: 'note', text, mood: null, src: null, q: null, ...extra });
  const log = [
    rec(1, 3 * D, '想做一个给自己用的小工具，把每天的想法先存下来 #想法/工具'),
    rec(2, 2 * D + 5 * H, '工具要轻：打开就能写，写完就走'),
    rec(3, 2 * D, '周末去公园走走，带上相机 #生活'),
    rec(4, D + 3 * H, '今天读了半章书，关于注意力的部分很有意思\n- [ ] 摘抄三句话\n- [x] 读完第二节'),
    rec(5, 20 * H, '今天把阳台的花换了个位置 #生活/家'),
    rec(6, 5 * H, '想法盒子的卡片可以按最近更新排序'),
    rec(7, 2 * H, '晚上整理一下下周的安排'),
    { ...rec(8, 26 * H, '读完第二节', { type: 'done', src: '三件·小项' }) },
  ];
  const ideaRoot = log[0].id, sid = 'demo-idea-1';
  const ideas = {
    schema: 2,
    items: [
      { id: 'idea_' + sid, title: '给自己做个小工具', icon: 'star', status: 'open', rootRecordId: ideaRoot, createdAt: now - 3 * D, activityAt: now - 5 * H, updatedAt: now - 5 * H },
      { id: 'idea_demo-idea-2', title: '周末公园', icon: 'sun', status: 'completed', rootRecordId: log[2].id, createdAt: now - 2 * D, activityAt: now - 2 * D, updatedAt: now - D, completedAt: now - D, statusUpdatedAt: now - D },
    ],
    links: [
      { id: 'link_' + ideaRoot, ideaId: 'idea_' + sid, recordId: ideaRoot, role: 'root', linkedAt: now - 3 * D, updatedAt: now - 3 * D },
      { id: 'link_' + log[1].id, ideaId: 'idea_' + sid, recordId: log[1].id, role: 'update', linkedAt: now - 2 * D, updatedAt: now - 2 * D },
      { id: 'link_' + log[5].id, ideaId: 'idea_' + sid, recordId: log[5].id, role: 'update', linkedAt: now - 5 * H, updatedAt: now - 5 * H },
      { id: 'link_' + log[2].id, ideaId: 'idea_demo-idea-2', recordId: log[2].id, role: 'root', linkedAt: now - 2 * D, updatedAt: now - 2 * D },
    ],
    events: [{ id: 'evt_demo1', ideaId: 'idea_demo-idea-2', event: 'completed', t: now - D, updatedAt: now - D }],
    tasks: [
      { id: 'plan_demo1', recordId: log[3].id, text: '摘抄三句话', done: false, scheduledDate: dayKey(now), order: 0, createdAt: now - D, updatedAt: now - D },
      { id: 'plan_demo2', recordId: log[3].id, text: '读完第二节', done: true, scheduledDate: null, order: 1, createdAt: now - D, updatedAt: now - D },
    ],
  };
  const item = (id: string, text: string, done = false) => ({ id, text, done, status: done ? 'completed' : 'incomplete', updatedAt: text ? now - H : 0, subs: [] as unknown[] });
  const data: Record<string, unknown> = {
    qyx_log: log,
    qyx_ideas_v5: ideas,
    qyx_enough: { d: dayKey(now), items: [item('task_demo1', '把小工具的第一版做出来'), item('task_demo2', '出门走二十分钟', true), item('task_demo3', '')] },
    qyx_opts: ['回一封邮件', '整理照片', '给植物浇水'],
    qyx_opts_hist: [{ t: now - D, text: '回一封邮件' }],
    qyx_months: { [monthKey(now)]: [{ id: 'goal_demo1', text: '每周写两次长一点的记录', kind: 'goal', done: false, splits: [{ text: '周三', done: true }, { text: '周日', done: false }], hist: [] }] },
    qyx_habits: [{ id: 1, name: '散步', counts: { [dayKey(now - D)]: 1 }, updatedAt: now - D }],
    qyx_bottles: [{ id: now - 9 * D, t: now - 9 * D, text: '希望一年后的自己还记得今天的心情', followups: [] }],
    qyx_tags: [],
    qyx_dead: [],
  };
  for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
}
