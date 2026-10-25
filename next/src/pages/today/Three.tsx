/* 今天的三件事: three rows, their 小项, 抽屉 / 常规 shortcuts and the 往日写过的事项 fold. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { commit, getApp, snapshot } from '../../app/state';
import { enoughStatus } from '../../core/merge';
import type { EnoughItem, EnoughSub, Snapshot } from '../../core/types';
import { dayKey, pad } from '../../core/util';
import { parseTagPaths } from '../../domain/shared';
import { tagPath } from '../../domain/tags';
import * as T from '../../domain/today';
import { Icon } from '../../ui/icons';
import { Button, Card, Check, IconButton, Menu, Sheet, ask, confirmAsk, toast, type MenuItem } from '../../ui/kit';
import { SavedInput } from './SavedInput';

const PLACEHOLDERS = ['第一件', '第二件', '第三件'];

/* ---------- 拆小项 ---------- */

function SplitSheet({ itemText, history, onClose, onAdd }: { itemText: string; history: string[]; onClose: () => void; onAdd: (texts: string[]) => void }) {
  const [line, setLine] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : p.length >= 5 ? p : [...p, t]));
  const submit = () => { onAdd([line, ...picked]); onClose(); };
  return (
    <Sheet open onClose={onClose} title="拆小项"
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" onClick={submit}>添加</Button></>}>
      <p class="dialog-text">{itemText}</p>
      <input class="input" autoFocus placeholder="手写一个小项" aria-label="小项" value={line}
        onInput={(e) => setLine(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) submit(); }} />
      {history.length > 0 && (
        <details class="fold-lite">
          <summary>以前写过的 · 最多选 5 个</summary>
          <div class="chip-wrap">
            {history.map((t) => (
              <button type="button" class={`chip ${picked.includes(t) ? 'active' : ''}`} aria-pressed={picked.includes(t)} onClick={() => toggle(t)}>{t}</button>
            ))}
          </div>
        </details>
      )}
    </Sheet>
  );
}

/* ---------- 小项 list ---------- */

function SubList({ s, i, item, openSubs }: { s: Snapshot; i: number; item: EnoughItem; openSubs: boolean }) {
  const clock = getApp().clock;
  const doneN = item.subs.filter((x) => x.status === 'completed').length;
  const [open, setOpen] = useState(openSubs);
  useEffect(() => { if (openSubs) setOpen(true); }, [openSubs]);
  if (!item.subs.length) return null;
  const edit = async (si: number, sub: EnoughSub) => {
    const v = await ask({ title: '修改小项', input: 'line', value: sub.text });
    if (v === null) return;
    const r = commit((d, c) => T.editSub(d, i, si, v, c));
    if (r === 'empty') toast('小项文字不能为空，可以在菜单里移除。');
  };
  return (
    <div class="subs">
      <button type="button" class="subs-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={14} /> 小项 {doneN}/{item.subs.length}
      </button>
      {open && item.subs.map((sub, si) => {
        const n = T.subCount(s, sub, clock);
        const items: MenuItem[] = [
          { label: '修改文字', onSelect: () => void edit(si, sub) },
          { label: '再做一次', onSelect: () => { commit((d, c) => T.subAgain(d, i, si, c)); } },
          { label: '交给随机', onSelect: () => { const r = commit((d, c) => T.subToOpts(d, i, si, c)); toast(r === 'dup' ? '已经在事项池或待选里。' : r === 'bench' ? '满9条了，先放进待选。' : '排进去了。'); } },
          { label: '移除小项', danger: true, onSelect: () => { commit((d, c) => T.removeSub(d, i, si, c)); } },
        ];
        return (
          <div class={`sub ${sub.status}`}>
            <button type="button" class={`sub-chk ${sub.status}`} aria-label={`${sub.text}：${sub.status === 'completed' ? '已完成，点一下标记时间结束' : sub.status === 'expired' ? '时间结束，点一下恢复未完成' : '未完成，点一下标记完成'}`}
              onClick={() => { commit((d, c) => T.cycleSub(d, i, si, c)); }}>
              {sub.status === 'completed' ? '✓' : sub.status === 'expired' ? '×' : ''}
            </button>
            <span class="sub-text">{sub.text}</span>
            {n >= 2 && (
              <button type="button" class="chip" title="点一下减一次" aria-label={`做了 ${n} 次，点一下减一次`}
                onClick={() => { commit((d, c) => T.subMinus(d, i, si, c)); }}>×{n}</button>
            )}
            <Menu items={items} label="小项操作" />
          </div>
        );
      })}
    </div>
  );
}

