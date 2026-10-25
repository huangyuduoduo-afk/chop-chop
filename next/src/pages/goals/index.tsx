/* 目标 / 成长地图: 习惯, 本月方向 (目标位 & 观察位), 往月. Rendering never writes; every change is a tap. */
import { useEffect, useState } from 'preact/hooks';
import { aiConfig, commit, getApp, now, snapshot, today } from '../../app/state';
import { useDraft } from '../../app/drafts';
import type { Habit, MonthGoal } from '../../core/types';
import * as G from '../../domain/goals';
import { fmtDT } from '../../domain/sea';
import { addSubToItem, addToToday, planAddToToday } from '../../domain/today';
import { Icon } from '../../ui/icons';
import { Button, Card, Check, Chip, Empty, Menu, ask, confirmAsk, toast, type MenuItem } from '../../ui/kit';
import './goals.css';

const clockNow = { now: () => now.value };
const longToast = (msg: string) => toast(msg, 4500);

/* ---------------- 习惯 ---------------- */

function HabitCard({ h }: { h: Habit }) {
  const [pop, setPop] = useState(0);
  const n = G.habitCount(h, today.value);
  const spark = G.habitSpark(h, now.value);
  const tap = () => { commit((s, c) => G.tapHabit(s, h.id, c)); setPop((x) => x + 1); };
  const rename = async () => {
    const v = await ask({ title: '改个名字', input: 'line', value: h.name });
    if (v === null) return;
    const r = commit((s, c) => G.renameHabit(s, h.id, v, c));
    if (!r.ok && r.reason === 'dup') toast('已经有同名的习惯了。');
  };
  const remove = async () => {
    if (!(await confirmAsk('删除这个提醒？', `删掉「${h.name}」后，历史次数也会删除。`, true))) return;
    commit((s, c) => G.deleteHabit(s, h.id, c));
  };
  return (
    <div class="habit">
      <button type="button" class="habit-tap" onClick={tap} aria-label={`${h.name}，今天 ${n} 次，点一下加一次`}>
        <span class="habit-name">{h.name}</span>
        <span key={pop} class={`habit-count ${pop ? 'pop' : ''}`}>{n}</span>
        <span class="habit-spark" aria-hidden="true">
          {spark.map((d, i) => <i key={d.day} class={`${d.hit ? 'hit' : ''} ${i === 6 ? 'td' : ''}`} />)}
        </span>
      </button>
      <span class="habit-menu"><Menu label="习惯操作" items={[{ label: '改名', onSelect: rename }, { label: '删除', danger: true, onSelect: remove }]} /></span>
    </div>
  );
}

function Habits() {
  const habits = snapshot.value.qyx_habits || [];
  const add = async () => {
    const v = await ask({ title: '新增提醒', text: '想追踪什么？', input: 'line', placeholder: '比如：起身' });
    if (!v || !v.trim()) return;
    const r = commit((s, c) => G.addHabit(s, v, c));
    if (!r.ok && r.reason === 'dup') toast('已经有同名的习惯了。');
  };
  return (
    <Card title="习惯" sub="点一下记一次，今天和最近七天会留下痕迹。" icon="star" tone="star">
      <div class="habit-grid">
        {habits.map((h) => <HabitCard key={String(h.id)} h={h} />)}
        {habits.length < G.HABIT_MAX && (
          <button type="button" class="habit-add" onClick={add} aria-label="新增习惯"><Icon name="plus" /></button>
        )}
      </div>
    </Card>
  );
}

/* ---------------- 本月方向 ---------------- */

function AddRow() {
  const d = useDraft('goal-add');
  const add = (kind: 'goal' | 'watch') =>
    d.submit((text) => {
      const r = commit((s, c) => G.addGoal(s, text, kind, c));
      if (r.ok) return true;
      if (r.reason !== 'empty') longToast(G.GOAL_MESSAGES[r.reason]);
      return false;
    });
  return (
    <div class="goal-add">
      <input
        ref={d.ref as any} class="input" value={d.text} onInput={d.onInput} placeholder="比如：摄影上有点进展" aria-label="本月方向"
        enterkeyhint="done" onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void add('watch'); } }}
      />
      <div class="goal-add-btns">
        <Button small icon="plus" onClick={() => void add('watch')}>观察位</Button>
        <Button small icon="plus" variant="primary" onClick={() => void add('goal')}>目标位</Button>
      </div>
      <p class="goal-hint">观察位只归集，不打勾。</p>
    </div>
  );
}

