/*
 * Synthetic data generator for the legacy-vs-TS merge differential tests.
 * Everything here is invented ("合成…"); no real user data. Pure + seeded, no I/O.
 *
 * genCase(seed) -> { A, B, rawRemote }
 *   A / B : localStorage-shaped objects (qyx_* keys -> JSON-able values) for two devices that
 *           started from a shared base and then diverged with random operations.
 *   rawRemote : when true the test should feed B to the merge as-is (an un-normalised gist written by
 *           a device that has not booted today: stale enough.d, no-id log rows, string splits, ...)
 *           instead of the legacy-booted/normalised form of B.
 */
import { stableId } from '../../src/core/util';

export const NOW_ISO = '2026-10-24T09:00:00+08:00';
export const T0 = Date.parse(NOW_ISO);
export const DAY = 864e5;
export const TODAY = '2026-10-24';
export const YESTERDAY = '2026-10-23';
export const THIS_MONTH = '2026-10';
const dk = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* ---------------- seeded PRNG ---------------- */
export function makeRng(seed: number) {
  let s = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 5; i++) f();
  const int = (a: number, b: number) => a + Math.floor(f() * (b - a + 1));
  const chance = (p: number) => f() < p;
  const pick = (arr: any[]): any => arr[Math.floor(f() * arr.length)];
  const shuffle = (arr: any[]): any[] => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(f() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const sample = (arr: any[], n: number): any[] => shuffle(arr).slice(0, n);
  return { f, int, chance, pick, shuffle, sample };
}
type Rng = ReturnType<typeof makeRng>;

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export interface GenCase {
  A: Record<string, any>;
  B: Record<string, any>;
  rawRemote: boolean;
  /** tags describing which scenario features this seed contains (for debugging) */
  features: string[];
}

/* ---------------- generator ---------------- */
class Gen {
  r: Rng;
  n = 0;
  ids = new Set<string>();
  features: string[] = [];
  constructor(seed: number) {
    this.r = makeRng(seed);
  }
  text(prefix: string) {
    return `${prefix} ${++this.n}`;
  }
  uuid() {
    const h = (k: number) => Array.from({ length: k }, () => this.r.int(0, 15).toString(16)).join('');
    return `${h(8)}-${h(4)}-4${h(3)}-8${h(3)}-${h(12)}`;
  }
  uniq(prefix: string) {
    let id: string;
    do id = stableId(prefix, `${this.r.f()}|${++this.n}`);
    while (this.ids.has(id));
    this.ids.add(id);
    return id;
  }
  /** a time in the past, mostly the last 3 days (incl. earlier today) */
  randT(maxDays = 20) {
    const r = this.r;
    if (r.chance(0.7)) return T0 - r.int(60_000, 3 * DAY);
    return T0 - r.int(60_000, maxDays * DAY);
  }
  hashtag() {
    const r = this.r;
    if (r.chance(0.7)) return ' #话题' + r.int(1, 6);
    return ' #项目' + r.int(1, 3) + '/子题' + r.int(1, 3);
  }
  noteText() {
    return this.text('合成记录') + (this.r.chance(0.25) ? this.hashtag() : '');
  }

  logEntry(o: { type?: string; t?: number; noId?: boolean } = {}) {
    const r = this.r;
    const type = o.type ?? r.pick(['note', 'note', 'note', 'note', 'done', 'dice', 'ai', 'draw', 'bonus']);
    const t = o.t ?? this.randT();
    const e: any = {};
    let text: string;
    if (type === 'note') text = this.noteText();
    else if (type === 'done') text = r.pick(['合成小项 1', '合成小项 2', '合成小项 3', '合成完成 ' + ++this.n]);
    else text = this.text('合成' + type);
    if (!o.noId) {
      if (type === 'note' && r.chance(0.18)) {
        const sid = this.uuid();
        e.id = 'rec5_' + sid;
        this.ids.add(e.id);
        e.submissionId = sid;
        if (r.chance(0.3)) e.v5StableId = 'stable_' + sid.slice(0, 8);
      } else if (type === 'done' && r.chance(0.3)) e.id = this.uniq('done_');
      else e.id = this.uniq('rec_');
    }
    e.t = t;
    if (!r.chance(0.12)) e.updatedAt = r.chance(0.85) ? t : t + r.int(1000, 3_600_000);
    e.type = type;
    e.text = text;
    if (r.chance(0.8)) e.mood = r.chance(0.7) ? null : r.pick(['平静', '有点累', '开心']);
    if (type === 'done') e.src = r.pick(['三件·小项', '三件·小项', '三件·小项 ×2', '三件', null]);
    else if (r.chance(0.6)) e.src = null;
    if (r.chance(0.5)) e.q = null;
    return e;
  }

  enoughSub(day: string, updatedAt?: number) {
    const r = this.r;
    const status = r.pick(['incomplete', 'incomplete', 'completed', 'expired']);
    const s: any = {
      text: r.pick(['合成小项 1', '合成小项 2', '合成小项 3']) + (r.chance(0.5) ? '' : ' ' + ++this.n),
      done: status === 'completed',
      status,
      updatedAt: updatedAt ?? (status === 'incomplete' && r.chance(0.5) ? 0 : T0 - r.int(1, 30) * 3_600_000),
    };
    if (status === 'completed' && r.chance(0.3)) s.c = r.int(1, 3);
    void day;
    return s;
  }
  enoughItem(day: string, filled = true) {
    const r = this.r;
    if (!filled) return { id: this.uniq('task_'), text: '', done: false, status: 'incomplete', updatedAt: 0, subs: [] };
    const status = r.pick(['incomplete', 'incomplete', 'completed', 'expired', 'deleted']);
    const it: any = {
      id: this.uniq('task_'),
      text: status === 'deleted' && r.chance(0.5) ? '' : this.text('合成事项'),
      done: status === 'completed',
      status,
      updatedAt: T0 - r.int(1, 40) * 3_600_000,
      subs: Array.from({ length: r.int(0, 3) }, () => this.enoughSub(day)),
    };
    // keep sub texts unique within an item (the app keys subs by text)
    const seen = new Set<string>();
    it.subs = it.subs.filter((s: any) => (seen.has(s.text) ? false : (seen.add(s.text), true)));
    return it;
  }
  enoughDay(day: string) {
    const r = this.r;
    const filled = r.int(1, 3);
    return { d: day, items: [0, 1, 2].map((i) => this.enoughItem(day, i < filled)) };
  }

  goal(ym: string, kind?: 'goal' | 'watch') {
    const r = this.r;
    const k = kind ?? (r.chance(0.2) ? 'watch' : 'goal');
    const g: any = {
      id: this.uniq('goal_'),
      text: this.text('合成目标'),
      kind: k,
      done: k === 'goal' && r.chance(0.2),
      splits: Array.from({ length: r.int(0, 4) }, () => ({ text: this.text('合成拆分'), done: k === 'goal' && r.chance(0.3) })),
      hist: Array.from({ length: r.int(0, 3) }, () => ({ t: T0 - r.int(1, 25) * DAY, ev: r.pick(['created', 'split+', 'done', '继续']) })),
    };
    if (r.chance(0.1)) g.carriedFrom = '2026-09';
    void ym;
    return g;
  }

  tag(path: string) {
    // create all ancestors, returns tag objects (legacy ensureTagPath shape)
    const out: any[] = [];
    let parent: string | null = null;
    let full = '';
    path.split('/').forEach((name) => {
      full = full ? full + '/' + name : name;
      const id = stableId('tag_', full);
      const ct = T0 - this.r.int(1, 30) * DAY;
      out.push({ id, name, parent_id: parent, created_time: ct, updated_time: ct + this.r.int(0, DAY) });
      parent = id;
    });
    return out;
  }
}

function addTags(D: any, tagObjs: any[]) {
  D.qyx_tags = D.qyx_tags || [];
  for (const t of tagObjs) if (!D.qyx_tags.some((x: any) => x.id === t.id)) D.qyx_tags.push(t);
}