/* ---------- focus timer (page-only) ---------- */

function useFocusTimer() {
  const [run, setRun] = useState<{ id: string; end: number } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!run) return;
    const h = setInterval(() => {
      if (Date.now() >= run.end) { setRun(null); toast('20 分钟到了。'); } else tick((x) => x + 1);
    }, 1000);
    return () => clearInterval(h);
  }, [run]);
  const label = (id: string) => {
    if (!run || run.id !== id) return '20 分钟';
    const left = Math.max(0, run.end - Date.now());
    return `${pad(Math.floor(left / 60000))}:${pad(Math.floor((left % 60000) / 1000))}`;
  };
  return { run, setRun, label };
}

/* ---------- one row ---------- */

function Row({ s, i, item, timer }: { s: Snapshot; i: number; item: EnoughItem; timer: ReturnType<typeof useFocusTimer> }) {
  const clock = getApp().clock;
  const [splitOpen, setSplitOpen] = useState(false);
  const [justSplit, setJustSplit] = useState(false);
  const alive = enoughStatus(item) !== 'deleted';
  const text = alive ? item.text : '';
  const written = !!text.trim();
  const status = enoughStatus(item);
  const goalId = (s.qyx_task_goals || {})[item.id];
  const goal = T.goalById(s, goalId);
  const tagIds = [...new Set([...((s.qyx_task_tags || {})[item.id] || []), ...(goal ? (s.qyx_goal_tags || {})[String(goal.id)] || [] : [])])];
  const waited = goal && written ? T.waitingDays(s, goalId, clock) : 0;

  const bindGoal = async () => {
    commit((d, c) => { T.ensureMonthAnchors(d, c); });
    const goals = T.goalsOfMonth(snapshot.value, clock);
    if (!goals.length) { toast('先在「目标」页写下一个本月方向。'); return; }
    const picked = await ask({
      title: '关联本月目标', text: '这件事属于哪个本月方向？',
      choices: [...goals.map((g, k) => ({ label: `${g.text}${String(g.id) === String(goalId) ? '（当前）' : ''}`, value: String(k) })), { label: '取消关联', value: '-' }],
    });
    if (picked === null) return;
    commit((d) => T.setTaskGoal(d, item.id, picked === '-' ? null : goals[+picked].id));
  };
  const bindTags = async () => {
    const cur = ((s.qyx_task_tags || {})[item.id] || []).map((id) => '#' + tagPath(s, id)).join(' ');
    const v = await ask({ title: '关联标签', text: '可以写多个，用空格分开。', input: 'line', value: cur, placeholder: '输入 # 开头的标签，多个用空格分开' });
    if (v === null) return;
    commit((d, c) => T.setTaskTags(d, item.id, parseTagPaths(v), c));
  };
  const remove = async () => {
    if (!(await confirmAsk('删除这件事？', '删除后不会进入昨日总结。', true))) return;
    if (commit((d, c) => T.deleteEnough(d, i, c))) toast('删掉了，不会进入昨日总结。');
  };
  const menu: MenuItem[] = [
    { label: '拆小项', onSelect: () => setSplitOpen(true) },
    { label: '关联目标', onSelect: () => void bindGoal() },
    { label: '标签', onSelect: () => void bindTags() },
    { label: '删除这件事', danger: true, onSelect: () => void remove() },
  ];
  const circle = () => {
    const r = commit((d, c) => T.toggleEnough(d, i, c));
    if (r === 'needs-subs') toast('分项都完成后，主项会自动打勾。');
    else if (r === 'all-done') toast('今天，够了。');
    else if (r === 'expired') toast('这件事先停在这里，留给以后回望。');
  };
  const start20 = () => {
    if (timer.run && timer.run.id === item.id) return;
    commit((d, c) => T.startTwentyMinutes(d, item.text, c));
    timer.setRun({ id: item.id, end: Date.now() + 20 * 60000 });
  };

  return (
    <div class={`erow ${status}`}>
      <div class="erow-main">
        <Check checked={status === 'completed'} onToggle={circle}
          label={!written ? `${PLACEHOLDERS[i]}：先写下这件事` : status === 'completed' ? `${text}：已完成，点一下恢复` : `${text}：点一下标记完成`} />
        <SavedInput class={`today-input ${status === 'completed' ? 'is-done' : ''}`} value={text} placeholder={PLACEHOLDERS[i]}
          aria-label={PLACEHOLDERS[i]} enterkeyhint="done" maxLength={200}
          onSave={(v) => { commit((d, c) => T.setEnoughText(d, i, v, c)); }} />
        {written ? <Menu items={menu} label="事项操作" /> : <span class="menu-gap" />}
      </div>
      {written && <SubList s={s} i={i} item={item} openSubs={justSplit} />}
      {written && (goal || tagIds.length > 0 || waited >= 3) && (
        <div class="erow-meta">
          {goal && <button type="button" class="chip tone-star" onClick={() => void bindGoal()}>↗ 月目标：{goal.text}</button>}
          {tagIds.map((id) => <span class="chip">#{tagPath(s, id)}</span>)}
          {waited >= 3 && (
            <span class="wait">
              挂了 {waited} 天
              <button type="button" class={`chip ${timer.run?.id === item.id ? 'active' : ''}`} onClick={start20}>{timer.label(item.id)}</button>
            </span>
          )}
        </div>
      )}
      {splitOpen && (
        <SplitSheet itemText={item.text.trim()} history={T.pastOptsHistory(s, clock).slice(0, 40).map((x) => x.text)}
          onClose={() => setSplitOpen(false)}
          onAdd={(texts) => { const n = commit((d, c) => T.addSubs(d, i, texts, c)); if (n) setJustSplit(true); }} />
      )}
    </div>
  );
}

/* ---------- 抽屉 / 常规 ---------- */

type Named = { id: string; text: string };

function Shortcuts({ label, list, kind, onUse }: { label: string; list: Named[]; kind: 'drawer' | 'routine'; onUse: (t: string) => void }) {
  const [manage, setManage] = useState(false);
  const clock = getApp().clock;
  const max = kind === 'drawer' ? T.MAX_DRAWERS : T.MAX_ROUTINES;
  const name = kind === 'drawer' ? '抽屉' : '常规';
  const add = async () => {
    if (list.length >= max) { toast(`${name}最多 ${max} 条，先删一条`); return; }
    const v = await ask({ title: `添加${name}`, input: 'line' });
    if (v === null) return;
    const r = commit((d, c) => (kind === 'drawer' ? T.addDrawer(d, v, c) : T.addRoutine(d, v, c)));
    if (r === 'dup') toast(`已经在${name}里了。`);
  };
  const rename = async (x: Named) => {
    const v = await ask({ title: '改抽屉名字', input: 'line', value: x.text });
    if (v === null) return;
    if (commit((d, c) => T.editDrawer(d, x.id, v, c)) === 'dup') toast('已经有同名的抽屉了。');
  };
  void clock;
  return (
    <div class="shortcuts" aria-label={name}>
      <span class="shortcuts-label">{label}</span>
      {list.map((x) => (
        <span class="chip-group">
          <button type="button" class="chip" onClick={() => onUse(x.text)}>{x.text}</button>
          {manage && kind === 'drawer' && <button type="button" class="chip-x" aria-label={`改名：${x.text}`} onClick={() => void rename(x)}>改</button>}
          {manage && <button type="button" class="chip-x" aria-label={`删除：${x.text}`} onClick={() => { commit((d, c) => (kind === 'drawer' ? T.removeDrawer(d, x.id, c) : T.removeRoutine(d, x.id, c))); }}>✕</button>}
        </span>
      ))}
      <IconButton icon="plus" label={`添加${name}`} onClick={() => void add()} />
      {list.length > 0 && <button type="button" class="link-btn" aria-pressed={manage} onClick={() => setManage(!manage)}>{manage ? '完成' : '整理'}</button>}
    </div>
  );
}

/* ---------- 往日写过的事项 ---------- */

function PastHistory({ s, onRestore }: { s: Snapshot; onRestore: (text: string) => void }) {
  const clock = getApp().clock;
  const past = useMemo(() => T.pastOptsHistory(s, clock), [s]);
  const [more, setMore] = useState<string[]>([]);
  const groups: Record<string, typeof past> = {};
  past.forEach((h) => { (groups[dayKey(h.t)] ||= []).push(h); });
  const days = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  const edit = async (h: { t: number; text: string }) => {
    const v = await ask({ title: '修改事项', input: 'line', value: h.text });
    if (v === null) return;
    if (commit((d, c) => T.editOptsHist(d, T.optsHistKey(h), v, c)) === 'empty') toast('文字不能为空，可以在菜单里删除。');
  };
  return (
    <details class="fold">
      <summary>往日写过的事项{past.length ? <span class="count"> {past.length}</span> : null}<small>可选，不选也不用管。</small></summary>
      {!days.length && <p class="empty">过一天再回来，这里会收好你写过的事项。</p>}
      {days.map((key) => {
        const items = groups[key];
        const shown = more.includes(key) ? items : items.slice(0, 6);
        const d = new Date(items[0].t);
        return (
          <section class="hist-day">
            <h3>{d.getMonth() + 1}/{d.getDate()}</h3>
            {shown.map((h) => (
              <div class="hist-row">
                <span class="hist-text">{h.text}</span>
                <IconButton icon="plus" label={`排回今天：${h.text}`} onClick={() => onRestore(h.text)} />
                <Menu label="更多" items={[
                  { label: '修改', onSelect: () => void edit(h) },
                  { label: '删除', danger: true, onSelect: () => { commit((dd, c) => T.removeOptsHist(dd, T.optsHistKey(h), c)); } },
                ]} />
              </div>
            ))}
            {items.length > 6 && !more.includes(key) && <button type="button" class="link-btn" onClick={() => setMore([...more, key])}>更多 · {items.length - 6} 条</button>}
          </section>
        );
      })}
    </details>
  );
}

/* ---------- card ---------- */

export function ThreeCard() {
  const s = snapshot.value;
  const clock = getApp().clock;
  const rows = T.viewEnough(s, clock);
  const timer = useFocusTimer();
  const filled = rows.filter((x) => enoughStatus(x) !== 'deleted' && x.text.trim());
  const allDone = filled.length === 3 && filled.every((x) => enoughStatus(x) === 'completed');
  const drawers = (s.qyx_drawers || []).filter((d) => !rows.some((x) => enoughStatus(x) !== 'deleted' && x.text.trim() === String(d.text || '').trim()));

  const useDrawer = (text: string) => { if (!commit((d, c) => T.useDrawer(d, text, c))) toast('三格都填了。'); };

  // 排到哪里？ for 常规 / 往日写过的事项
  const addSmart = async (text: string) => {
    const plan = T.planAddToToday(snapshot.value, text, clock);
    if (plan.r === 'cancel') return;
    if (plan.r === 'exists') { toast('今天已经有这一条了。'); return; }
    if (plan.r === 'direct') { commit((d, c) => T.addToToday(d, text, null, c)); toast('排进今天了。'); return; }
    const picked = await ask({
      title: '排到哪里？', text,
      choices: [...(plan.canTop ? [{ label: '作为新的一件（大项）', value: 'top' }] : []), ...plan.parents.map((p) => ({ label: `放到「${p.text}」下面`, value: 'sub:' + p.i }))],
    });
    if (picked === null) return;
    if (picked === 'top') { commit((d, c) => T.addToToday(d, text, null, c)); toast('排进今天了。'); return; }
    const r = commit((d, c) => T.addSubToItem(d, +picked.slice(4), text, null, c));
    if (r) toast(`放到「${r.parent}」下面了。`);
  };

  return (
    <Card title="今天的三件事" sub="写下今天想留意的事。" icon="sun" class="three-card">
      <div class="erows">
        {rows.map((item, i) => <Row s={s} i={i} item={item} timer={timer} />)}
      </div>
      {allDone && <p class="enough-fin" role="status">今天，够了。</p>}
      <Shortcuts label="抽屉" kind="drawer" list={drawers} onUse={useDrawer} />
      <Shortcuts label="常规" kind="routine" list={(s.qyx_routines || []).slice(0, T.MAX_ROUTINES)} onUse={(t) => void addSmart(t)} />
      <PastHistory s={s} onRestore={(t) => void addSmart(t)} />
    </Card>
  );
}