/** Tags and the record trail stay folded behind one line, so a month of cards stays short. */
function GoalMore({ a, tags, open, setOpen }: {
  a: MonthGoal; tags: { id: string; path: string }[]; open: boolean; setOpen: (v: boolean) => void;
}) {
  const { derived, cardOps } = G.goalTrail(snapshot.value, a);
  if (!tags.length && !derived.length && !cardOps.length) return null;
  const parts = [
    tags.length ? `#${tags[0].path}${tags.length > 1 ? ` 等 ${tags.length} 个标签` : ''}` : '',
    derived.length ? `相关记录 ${derived.length} 条` : '',
  ].filter(Boolean);
  return (
    <details class="goal-more" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{parts.join(' · ') || '卡片记录'}</summary>
      {tags.length > 0 && <div class="goal-tags">{tags.map((t) => <Chip key={t.id}>#{t.path}</Chip>)}</div>}
      <Trail a={a} />
    </details>
  );
}

function Trail({ a }: { a: MonthGoal }) {
  const { derived, cardOps } = G.goalTrail(snapshot.value, a);
  const line = (h: G.TrailLine) => (
    <div class="trail-line"><span class="trail-t">{fmtDT(h.t)}</span><span>{h.prefix} {h.text}</span></div>
  );
  return (
    <div class="trail">
      {derived.length ? (
        <>
          <div class="trail-head">带这张卡标签的记录和完成 · {derived.length} 条</div>
          {derived.slice(0, 3).map(line)}
          {derived.length > 3 && <details><summary>还有 {derived.length - 3} 条</summary>{derived.slice(3).map(line)}</details>}
        </>
      ) : <div class="trail-line"><span>这里只显示记录过的。没记录不等于没发生。</span></div>}
      {cardOps.length > 0 && <details><summary>卡片操作 {cardOps.length} 次</summary>{cardOps.map(line)}</details>}
    </div>
  );
}

/** 排进今天 (legacy addToTodaySmart): asks where when today already has written rows. */
async function sendToToday(goal: MonthGoal, text: string) {
  const plan = planAddToToday(snapshot.value, text, getApp().clock);
  if (plan.r === 'cancel') return;
  if (plan.r === 'exists') { toast('今天已经有这一条了。'); return; }
  let target: 'top' | number;
  if (plan.r === 'direct') target = 'top';
  else {
    const choices = [
      ...(plan.canTop ? [{ label: '作为新的一件（大项）', value: 'top' }] : []),
      ...plan.parents.map((p) => ({ label: `放到「${p.text}」下面`, value: 'sub:' + p.i })),
    ];
    const v = await ask({ title: '排到哪里？', text, choices });
    if (!v) return;
    target = v === 'top' ? 'top' : Number(v.slice(4));
  }
  if (target === 'top') {
    const r = commit((s, c) => addToToday(s, text, goal.id, c));
    toast(r === 'today' ? '排进今天了，也关联了这个月度目标。' : r === 'full' ? '今天的三件已经满了。' : '今天已经有这一条了。');
    return;
  }
  const out = commit((s, c) => addSubToItem(s, target as number, text, goal.id, c));
  if (!out) return;
  if (out.goalConflict) toast(`放到「${out.parent}」下面了；这个大项已有其他关联目标，未覆盖。`);
  else toast(`放到「${out.parent}」下面了${out.noted ? '，也关联了这个月度目标。' : '。'}`);
}

function SplitChip({ a, i, watch }: { a: MonthGoal; i: number; watch: boolean }) {
  const sp = a.splits[i];
  const edit = async () => {
    const v = await ask({ title: '修改小选项', input: 'line', value: sp.text });
    if (v === null) return;
    const r = commit((s, c) => G.renameSplit(s, a.id, i, v, c));
    if (!r.ok && r.reason === 'dup') toast('这一条下面已经有同名的小项了。');
  };
  const items: MenuItem[] = [
    { label: '排进今天', onSelect: () => void sendToToday(a, sp.text) },
    { label: '修改', onSelect: edit },
    { label: '删除', danger: true, onSelect: () => { commit((s, c) => G.deleteSplit(s, a.id, i, c)); } },
  ];
  return (
    <span class={`split-chip ${sp.done ? 'done' : ''}`}>
      {!watch && <Check checked={sp.done} label={`小项：${sp.text}`} onToggle={() => { commit((s, c) => G.toggleSplit(s, a.id, i, c)); }} />}
      <span class="split-text">{sp.text}</span>
      <Menu label="小项操作" items={items} />
    </span>
  );
}

function GoalCard({ a }: { a: MonthGoal }) {
  const watch = G.isWatch(a);
  const [trail, setTrail] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const tags = G.goalTagPaths(snapshot.value, a.id);

  const rename = async () => {
    const v = await ask({ title: '修改本月方向', input: 'line', value: a.text });
    if (v === null) return;
    const r = commit((st, c) => G.renameGoal(st, a.id, v, c));
    if (!r.ok && r.reason === 'dup') toast(G.GOAL_MESSAGES.dup);
  };
  const remove = async () => {
    if (!(await confirmAsk('删除本月方向？', `删掉「${a.text}」？`, true))) return;
    commit((st, c) => G.deleteGoal(st, a.id, c));
  };
  const bindTags = async () => {
    const cur = G.goalTagPaths(snapshot.value, a.id).map((t) => '#' + t.path).join(' ');
    const v = await ask({ title: '关联标签', text: '可以写多个，用空格分开。', input: 'line', value: cur, placeholder: '输入 # 开头的标签，多个用空格分开' });
    if (v === null) return;
    commit((st, c) => G.setGoalTags(st, a.id, v, c));
  };
  /** AI split: only from this tap; sends the goal text and nothing else. */
  const aiSplit = async () => {
    setSplitting(true);
    try {
      const lines = await G.suggestSplits(a.text, aiConfig());
      const n = commit((st, c) => G.applySplitLines(st, a.id, lines, c));
      if (!n) toast('没有新的小项可加（都已有，或已满 8 条）。');
    } catch (e) {
      longToast(G.splitErrorText(e));
    } finally {
      setSplitting(false);
    }
  };
  const items: MenuItem[] = [
    { label: '拆一拆（AI）', hidden: watch, onSelect: () => void aiSplit() },
    { label: '关联标签', onSelect: bindTags },
    { label: trail ? '收起轨迹' : '查看轨迹', onSelect: () => setTrail(!trail) },
    { label: '修改', onSelect: rename },
    { label: '删除', danger: true, onSelect: remove },
  ];

  return (
    <article class={`goal-card ${a.done ? 'done' : ''} ${watch ? 'watch' : ''}`}>
      <div class="goal-head">
        {watch
          ? <span class="goal-dot" title="观察位" role="img" aria-label="观察位" />
          : <Check checked={!!a.done} label={a.done ? '完成勋章' : '标记完成'} onToggle={() => { if (commit((st, c) => G.toggleGoalDone(st, a.id, c))) toast('这个月的一件，成了。'); }} />}
        <h3 class="goal-title">{a.text}{!watch && a.done && <span class="goal-crown" aria-label="已完成"> ♛</span>}</h3>
        <Menu label="目标操作" items={items} />
      </div>
      <div class="goal-splits">
        {(a.splits || []).map((_, i) => <SplitChip key={i} a={a} i={i} watch={watch} />)}
        <button type="button" class="split-add" onClick={async () => {
          const v = await ask({ title: '加一个小选项', text: '具体到今天 20 分钟能做。', input: 'line' });
          if (v && v.trim()) commit((st, c) => G.addSplit(st, a.id, v, c));
        }}>＋ 写一个</button>
      </div>
      {splitting && <p class="goal-splitting" role="status">在拆…</p>}
      <GoalMore a={a} tags={tags} open={trail} setOpen={setTrail} />
    </article>
  );
}

function PastMonths() {
  const past = G.pastMonths(snapshot.value, G.currentYm(clockNow));
  if (!past.length) return null;
  return (
    <details class="past-months">
      <summary><Icon name="chevron" size={16} />往月</summary>
      {past.map((m) => (
        <div class="past-month" key={m.ym}><b>{m.month}月</b><span>{m.parts.join('　')}</span></div>
      ))}
    </details>
  );
}

function MonthSection() {
  const ym = G.currentYm(clockNow);
  const list = G.monthGoals(snapshot.value, ym);
  const gd = G.goalDoneCount(list);
  return (
    <>
      <h2 class="month-head">
        {Number(ym.split('-')[1])}月
        <span class="month-count">目标位 {G.goalCount(list)}/{G.GOAL_MAX}{gd ? ` · 完成 ${gd}` : ''} · 观察位 {G.watchCount(list)}</span>
      </h2>
      <AddRow />
      {list.length === 0 && <Empty>这个月想推进的几件事。</Empty>}
      {G.orderedGoals(list).map((a) => <GoalCard key={String(a.id)} a={a} />)}
    </>
  );
}

export default function GoalsPage() {
  const ym = G.currentYm(clockNow);
  // Opening a new month is the one write this page makes on its own: legacy created the month
  // (carrying last month's 观察位) the first time anything looked at it. Done once, outside render.
  useEffect(() => {
    if (G.needsOpenWrite(snapshot.value, getApp().clock)) commit((s, c) => G.openGoalsPage(s, c));
  }, [ym]);
  return (
    <div class="goals-page">
      <header class="page-title">
        <h1>成长地图</h1>
        <p>习惯、月目标，以及正在长大的自己。</p>
      </header>
      <Habits />
      <MonthSection />
      <PastMonths />
    </div>
  );
}