/* ---------------- base ---------------- */
function makeBase(g: Gen): Record<string, any> {
  const r = g.r;
  const D: Record<string, any> = {};

  // log: shared history. Includes legacy rows without an id (pre-id era) so that boot-time id
  // assignment (index based) differs between devices whose arrays are not identical.
  D.qyx_log = [];
  const nLog = r.int(6, 20);
  for (let i = 0; i < nLog; i++) D.qyx_log.push(g.logEntry());
  D.qyx_log.sort((a: any, b: any) => a.t - b.t);
  if (r.chance(0.5)) {
    g.features.push('legacy-no-id');
    for (let i = 0; i < r.int(1, 3); i++) {
      const e = g.logEntry({ type: 'note', noId: true, t: T0 - r.int(5, 15) * DAY });
      delete e.updatedAt;
      D.qyx_log.push(e);
    }
    D.qyx_log.sort((a: any, b: any) => a.t - b.t);
  }
  // duplicated done identity inside the base (same day|type|src|text, two ids)
  if (r.chance(0.35)) {
    g.features.push('done-dup-base');
    const t = T0 - r.int(1, 8) * 3_600_000;
    for (let k = 0; k < 2; k++) {
      const e = g.logEntry({ type: 'done', t: t + k * 1000 });
      e.text = '合成小项 重复';
      e.src = '三件·小项';
      D.qyx_log.push(e);
    }
  }

  // string pools
  // NOTE: never absent. A device that never saved qyx_dice holds legacy's built-in default pool in memory but
  // exports null; that known divergence has its own focused test instead of poisoning every seed.
  D.qyx_dice = Array.from({ length: r.int(3, 9) }, () => g.text('合成骰子'));
  D.qyx_opts = Array.from({ length: r.int(0, 6) }, () => g.text('合成事项'));
  D.qyx_bench = Array.from({ length: r.int(0, 5) }, () => g.text('合成待选'));
  D.qyx_opts_hist = Array.from({ length: r.int(0, 6) }, () => ({ t: T0 - r.int(1, 20) * DAY, text: g.text('合成写过') })).sort((a, b) => a.t - b.t);

  D.qyx_routines = Array.from({ length: r.int(0, 3) }, () => ({ id: g.uniq('routine_'), text: g.text('合成常规'), updatedAt: T0 - r.int(1, 30) * DAY }));
  if (r.chance(0.8)) D.qyx_drawers = Array.from({ length: r.int(0, 4) }, () => ({ id: g.uniq('drawer_'), text: g.text('合成抽屉'), updatedAt: T0 - r.int(1, 30) * DAY }));
  D.qyx_ongoing = Array.from({ length: r.int(0, 4) }, () => {
    const t = T0 - r.int(1, 30) * DAY;
    return { id: t + r.int(0, 999), t, text: g.text('合成定过') };
  });
  D.qyx_provider = r.pick(['deepseek', 'claude', 'openai']);

  // months
  D.qyx_months = {};
  for (const ym of ['2026-10', '2026-09', '2026-08'].slice(0, r.int(1, 3))) {
    D.qyx_months[ym] = Array.from({ length: ym === THIS_MONTH ? r.int(1, 6) : r.int(0, 4) }, () => g.goal(ym));
  }
  if (!D.qyx_months[THIS_MONTH]) D.qyx_months[THIS_MONTH] = [];

  D.qyx_bottles = Array.from({ length: r.int(0, 3) }, () => {
    const t = T0 - r.int(1, 30) * DAY;
    return { id: t + r.int(0, 99), t, text: g.text('合成瓶子'), followups: Array.from({ length: r.int(0, 2) }, () => ({ t: t + r.int(1, 10) * DAY, text: g.text('合成追加') })) };
  });

  // summaries (v2 flag for yesterday sometimes)
  D.qyx_sums = {};
  if (r.chance(0.6)) {
    D.qyx_sums[YESTERDAY] = {
      t: T0 - 10 * 3_600_000, v2: 1, stats: { cut: 1, notes: 1, done: 0 },
      three: [{ text: '合成旧事项', status: 'completed', done: true, subs: [] }], bonus: [], habits: [], obs: '合成观察',
    };
  }
  if (r.chance(0.5)) D.qyx_sums['2026-10-20'] = { t: T0 - 4 * DAY, stats: { cut: 2, notes: 2, done: 1 }, three: [], obs: '合成观察 旧' };

  // enough (today's three), enough_prev
  const sc = r.f();
  if (sc < 0.5) { D.qyx_enough = g.enoughDay(TODAY); g.features.push('enough-today'); }
  else if (sc < 0.85) { D.qyx_enough = g.enoughDay(YESTERDAY); g.features.push('enough-rollover'); }
  else g.features.push('enough-none');
  if (r.chance(0.8)) D.qyx_enough_prev = g.enoughDay(r.chance(0.6) ? YESTERDAY : '2026-10-22');

  // habits (<=3)
  D.qyx_habits = Array.from({ length: r.int(0, 3) }, () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < r.int(0, 5); i++) counts[dk(T0 - r.int(0, 8) * DAY)] = r.int(1, 4);
    return { id: T0 - r.int(1, 90) * DAY, name: g.text('合成习惯'), counts, updatedAt: T0 - r.int(1, 60) * DAY };
  });

  // bonus
  const bd = r.f();
  const mkBonus = (d: string) => ({ d, items: [0, 1].map(() => ({ text: r.chance(0.5) ? g.text('合成加分') : '', done: r.chance(0.3) })) });
  if (bd < 0.5) D.qyx_bonus = mkBonus(TODAY);
  else if (bd < 0.8) D.qyx_bonus = mkBonus(YESTERDAY);
  if (r.chance(0.5)) D.qyx_bonus_prev = mkBonus(r.pick([YESTERDAY, '2026-10-22']));

  D.qyx_rules = Array.from({ length: r.int(0, 5) }, () => { const t = T0 - r.int(1, 60) * DAY; return { id: t, t, text: g.text('合成准则') }; });
  D.qyx_ai_review = r.chance(0.7)
    ? Array.from({ length: r.int(0, 3) }, (_, i) => { const t = T0 - (i + 1) * 7 * DAY + r.int(0, 999); return { t, from: t - 7 * DAY, to: t, text: g.text('合成回望') }; })
    : null;
  D.qyx_polish_history = Array.from({ length: r.int(0, 2) }, () => ({ t: T0 - r.int(1, 10) * DAY, original: g.text('合成原话'), polished: g.text('合成整理'), mode: 'clean' }));
  if (r.chance(0.3)) D.qyx_sit_reminder = '合成：站起来走走';

  // tags and relations
  D.qyx_tags = [];
  D.qyx_record_tags = {};
  D.qyx_goal_tags = {};
  D.qyx_task_tags = {};
  D.qyx_task_goals = {};
  const explicit = ['标签甲', '标签乙/细分一', '标签丙'].slice(0, r.int(0, 3));
  explicit.forEach((p) => addTags(D, g.tag(p)));
  D.qyx_tags.forEach((t: any) => {
    D.qyx_log.filter(() => r.chance(0.15)).forEach((e: any) => { if (e.id) (D.qyx_record_tags[e.id] = D.qyx_record_tags[e.id] || []).push(t.id); });
  });
  if (D.qyx_tags.length) {
    const goals = Object.values(D.qyx_months).flat() as any[];
    goals.filter(() => r.chance(0.3)).forEach((gl) => { D.qyx_goal_tags[gl.id] = [r.pick(D.qyx_tags as any[]).id]; });
    (D.qyx_enough?.items || []).forEach((it: any) => { if (r.chance(0.4)) D.qyx_task_tags[it.id] = [r.pick(D.qyx_tags as any[]).id]; });
  }
  const gl = Object.values(D.qyx_months).flat() as any[];
  (D.qyx_enough?.items || []).forEach((it: any) => { if (gl.length && r.chance(0.4)) D.qyx_task_goals[it.id] = r.pick(gl).id; });

  // tombstones present in the shared history
  D.qyx_dead = [];
  const bury = (s: string, v: any) => D.qyx_dead.push({ s, v, t: T0 - r.int(1, 20) * DAY });
  if (r.chance(0.4)) bury('opt', g.text('合成已删待选'));
  if (r.chance(0.3)) bury('dice', g.text('合成已删骰子'));
  if (r.chance(0.3)) bury('log', g.uniq('rec_'));
  if (r.chance(0.3)) bury('tag', stableId('tag_', '已删标签' + g.n));

  // v5 overlay
  D.qyx_ideas_v5 = { schema: 2, items: [], links: [], events: [], tasks: [] };
  D.qyx_daily_review_v51 = [];
  const notes = D.qyx_log.filter((e: any) => e.type === 'note' && e.id);
  for (const rec of r.sample(notes, Math.min(notes.length, r.int(0, 3)))) {
    const sid = rec.submissionId || rec.id.replace(/^rec5?_/, '');
    const ideaId = 'idea_' + sid;
    const ct = rec.t;
    D.qyx_ideas_v5.items.push({
      id: ideaId, title: g.text('合成想法'), icon: r.pick(['star', 'sprout', 'cup']), status: r.chance(0.7) ? 'open' : 'completed',
      rootRecordId: rec.id, createdAt: ct, activityAt: ct, updatedAt: ct + r.int(0, 5) * 60_000,
      ...(r.chance(0.5) ? { statusUpdatedAt: ct + 1000 } : {}), ...(r.chance(0.3) ? { scheduledDate: TODAY } : {}),
    });
    D.qyx_ideas_v5.links.push({ id: 'link_' + rec.id, ideaId, recordId: rec.id, role: 'root', linkedAt: ct, updatedAt: ct });
    if (r.chance(0.5)) D.qyx_ideas_v5.events.push({ id: 'event_' + g.uuid(), ideaId, event: r.pick(['completed', 'open']), t: ct + 5000, updatedAt: ct + 5000 });
  }
  for (const rec of r.sample(notes, Math.min(notes.length, r.int(0, 3)))) {
    D.qyx_ideas_v5.tasks.push({
      id: 'plan_' + g.uuid(), recordId: rec.id, text: g.text('合成清单'), done: r.chance(0.3), scheduledDate: r.chance(0.5) ? TODAY : null,
      order: r.int(0, 5), createdAt: rec.t, updatedAt: rec.t + r.int(0, 3) * 60_000,
      ...(r.chance(0.15) ? { removedAt: rec.t + 10_000 } : {}),
    });
  }
  const dr = r.int(0, 2);
  for (let i = 0; i < dr; i++) {
    const t = T0 - r.int(1, 5) * DAY;
    D.qyx_daily_review_v51.push({ id: 'daily_' + g.uuid(), date: dk(t), t, paragraphs: [{ text: g.text('合成回望段'), source_ids: [] }], provider: 'test' });
  }
  return D;
}

