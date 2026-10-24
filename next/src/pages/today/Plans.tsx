/* 安排到这一天: ideas and checklist items scheduled for a day, to pick into today's three. */
import { useState } from 'preact/hooks';
import { navigate } from '../../app/router';
import { commit, getApp, snapshot, today } from '../../app/state';
import { enoughStatus } from '../../core/merge';
import { ideaTitle } from '../../domain/ideas';
import * as T from '../../domain/today';
import { Button, ask, toast } from '../../ui/kit';

type Pick = { kind: 'task' | 'idea'; id: string };

export function PlansCard() {
  const s = snapshot.value;
  const clock = getApp().clock;
  const [picked, setPicked] = useState<string>('');
  const day = picked || today.value;
  const { ideas, tasks } = T.dayPlans(s, day);
  const count = ideas.length + tasks.length;

  const select = async ({ kind, id }: Pick) => {
    if (day !== today.value) { toast('历史安排保留原样；只能选入今天的三件事。'); return; }
    const rows = T.viewEnough(snapshot.value, clock);
    const choice = await ask({
      title: '放进今天哪一件？',
      choices: rows.map((x, i) => ({ label: `第 ${i + 1} 件 · ${enoughStatus(x) !== 'deleted' && x.text.trim() ? x.text : '空位'}`, value: String(i) })),
    });
    if (choice === null) return;
    const slot = +choice;
    const cur = rows[slot];
    if (enoughStatus(cur) !== 'deleted' && cur.text.trim()) {
      const ok = await ask({ title: '替换今天这件事？', text: `原来的文字会从今天三件事移出；${kind === 'task' ? '原计划' : '想法'}和历史记录不会删除。`, ok: '替换' });
      if (ok === null) return;
    }
    const done = commit((d, c) => (kind === 'task' ? T.selectTaskForToday(d, id, c, slot) : T.selectIdeaForToday(d, id, c, slot)));
    if (!done) toast('没能放进去，请再试一次。');
  };

  return (
    <details class="card day-plans">
      <summary>
        <span class="plans-title">安排到这一天{count ? <span class="count"> {count}</span> : null}</span>
      </summary>
      <label class="plans-date">查看日期
        <input type="date" class="input" aria-label="查看日期" value={day} onInput={(e) => setPicked(e.currentTarget.value)} />
      </label>
      {count === 0 && <p class="empty">这一天没有安排的想法或清单。可以在想法菜单里选择日期。</p>}
      {ideas.map((i) => (
        <div class="plan-row">
          <span class="plan-text">{ideaTitle(s, i)}</span>
          <Button small variant="ghost" onClick={() => navigate('ideas', i.id)}>查看</Button>
          <Button small onClick={() => void select({ kind: 'idea', id: i.id })}>选入三件事</Button>
        </div>
      ))}
      {tasks.map((t) => (
        <div class="plan-row">
          <span class="plan-text">{t.done ? '✓' : '○'} {t.text}</span>
          <Button small onClick={() => void select({ kind: 'task', id: t.id })}>选入三件事</Button>
        </div>
      ))}
    </details>
  );
}