/* ---------------- divergence operations ---------------- */
type Op = (D: any, O: any) => void;

function makeOps(g: Gen): [number, string, Op][] {
  const r = g.r;
  const pickLog = (D: any, pred?: (e: any) => boolean): any => {
    const arr: any[] = (D.qyx_log || []).filter(pred || (() => true));
    return arr.length ? r.pick(arr) : null;
  };
  const dead = (D: any) => (D.qyx_dead = D.qyx_dead || []);
  const bury = (D: any, s: string, v: any) => { if (!dead(D).some((x: any) => x.s === s && x.v === v)) dead(D).push({ s, v, t: T0 - r.int(60_000, 2 * DAY) }); };
  const unbury = (D: any, s: string, v: any) => { D.qyx_dead = dead(D).filter((x: any) => !(x.s === s && x.v === v)); };
  const todayEnough = (D: any) => (D.qyx_enough && D.qyx_enough.d === TODAY ? D.qyx_enough : null);
  const anyEnough = (D: any) => D.qyx_enough;

  return [
    [8, 'addLog', (D) => { (D.qyx_log = D.qyx_log || []).push(g.logEntry()); }],
    [3, 'addDone', (D) => { (D.qyx_log = D.qyx_log || []).push(g.logEntry({ type: 'done', t: T0 - r.int(60_000, 8 * 3_600_000) })); }],
    [2, 'addNoteHashtag', (D) => { const e = g.logEntry({ type: 'note' }); e.text += g.hashtag(); D.qyx_log.push(e); }],
    [2, 'addV5Note', (D) => {
      const sid = g.uuid(); const t = T0 - r.int(60_000, 2 * DAY);
      D.qyx_log.push({ id: 'rec5_' + sid, t, updatedAt: t, type: 'note', text: g.noteText(), mood: null, src: null, q: null, submissionId: sid });
    }],
    [5, 'editLog', (D) => {
      const e = pickLog(D); if (!e) return;
      e.text += '（改）'; e.updatedAt = r.chance(0.15) ? (e.updatedAt ?? e.t) : (e.updatedAt ?? e.t) + r.int(1000, 3 * 3_600_000);
    }],
    [4, 'conflictEdit', (D, O) => {
      // same record edited on both devices; sometimes with equal updatedAt (tie -> local wins)
      const id = pickLog(D)?.id; if (!id) return;
      const a = D.qyx_log.find((x: any) => x.id === id), b = (O.qyx_log || []).find((x: any) => x.id === id);
      if (!a || !b) return;
      const base = Math.max(a.updatedAt ?? a.t, b.updatedAt ?? b.t);
      const ua = base + r.int(1000, 100000);
      a.text = a.text + '（甲改）'; a.updatedAt = ua;
      b.text = b.text + '（乙改）'; b.updatedAt = r.chance(0.3) ? ua : base + r.int(1000, 100000);
    }],
    [5, 'delLog', (D) => {
      const e = pickLog(D); if (!e || !e.id) return;
      D.qyx_log = D.qyx_log.filter((x: any) => x !== e); bury(D, 'log', e.id);
      if (D.qyx_record_tags) delete D.qyx_record_tags[e.id];
    }],
    [2, 'delLogKeepTomb', (D) => { // tombstone for something this device never had (arrived via earlier sync, deleted since)
      const e = g.logEntry(); bury(D, 'log', e.id);
    }],
    [3, 'dupDoneAcross', (D, O) => {
      const t = T0 - r.int(60_000, 6 * 3_600_000); const text = '合成小项 ' + r.int(1, 3);
      const mk = (dt: number) => ({ id: g.uniq('rec_'), t: t + dt, updatedAt: t + dt, type: 'done', text, mood: null, src: '三件·小项', q: null });
      (D.qyx_log = D.qyx_log || []).push(mk(0)); (O.qyx_log = O.qyx_log || []).push(mk(r.int(1, 5000)));
    }],
    [2, 'prependOld', (D) => { // older legacy no-id rows inserted at the front (shifts boot-assigned ids)
      const e = g.logEntry({ type: 'note', noId: true, t: T0 - 40 * DAY }); delete e.updatedAt; D.qyx_log.unshift(e);
    }],
    [2, 'addNoteNoUpdated', (D) => { const e = g.logEntry({ type: 'note' }); delete e.updatedAt; D.qyx_log.push(e); }],

    // string pools
    [4, 'addOpt', (D) => { (D.qyx_opts = D.qyx_opts || []).push(g.text('合成事项')); if (D.qyx_opts.length > 9) D.qyx_opts.length = 9; }],
    [3, 'addOptBulk', (D) => { D.qyx_opts = [...(D.qyx_opts || []), ...Array.from({ length: r.int(3, 7) }, () => g.text('合成事项'))].slice(0, 9); g.features.push('opts-bulk'); }],
    [3, 'delOpt', (D) => { const pool = r.chance(0.6) ? 'qyx_opts' : 'qyx_bench'; const a = D[pool] || []; if (!a.length) return; const v = r.pick(a); D[pool] = a.filter((x: string) => x !== v); bury(D, 'opt', v); }],
    [3, 'sharedOptDelete', (D, O) => { const a = D.qyx_opts || []; if (!a.length) return; const v = r.pick(a); D.qyx_opts = a.filter((x: string) => x !== v); bury(D, 'opt', v); if (r.chance(0.5)) O.qyx_opts = [...(O.qyx_opts || []), v].slice(0, 9); }],
    [3, 'poolOverlap', (D, O) => { // same string in opts here and bench/opts there; duplicates inside one list
      const v = g.text('合成事项'); (D.qyx_opts = D.qyx_opts || []).push(v); (O.qyx_bench = O.qyx_bench || []).push(v);
      if (r.chance(0.5)) (O.qyx_opts = O.qyx_opts || []).push(v);
      if (r.chance(0.4)) (D.qyx_bench = D.qyx_bench || []).push(v);
      if (D.qyx_opts.length > 9) D.qyx_opts.length = 9;
    }],
    [3, 'addBench', (D) => { (D.qyx_bench = D.qyx_bench || []).push(g.text('合成待选')); }],
    [3, 'addDice', (D) => { (D.qyx_dice = D.qyx_dice || []).push(g.text('合成骰子')); }],
    [2, 'delDice', (D) => { const a = D.qyx_dice || []; if (!a.length) return; const v = r.pick(a); D.qyx_dice = a.filter((x: string) => x !== v); bury(D, 'dice', v); }],
    [2, 'addOptsHist', (D) => { (D.qyx_opts_hist = D.qyx_opts_hist || []).push({ t: T0 - r.int(1, 15) * DAY, text: g.text('合成写过') }); }],
    [2, 'delOptsHist', (D) => { const a = D.qyx_opts_hist || []; if (!a.length) return; const x = r.pick(a); D.qyx_opts_hist = a.filter((y: any) => y !== x); bury(D, 'ohist', `${x.t}|${x.text}`); }],
    [2, 'ohistSame', (D, O) => { const x = { t: T0 - r.int(1, 15) * DAY, text: g.text('合成写过') }; (D.qyx_opts_hist = D.qyx_opts_hist || []).push(x); (O.qyx_opts_hist = O.qyx_opts_hist || []).push({ ...x }); }],

    // routines / drawers
    [2, 'addRoutine', (D) => { (D.qyx_routines = D.qyx_routines || []).push({ id: g.uniq('routine_'), text: g.text('合成常规'), updatedAt: T0 - r.int(1, 5) * DAY }); }],
    [2, 'editRoutine', (D, O) => {
      const x = (D.qyx_routines || [])[0]; if (!x) return; const y = (O.qyx_routines || []).find((q: any) => q.id === x.id);
      x.text += '（改）'; x.updatedAt = (x.updatedAt || 0) + r.int(1000, 100000);
      if (y && r.chance(0.5)) { y.text += '（乙改）'; y.updatedAt = x.updatedAt + (r.chance(0.3) ? 0 : r.int(-500, 500)); }
    }],
    [2, 'delRoutine', (D) => { const a = D.qyx_routines || []; if (!a.length) return; const x = r.pick(a); D.qyx_routines = a.filter((y: any) => y !== x); bury(D, 'routine', x.id); }],
    [2, 'addDrawer', (D) => { (D.qyx_drawers = D.qyx_drawers || []).push({ id: g.uniq('drawer_'), text: g.text('合成抽屉'), updatedAt: T0 - r.int(1, 5) * DAY }); }],
    [1, 'delDrawer', (D) => { const a = D.qyx_drawers || []; if (!a.length) return; const x = r.pick(a); D.qyx_drawers = a.filter((y: any) => y !== x); bury(D, 'drawer', x.id); }],

    // ongoing (定过的) and rules
    [3, 'addOngoing', (D) => { const t = T0 - r.int(1, 10) * DAY; (D.qyx_ongoing = D.qyx_ongoing || []).unshift({ id: t + r.int(0, 999), t, text: g.text('合成定过') }); }],
    [2, 'addOngoingBulk', (D) => { for (let i = 0; i < 7; i++) { const t = T0 - r.int(1, 40) * DAY; (D.qyx_ongoing = D.qyx_ongoing || []).push({ id: t + r.int(0, 999) + i * 1000, t, text: g.text('合成定过') }); } }],
    [2, 'delOngoing', (D) => { const a = D.qyx_ongoing || []; if (!a.length) return; const x = r.pick(a); D.qyx_ongoing = a.filter((y: any) => y !== x); bury(D, 'ongoing', x.text); }],
    [3, 'addRule', (D) => { const t = T0 - r.int(1, 10) * DAY; (D.qyx_rules = D.qyx_rules || []).unshift({ id: t, t, text: g.text('合成准则') }); }],
    [3, 'addRulesBulk', (D) => { for (let i = 0; i < 24; i++) { const t = T0 - r.int(1, 90) * DAY; (D.qyx_rules = D.qyx_rules || []).push({ id: t + i, t, text: g.text('合成准则') }); } }],
    [2, 'delRule', (D) => { const a = D.qyx_rules || []; if (!a.length) return; const x = r.pick(a); D.qyx_rules = a.filter((y: any) => y !== x); bury(D, 'rule', x.text); }],
    [2, 'sameRule', (D, O) => { const t = T0 - r.int(1, 10) * DAY; const text = g.text('合成准则'); (D.qyx_rules = D.qyx_rules || []).push({ id: t, t, text }); (O.qyx_rules = O.qyx_rules || []).push({ id: t + 5, t: t + 5, text }); }],

    // pre-5.x edit path: bury the old id, re-create the row under a new id with the same t (dedupeByContent `origins` logic)
    [4, 'editRecreate', (D) => {
      const e = pickLog(D, (x) => x.type === 'note' && x.id && !x.submissionId); if (!e) return;
      const old = e.id; bury(D, 'log', old);
      const when = T0 - r.int(1, 3600) * 1000; e.id = stableId('rec_', old + '|edit|' + when); g.ids.add(e.id);
      e.text += '（重写）'; e.updatedAt = when;
      if (D.qyx_record_tags && D.qyx_record_tags[old]) { D.qyx_record_tags[e.id] = D.qyx_record_tags[old]; delete D.qyx_record_tags[old]; }
    }],
    // same ms + type on two devices, different text (edited or not) -> only the `origins` rule decides
    [3, 'sameMs', (D, O) => {
      const t = T0 - r.int(60_000, 2 * DAY);
      const mk = (edited: boolean) => { const e = g.logEntry({ type: 'note', t }); e.updatedAt = edited ? t + r.int(1000, 60_000) : t; return e; };
      D.qyx_log.push(mk(r.chance(0.4))); O.qyx_log.push(mk(r.chance(0.4))); if (r.chance(0.3)) D.qyx_log.push(mk(false));
    }],
    // same ms + type + text under different ids (cross-device duplicates); sometimes one carries a submissionId (bypasses content dedupe)
    [3, 'sameContentDiffId', (D, O) => {
      const t = T0 - r.int(60_000, 2 * DAY); const type = r.pick(['note', 'note', 'dice']); const text = g.text('合成记录');
      const mk = (id: string, up: number | undefined, extra: any = {}) => { const e: any = { id, t, type, text, mood: null, src: null, q: null, ...extra }; if (up !== undefined) e.updatedAt = up; return e; };
      const sid = g.uuid();
      D.qyx_log.push(mk(g.uniq('rec_'), r.chance(0.8) ? t : undefined));
      O.qyx_log.push(r.chance(0.3) ? mk('rec5_' + sid, t, { submissionId: sid }) : mk(g.uniq('rec_'), r.chance(0.5) ? t + r.int(1000, 90_000) : t));
    }],
    [2, 'ongoingSameT', (D, O) => { const t = T0 - r.int(1, 10) * DAY; (D.qyx_ongoing = D.qyx_ongoing || []).push({ id: t + 1, t, text: g.text('合成定过') }); (O.qyx_ongoing = O.qyx_ongoing || []).push({ id: t + 2, t, text: g.text('合成定过') }); }],
    [2, 'ongoingSameId', (D, O) => { const t = T0 - r.int(1, 10) * DAY; const id = t + 7; (D.qyx_ongoing = D.qyx_ongoing || []).push({ id, t, text: g.text('合成定过') }); (O.qyx_ongoing = O.qyx_ongoing || []).push({ id, t, text: g.text('合成定过 乙') }); }],
    [2, 'rulesSameT', (D, O) => { const t = T0 - r.int(1, 10) * DAY; (D.qyx_rules = D.qyx_rules || []).push({ id: t + 1, t, text: g.text('合成准则') }); (O.qyx_rules = O.qyx_rules || []).push({ id: t + 2, t, text: g.text('合成准则') }); }],
    [2, 'aiReviewBulk', (D) => { const arr = Array.isArray(D.qyx_ai_review) ? D.qyx_ai_review : []; for (let i = 0; i < 8; i++) { const t = T0 - (i + 3) * 5 * DAY - r.int(0, 99); arr.push({ t, from: t - 7 * DAY, to: t, text: g.text('合成回望') }); } D.qyx_ai_review = arr; }],

    // tags
    [2, 'addTagAndRelate', (D) => {
      const path = r.chance(0.5) ? '标签' + r.pick(['丁', '戊', '己']) : '标签乙/细分' + r.pick(['二', '三']);
      addTags(D, g.tag(path)); const tag = D.qyx_tags.find((x: any) => x.id === stableId('tag_', path)); if (!tag) return;
      const e = pickLog(D, (x) => !!x.id); if (e) { (D.qyx_record_tags = D.qyx_record_tags || {}); D.qyx_record_tags[e.id] = [...new Set([...(D.qyx_record_tags[e.id] || []), tag.id])]; }
      const gs = (Object.values(D.qyx_months || {}).flat() as any[]); if (gs.length) { D.qyx_goal_tags = D.qyx_goal_tags || {}; const gg = r.pick(gs); D.qyx_goal_tags[gg.id] = [...new Set([...(D.qyx_goal_tags[gg.id] || []), tag.id])]; }
    }],
    [2, 'renameTag', (D) => { const t = (D.qyx_tags || [])[0]; if (!t) return; t.updated_time = (t.updated_time || 0) + r.int(1000, DAY); t.name += '改'; }],
    [2, 'delTag', (D) => {
      const a = (D.qyx_tags || []).filter((x: any) => /^标签/.test(x.name)); if (!a.length) return; const t = r.pick(a);
      D.qyx_tags = D.qyx_tags.filter((x: any) => x.id !== t.id); bury(D, 'tag', t.id);
      for (const k of ['qyx_record_tags', 'qyx_goal_tags', 'qyx_task_tags']) Object.keys(D[k] || {}).forEach((id) => { D[k][id] = D[k][id].filter((x: string) => x !== t.id); });
    }],
    [1, 'taskGoalOverride', (D, O) => { const k = Object.keys(D.qyx_task_goals || {})[0]; if (!k) return; D.qyx_task_goals[k] = 'goal_other_' + g.n; if (r.chance(0.5)) (O.qyx_task_goals = O.qyx_task_goals || {})[k] = 'goal_other_b' + g.n; }],

    // months
    [5, 'addGoal', (D) => { const ms = D.qyx_months = D.qyx_months || {}; const ym = r.chance(0.7) ? THIS_MONTH : r.pick(['2026-09', '2026-08', '2026-11']); (ms[ym] = ms[ym] || []).push(g.goal(ym)); }],
    [2, 'addGoalsBulk', (D) => { const ms = D.qyx_months = D.qyx_months || {}; const arr = (ms[THIS_MONTH] = ms[THIS_MONTH] || []); const n = r.int(4, 8); for (let i = 0; i < n && arr.length < 12; i++) arr.push(g.goal(THIS_MONTH)); g.features.push('month-bulk'); }],
    [5, 'editGoal', (D) => {
      const gs = Object.values(D.qyx_months || {}).flat() as any[]; if (!gs.length) return; const gg = r.pick(gs);
      const act = r.int(0, 3);
      if (act === 0) gg.splits = [...(gg.splits || []), { text: g.text('合成拆分'), done: false }];
      else if (act === 1 && gg.kind !== 'watch') gg.done = !gg.done;
      else if (act === 2 && (gg.splits || []).length) { const sp = r.pick(gg.splits as any[]); sp.done = !sp.done; }
      else gg.hist = [...(gg.hist || []), { t: T0 - r.int(1, 3) * DAY + g.n, ev: r.pick(['done', 'split+', '继续']) }];
    }],
    [4, 'sameGoalDiverge', (D, O) => { // same goal text on both devices (ids differ or equal), splits/done/hist diverge
      const ym = THIS_MONTH; const text = g.text('合成目标'); const same = r.chance(0.5); const id = g.uniq('goal_');
      const mk = (idv: string) => ({ id: idv, text, kind: 'goal', done: r.chance(0.3), splits: Array.from({ length: r.int(0, 3) }, () => ({ text: r.pick(['拆分甲', '拆分乙', '拆分丙', g.text('合成拆分')]), done: r.chance(0.5) })), hist: Array.from({ length: r.int(0, 2) }, () => ({ t: T0 - r.int(1, 5) * DAY, ev: r.pick(['done', '继续']) })) });
      const a = mk(id), b = mk(same ? id : g.uniq('goal_'));
      const dedup = (x: any) => { const s = new Set<string>(); x.splits = x.splits.filter((q: any) => (s.has(q.text) ? false : (s.add(q.text), true))); };
      dedup(a); dedup(b);
      (D.qyx_months[ym] = D.qyx_months[ym] || []).push(a); (O.qyx_months = O.qyx_months || {}); (O.qyx_months[ym] = O.qyx_months[ym] || []).push(b);
    }],
    [3, 'delGoal', (D) => {
      const ym = r.pick(Object.keys(D.qyx_months || {})); const arr = (D.qyx_months || {})[ym] || []; if (!arr.length) return; const gg = r.pick(arr);
      D.qyx_months[ym] = arr.filter((x: any) => x !== gg); bury(D, 'anchor:' + ym, gg.text); (gg.splits || []).forEach((sp: any) => bury(D, 'split:' + gg.text, sp.text));
      if (D.qyx_goal_tags) delete D.qyx_goal_tags[gg.id];
    }],
    [3, 'delSplit', (D) => {
      const gs = (Object.values(D.qyx_months || {}).flat() as any[]).filter((x) => (x.splits || []).length); if (!gs.length) return; const gg = r.pick(gs);
      const sp = r.pick(gg.splits as any[]); gg.splits = gg.splits.filter((x: any) => x !== sp); bury(D, 'split:' + gg.text, sp.text);
    }],
    [2, 'sharedGoalSplitTomb', (D, O) => { // O still has the goal+split that D deleted a split of
      const gs = (Object.values(D.qyx_months || {}).flat() as any[]).filter((x) => (x.splits || []).length); if (!gs.length) return; const gg = r.pick(gs);
      const sp = gg.splits[0]; gg.splits = gg.splits.slice(1); bury(D, 'split:' + gg.text, sp.text);
      for (const ym of Object.keys(O.qyx_months || {})) { const og = O.qyx_months[ym].find((x: any) => x.text === gg.text); if (og && !og.splits.some((x: any) => x.text === sp.text)) og.splits.push({ ...sp }); }
    }],

    // bottles
    [2, 'addBottle', (D) => { const t = T0 - r.int(1, 10) * DAY; (D.qyx_bottles = D.qyx_bottles || []).push({ id: t + r.int(0, 99), t, text: g.text('合成瓶子'), followups: [] }); }],
    [3, 'bottleFollowup', (D, O) => {
      const b = r.pick(D.qyx_bottles || [null]); if (!b) return; const ob = (O.qyx_bottles || []).find((x: any) => x.id === b.id);
      b.followups = [...(b.followups || []), { t: T0 - r.int(1, 5) * DAY, text: g.text('合成追加') }];
      if (ob) ob.followups = [...(ob.followups || []), { t: T0 - r.int(1, 5) * DAY, text: g.text('合成追加') }, ...(r.chance(0.4) && b.followups.length ? [{ ...b.followups[b.followups.length - 1] }] : [])];
    }],

    // habits
    [3, 'addHabit', (D) => { const hs = D.qyx_habits = D.qyx_habits || []; if (hs.length < 3) hs.push({ id: T0 - r.int(1, 5) * DAY, name: g.text('合成习惯'), counts: { [dk(T0 - DAY)]: 1 }, updatedAt: T0 - r.int(1, 5) * DAY }); }],
    [4, 'habitCount', (D) => { const h = r.pick(D.qyx_habits || [null]); if (!h) return; h.counts = h.counts || {}; h.counts[dk(T0 - r.int(0, 3) * DAY)] = r.int(1, 6); h.updatedAt = r.chance(0.5) ? h.updatedAt : T0 - r.int(1, 1000); }],
    [3, 'habitRename', (D) => { const h = r.pick(D.qyx_habits || [null]); if (!h) return; h.name = g.text('合成习惯改名'); h.updatedAt = (h.updatedAt || 0) + r.int(1000, 100000); }],
    [2, 'habitSameNameNewId', (D, O) => { const name = g.text('合成习惯'); (D.qyx_habits = D.qyx_habits || []).length < 3 && D.qyx_habits.push({ id: T0 - 777, name, counts: {}, updatedAt: T0 - 5 * DAY }); (O.qyx_habits = O.qyx_habits || []).length < 3 && O.qyx_habits.push({ id: T0 - 888, name, counts: { [TODAY]: 2 }, updatedAt: T0 - 4 * DAY }); }],
    [1, 'delHabit', (D) => { const hs = D.qyx_habits || []; if (!hs.length) return; const h = r.pick(hs); D.qyx_habits = hs.filter((x: any) => x !== h); bury(D, 'habit', h.name); }],

    // today's three
    [5, 'enoughEditText', (D) => { const e = anyEnough(D); if (!e) return; const it = r.pick(e.items as any[]); it.text = g.text('合成事项'); it.updatedAt = T0 - r.int(1, 20) * 60_000; if (it.status === 'deleted') it.status = 'incomplete'; }],
    [5, 'enoughStatus', (D) => { const e = anyEnough(D); if (!e) return; const it = r.pick(e.items as any[]); it.status = r.pick(['incomplete', 'completed', 'expired', 'deleted']); it.done = it.status === 'completed'; it.updatedAt = T0 - r.int(1, 600) * 60_000; }],
    [5, 'enoughSubAdd', (D) => { const e = anyEnough(D); if (!e) return; const it = r.pick(e.items as any[]); it.subs = it.subs || []; const s = g.enoughSub(e.d, T0 - r.int(1, 600) * 60_000); if (!it.subs.some((x: any) => x.text === s.text)) it.subs.push(s); it.updatedAt = Math.max(it.updatedAt || 0, s.updatedAt); }],
    [4, 'enoughSubChange', (D) => { const e = anyEnough(D); if (!e) return; const its = (e.items as any[]).filter((i) => (i.subs || []).length); if (!its.length) return; const it = r.pick(its); const s = r.pick(it.subs as any[]); s.status = r.pick(['incomplete', 'completed', 'expired']); s.done = s.status === 'completed'; if (s.status !== 'completed') delete s.c; else if (r.chance(0.4)) s.c = r.int(1, 4); s.updatedAt = T0 - r.int(1, 600) * 60_000; }],
    [3, 'enoughSubDel', (D) => { const e = anyEnough(D); if (!e) return; const its = (e.items as any[]).filter((i) => (i.subs || []).length); if (!its.length) return; const it = r.pick(its); const s = r.pick(it.subs as any[]); it.subs = it.subs.filter((x: any) => x !== s); it.updatedAt = T0 - r.int(1, 600) * 60_000; bury(D, 'esub:' + e.d, s.text); }],
    [3, 'enoughSharedSubText', (D, O) => { // same sub text on both, different status/updatedAt (ties included)
      const a = anyEnough(D), b = anyEnough(O); if (!a || !b) return; const i = r.int(0, 2); const ia = a.items[i], ib = b.items[i]; if (!ia || !ib) return;
      const text = r.pick(['合成共享小项甲', '合成共享小项乙']); const u = T0 - r.int(1, 500) * 60_000;
      const mk = (up: number) => { const st = r.pick(['incomplete', 'completed', 'expired']); const s: any = { text, done: st === 'completed', status: st, updatedAt: up }; if (st === 'completed' && r.chance(0.4)) s.c = r.int(1, 3); return s; };
      ia.subs = (ia.subs || []).filter((x: any) => x.text !== text).concat([mk(u)]); ib.subs = (ib.subs || []).filter((x: any) => x.text !== text).concat([mk(r.chance(0.25) ? u : u + r.int(-3000, 3000))]);
    }],
    [2, 'enoughFillBlankOther', (D, O) => { // D's item is blank; O has text in same slot
      const a = anyEnough(D), b = anyEnough(O); if (!a || !b) return; const i = r.int(0, 2); const ia = a.items[i], ib = b.items[i]; if (!ia || !ib) return;
      ia.text = ''; ia.status = 'incomplete'; ia.done = false; ia.subs = []; ia.updatedAt = r.chance(0.5) ? 0 : T0 - 7200_000;
      ib.text = g.text('合成事项'); ib.updatedAt = T0 - r.int(1, 60) * 60_000;
    }],
    [1, 'enoughDifferentIdSameText', (D, O) => { const a = anyEnough(D), b = anyEnough(O); if (!a || !b) return; const i = r.int(0, 2); if (!a.items[i] || !b.items[i]) return; const text = g.text('合成事项'); a.items[i].text = text; b.items[i].text = text; b.items[i].id = g.uniq('task_'); }],
    [2, 'enoughBlankAll', (D) => { const e = anyEnough(D); if (!e) return; e.items = e.items.map(() => g.enoughItem(e.d, false)); }],
    [3, 'enoughTagGoal', (D) => { const e = anyEnough(D); if (!e) return; const it = r.pick(e.items as any[]); if (D.qyx_tags?.length) (D.qyx_task_tags = D.qyx_task_tags || {})[it.id] = [r.pick(D.qyx_tags as any[]).id]; const gs = Object.values(D.qyx_months || {}).flat() as any[]; if (gs.length) (D.qyx_task_goals = D.qyx_task_goals || {})[it.id] = r.pick(gs).id; }],

    // yesterday's three / summary
    [3, 'prevDiverge', (D, O) => {
      const pa = D.qyx_enough_prev, pb = O.qyx_enough_prev; if (!pa) { D.qyx_enough_prev = clone(pb) || g.enoughDay(YESTERDAY); return; }
      if (pb && pb.d === pa.d) { const i = r.int(0, 2); if (pa.items[i] && pb.items[i] && r.chance(0.5)) pb.items[i].id = pa.items[i].id; }
      const it = r.pick(pa.items as any[]); if (!it) return;
      it.updatedAt = T0 - r.int(1, 100) * 60_000; it.status = r.pick(['completed', 'incomplete', 'expired']); it.done = it.status === 'completed';
      if (r.chance(0.5)) { const s = g.enoughSub(pa.d, T0 - r.int(1, 100) * 60_000); it.subs = [...(it.subs || []), s]; }
    }],
    [2, 'prevSetDay', (D) => { D.qyx_enough_prev = g.enoughDay(r.pick([YESTERDAY, '2026-10-22', '2026-10-21'])); }],
    [3, 'sumsV2', (D) => { D.qyx_sums = D.qyx_sums || {}; D.qyx_sums[D.qyx_enough_prev?.d || YESTERDAY] = { t: T0 - 5 * 3_600_000, v2: 1, stats: { cut: 0, notes: 0, done: 0 }, three: [], bonus: [], habits: [], obs: '合成观察 ' + ++g.n }; }],
    [2, 'sumsOld', (D) => { D.qyx_sums = D.qyx_sums || {}; D.qyx_sums[dk(T0 - r.int(2, 9) * DAY)] = { t: T0 - r.int(2, 9) * DAY, stats: { cut: 1, notes: 1, done: 1 }, three: [], obs: '合成观察 旧' + ++g.n }; }],

    // bonus
    [3, 'bonusEdit', (D) => { const b = D.qyx_bonus; if (!b) { D.qyx_bonus = { d: TODAY, items: [{ text: g.text('合成加分'), done: false }, { text: '', done: false }] }; return; } const it = r.pick(b.items as any[]); it.text = g.text('合成加分'); it.done = r.chance(0.5); }],
    [2, 'bonusPrev', (D) => { D.qyx_bonus_prev = { d: r.pick([YESTERDAY, '2026-10-22']), items: [{ text: g.text('合成加分'), done: r.chance(0.5) }, { text: '', done: false }] }; }],

    // ai review, polish, sit reminder, provider
    [3, 'addAiReview', (D) => { const t = T0 - r.int(1, 40) * DAY; const cur = D.qyx_ai_review; const arr = Array.isArray(cur) ? cur : []; arr.push({ t, from: t - 7 * DAY, to: t, text: g.text('合成回望') }); D.qyx_ai_review = arr; }],
    [1, 'aiReviewSingleLegacy', (D) => { D.qyx_ai_review = { t: T0 - 6 * DAY, text: g.text('合成旧回望') }; g.features.push('ai-single'); }],
    [1, 'aiReviewSameT', (D, O) => { const t = T0 - 9 * DAY; D.qyx_ai_review = [{ t, from: t - 7 * DAY, to: t, text: '合成回望甲' }]; O.qyx_ai_review = [{ t, from: t - 7 * DAY, to: t, text: '合成回望乙' }]; }],
    [2, 'addPolish', (D) => { (D.qyx_polish_history = D.qyx_polish_history || []).push({ t: T0 - r.int(1, 10) * DAY, original: g.text('合成原话'), polished: g.text('合成整理'), mode: 'clean' }); }],
    [1, 'sitReminder', (D) => { D.qyx_sit_reminder = '合成：喝口水 ' + g.n; }],

    // v5 overlay
    [4, 'ideaUpdate', (D, O) => {
      const items = D.qyx_ideas_v5?.items || []; if (!items.length) return; const it = r.pick(items as any[]); const oi = (O.qyx_ideas_v5?.items || []).find((x: any) => x.id === it.id);
      const up = (it.updatedAt || 0) + r.int(1000, 3_600_000); it.title += '（改）'; it.updatedAt = up; it.status = r.pick(['open', 'completed']); it.statusUpdatedAt = up;
      if (it.status === 'completed') it.completedAt = up;
      if (oi && r.chance(0.7)) { const tie = r.chance(0.3); oi.title += '（乙改）'; oi.updatedAt = tie ? up : up + r.int(-1000, 1000); }
      if (r.chance(0.2)) it.removedAt = up;
    }],
    [3, 'ideaAdd', (D) => {
      const rec = pickLog(D, (e) => e.type === 'note' && e.id); if (!rec) return; const ideas = D.qyx_ideas_v5 = D.qyx_ideas_v5 || { schema: 2, items: [], links: [], events: [], tasks: [] };
      const sid = rec.submissionId || rec.id.replace(/^rec5?_/, ''); const id = 'idea_' + sid + '_' + g.n; const ct = T0 - r.int(1, 100) * 60_000;
      ideas.items.push({ id, title: g.text('合成想法'), icon: 'star', status: 'open', rootRecordId: rec.id, createdAt: ct, activityAt: ct, updatedAt: ct });
      ideas.links.push({ id: 'link_' + rec.id + '_' + g.n, ideaId: id, recordId: rec.id, role: 'root', linkedAt: ct, updatedAt: ct });
      if (r.chance(0.5)) ideas.events.push({ id: 'event_' + g.uuid(), ideaId: id, event: 'completed', t: ct, updatedAt: ct });
    }],
    [3, 'taskAdd', (D) => {
      const rec = pickLog(D, (e) => e.id); if (!rec) return; const ideas = D.qyx_ideas_v5 = D.qyx_ideas_v5 || { schema: 2, items: [], links: [], events: [], tasks: [] };
      const ct = T0 - r.int(1, 100) * 60_000; ideas.tasks.push({ id: 'plan_' + g.uuid(), recordId: rec.id, text: g.text('合成清单'), done: false, scheduledDate: r.chance(0.5) ? TODAY : null, order: ideas.tasks.length, createdAt: ct, updatedAt: ct });
    }],
    [3, 'taskUpdate', (D, O) => {
      const ts = D.qyx_ideas_v5?.tasks || []; if (!ts.length) return; const t = r.pick(ts as any[]); const o = (O.qyx_ideas_v5?.tasks || []).find((x: any) => x.id === t.id);
      const up = (t.updatedAt || 0) + r.int(1000, 3_600_000); t.done = !t.done; t.updatedAt = up; if (r.chance(0.2)) t.removedAt = up;
      if (o && r.chance(0.6)) { o.text += '（乙改）'; o.updatedAt = r.chance(0.3) ? up : up + r.int(-1000, 1000); }
    }],
    [3, 'dailyReviewAdd', (D, O) => {
      const arr = D.qyx_daily_review_v51 = D.qyx_daily_review_v51 || []; const t = T0 - r.int(60_000, 3 * DAY); const id = 'daily_' + g.uuid();
      arr.push({ id, date: dk(t), t, paragraphs: [{ text: g.text('合成回望段'), source_ids: [] }], provider: 'test' });
      if (r.chance(0.3)) (O.qyx_daily_review_v51 = O.qyx_daily_review_v51 || []).push({ id, date: dk(t), t: t + r.int(-1000, 1000), paragraphs: [{ text: g.text('合成回望段乙') }] });
    }],
    [4, 'mirrorV5', (D, O) => { // today row mirrors a v5 checklist task or idea; the other device edited the row later
      const a = todayEnough(D), b = todayEnough(O); if (!a || !b) return; const i = r.int(0, 2); const ia = a.items[i], ib = b.items[i]; if (!ia || !ib) return;
      ib.id = ia.id; if (!ia.text) { ia.text = g.text('合成事项'); ia.updatedAt = T0 - 5 * 3_600_000; }
      const ideas = D.qyx_ideas_v5 = D.qyx_ideas_v5 || { schema: 2, items: [], links: [], events: [], tasks: [] };
      const oi = O.qyx_ideas_v5 = O.qyx_ideas_v5 || { schema: 2, items: [], links: [], events: [], tasks: [] };
      const rec = pickLog(D, (e) => e.id && (O.qyx_log || []).some((x: any) => x.id === e.id)) || pickLog(D, (e) => e.id); if (!rec) return;
      const kind = r.chance(0.5) ? 'task' : 'idea';
      const old = T0 - 8 * 3_600_000; const fresh = T0 - r.int(1, 30) * 60_000;
      if (kind === 'task') {
        const plan = { id: 'plan_' + g.uuid(), recordId: rec.id, text: g.text('合成清单'), done: false, scheduledDate: TODAY, order: 0, createdAt: old, updatedAt: old, ...(r.chance(0.2) ? { removedAt: old + 1000 } : {}) };
        ideas.tasks.push(plan); if (r.chance(0.8)) oi.tasks.push({ ...plan });
        ia.v5TaskId = plan.id; ib.v5TaskId = plan.id;
        ia.updatedAt = Math.min(ia.updatedAt || 0, old);
      } else {
        const idea = { id: 'idea_' + g.uuid(), title: g.text('合成想法'), icon: 'star', status: 'open', rootRecordId: rec.id, createdAt: old, activityAt: old, updatedAt: r.chance(0.4) ? T0 - 60_000 : old, statusUpdatedAt: old }; // updatedAt near now => legacy mergeState tie-break path
        ideas.items.push(idea); if (r.chance(0.8)) oi.items.push({ ...idea });
        ia.v5IdeaId = idea.id; ib.v5IdeaId = idea.id;
      }
      ib.text = g.text('合成事项'); ib.status = r.pick(['completed', 'incomplete']); ib.done = ib.status === 'completed'; ib.updatedAt = fresh;
      if (r.chance(0.3)) delete ia.v5TaskId;
      g.features.push('mirror-' + kind);
    }],
  ];
}

/* ---------------- raw-remote mutations (un-normalised gist) ---------------- */
function makeRawRemote(g: Gen, B: any) {
  const r = g.r;
  g.features.push('raw-remote');
  if (r.chance(0.5)) {
    // device that has not opened the app today: enough is yesterday's, prev is older
    if (B.qyx_enough) { B.qyx_enough.d = YESTERDAY; }
    if (B.qyx_enough_prev) B.qyx_enough_prev.d = r.pick(['2026-10-22', '2026-10-21']);
    g.features.push('raw-stale-day');
  }
  if (r.chance(0.5)) {
    // legacy rows without id (+ their content-key tombstones)
    const e = g.logEntry({ type: 'note', noId: true, t: T0 - r.int(2, 12) * DAY }); delete e.updatedAt;
    (B.qyx_log = B.qyx_log || []).push(e);
    if (r.chance(0.4)) (B.qyx_dead = B.qyx_dead || []).push({ s: 'log', v: `${e.t}|${e.type}|${e.text}`, t: T0 - DAY });
    g.features.push('raw-no-id');
  }
  if (r.chance(0.5)) {
    // string splits + missing kind in an old client's months
    const ym = THIS_MONTH; const gl = g.goal(ym); delete gl.kind; gl.splits = gl.splits.map((s: any) => s.text);
    gl.hist = gl.hist.length ? gl.hist : undefined;
    (B.qyx_months = B.qyx_months || {})[ym] = [...(B.qyx_months[ym] || []), gl]; g.features.push('raw-string-splits');
  }
  if (r.chance(0.3) && B.qyx_enough) { B.qyx_enough.items = B.qyx_enough.items.slice(0, r.int(1, 2)); g.features.push('raw-short-enough'); }
  if (r.chance(0.3) && B.qyx_enough_prev) {
    const extra = g.enoughItem(B.qyx_enough_prev.d, true); B.qyx_enough_prev.items = r.chance(0.5) ? [...B.qyx_enough_prev.items, extra] : B.qyx_enough_prev.items.slice(0, 2); g.features.push('raw-odd-prev');
  }
  if (r.chance(0.4)) {
    // an older client: whole keys missing / null
    const keys = ['qyx_tags', 'qyx_record_tags', 'qyx_goal_tags', 'qyx_task_tags', 'qyx_task_goals', 'qyx_drawers', 'qyx_bonus', 'qyx_bonus_prev', 'qyx_rules', 'qyx_ai_review', 'qyx_polish_history', 'qyx_sit_reminder', 'qyx_habits', 'qyx_bottles', 'qyx_ideas_v5', 'qyx_daily_review_v51', 'qyx_dead', 'qyx_opts_hist', 'qyx_routines', 'qyx_enough_prev', 'qyx_sums', 'qyx_months', 'qyx_ongoing', 'qyx_opts', 'qyx_bench', 'qyx_dice', 'qyx_enough'];
    for (const k of keys) if (r.chance(0.2)) { if (r.chance(0.5)) delete B[k]; else B[k] = null; }
    g.features.push('raw-missing-keys');
  }
  if (r.chance(0.3)) {
    // v5 rows that the SAFE_ID filters must drop
    const ideas = B.qyx_ideas_v5 = B.qyx_ideas_v5 || { schema: 2, items: [], links: [], events: [], tasks: [] };
    ideas.items = [...(ideas.items || []), { id: 'idea bad id', title: '合成非法', icon: 'star', status: 'open', rootRecordId: 'rec_x', createdAt: 1, activityAt: 1, updatedAt: 9 }, { id: 'idea_ok_' + g.n, title: g.text('合成想法'), icon: 'star', status: 'open', rootRecordId: 'rec/bad', createdAt: 1, activityAt: 1, updatedAt: 9 }];
    ideas.tasks = [...(ideas.tasks || []), { id: 'plan_x/y', recordId: 'rec_x', text: '合成非法', done: false, order: 0, createdAt: 1, updatedAt: 9 }];
    B.qyx_daily_review_v51 = [...(B.qyx_daily_review_v51 || []), { id: 'daily_bad date', date: TODAY, t: 5, paragraphs: [] }, { id: 'daily_ok_' + g.n, date: '2026-13', t: 5, paragraphs: [] }, { id: 'daily_nopara_' + g.n, date: TODAY, t: 5, paragraphs: 'x' }];
    g.features.push('raw-invalid-v5');
  }
  if (r.chance(0.3)) { (B.qyx_months = B.qyx_months || {})['2026-07'] = null; g.features.push('raw-null-month'); }
  if (r.chance(0.3)) {
    // relation ids pointing at tags that do not exist anywhere
    (B.qyx_record_tags = B.qyx_record_tags || {})['rec_phantom_' + g.n] = ['tag_phantom'];
    const some = (B.qyx_log || []).find((e: any) => e.id); if (some) B.qyx_record_tags[some.id] = [...(B.qyx_record_tags[some.id] || []), 'tag_phantom'];
    g.features.push('raw-phantom-tag');
  }
  if (r.chance(0.4)) {
    // only the enough-today items without v5 mirror fields but with bare string subs
    const e = B.qyx_enough; if (e && e.items[0]) { e.items[0].subs = [...(e.items[0].subs || []), '合成裸字符串小项' + g.n]; }
  }
}

/* ---------------- entry point ---------------- */
export function genCase(seed: number): GenCase {
  const g = new Gen(seed);
  const r = g.r;
  const base = makeBase(g);
  const A = clone(base), B = clone(base);
  const ops = makeOps(g);
  const total = ops.reduce((s, o) => s + o[0], 0);
  const choose = () => { let x = r.f() * total; for (const o of ops) { x -= o[0]; if (x <= 0) return o; } return ops[0]; };

  // enough: devices may be on different days (A rolls over at boot, etc.)
  if (r.chance(0.2) && A.qyx_enough) A.qyx_enough = { d: YESTERDAY, items: A.qyx_enough.items }; // A last opened yesterday
  if (r.chance(0.5)) { A.qyx_enough_prev = r.chance(0.5) ? clone(B.qyx_enough_prev) : A.qyx_enough_prev; } // identical prev vs different prev

  // scenario mode: usually both diverge; sometimes the remote is simply stale (a past state of A) or identical
  const mode = r.f();
  let nOps = r.int(10, 32);
  if (mode < 0.06) { nOps = 0; g.features.push('identical'); }
  for (let i = 0; i < nOps; i++) {
    const [, name, fn] = choose();
    const devIsA = r.chance(0.5);
    try { fn(devIsA ? A : B, devIsA ? B : A); } catch (err) { throw new Error(`gen op ${name} failed for seed ${seed}: ${(err as Error).message}`); }
  }
  if (mode >= 0.06 && mode < 0.14) { // remote = old base only; local progressed (merge should add nothing)
    const keepB = clone(base);
    for (const k of Object.keys(B)) delete B[k];
    Object.assign(B, keepB);
    g.features.push('stale-remote');
  }
  let forceRaw = false;
  if (mode >= 0.14 && mode < 0.18) { // brand-new device meets an existing gist
    const keep = A.qyx_dice; for (const k of Object.keys(A)) delete A[k]; A.qyx_dice = keep; g.features.push('fresh-local');
  }
  if (mode >= 0.18 && mode < 0.21) { // freshly created, empty gist
    for (const k of Object.keys(B)) delete B[k]; B._ver = '5.1.3.1'; forceRaw = true; g.features.push('empty-remote');
  }
  if (r.chance(0.2)) { // local keys never written on this device
    const optional = ['qyx_tags', 'qyx_record_tags', 'qyx_goal_tags', 'qyx_task_tags', 'qyx_task_goals', 'qyx_bonus', 'qyx_bonus_prev', 'qyx_rules', 'qyx_ai_review', 'qyx_polish_history', 'qyx_sit_reminder', 'qyx_habits', 'qyx_bottles', 'qyx_opts_hist', 'qyx_routines', 'qyx_enough_prev', 'qyx_sums', 'qyx_ongoing', 'qyx_opts', 'qyx_bench', 'qyx_ideas_v5', 'qyx_daily_review_v51'];
    for (const k of optional) if (r.chance(0.12)) delete A[k];
    g.features.push('local-missing-keys');
  }
  // sprinkle a few extra tombstones that propagate between devices after the fact
  if (r.chance(0.3) && B.qyx_dead?.length) A.qyx_dead = [...(A.qyx_dead || []), ...B.qyx_dead.slice(0, 1)];

  let rawRemote = forceRaw;
  if (!forceRaw && r.chance(0.3)) { rawRemote = true; makeRawRemote(g, B); }

  // make the stored shapes look like localStorage: drop undefined, keep key order stable
  return { A: clone(A), B: clone(B), rawRemote, features: g.features };
}
