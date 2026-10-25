import { navigate } from '../../app/router';
import { commit, snapshot } from '../../app/state';
import {
  IDEA_ICONS, ideaTitle, removeIdea, renameIdea, scheduleIdea, setIdeaIcon, toggleIdeaStatus,
} from '../../domain/ideas';
import { selectIdeaForToday } from '../../domain/today';
import { ask, confirmAsk, Menu, toast } from '../../ui/kit';
import { askDay } from '../record/RecordParts';
import type { Idea } from '../../core/types';

/** The "…" menu of an idea (card and detail header). */
export function IdeaMenu({ idea, detail }: { idea: Idea; detail?: boolean }) {
  const done = idea.status === 'completed';
  const check = (r: { ok: boolean; reason?: string }) => { if (!r.ok && r.reason) toast(r.reason); return r.ok; };
  return (
    <Menu label="想法菜单" items={[
      { label: '接着写', hidden: !!detail, onSelect: () => navigate('ideas', idea.id) },
      {
        label: '修改标题', onSelect: async () => {
          const v = await ask({ title: '修改标题', input: 'line', value: idea.title || '', placeholder: '留空则用第一句话' });
          if (v === null) return;
          check(commit((d, c) => renameIdea(d, idea.id, v, c)));
        },
      },
      {
        label: '更换图标', onSelect: async () => {
          const v = await ask({ title: '更换图标', choices: IDEA_ICONS.map((i) => ({ label: i.name, value: i.key })) });
          if (v) check(commit((d, c) => setIdeaIcon(d, idea.id, v, c)));
        },
      },
      {
        label: '安排到某天', onSelect: async () => {
          const day = await askDay(idea.scheduledDate);
          if (day === undefined) return;
          check(commit((d, c) => scheduleIdea(d, idea.id, day, c)));
        },
      },
      {
        label: '选入今天', onSelect: () => {
          let ok = false;
          try { ok = commit((d, c) => selectIdeaForToday(d, idea.id, c)); } catch { ok = false; }
          toast(ok ? '放进今天了。' : '今天三件事已满');
        },
      },
      { label: done ? '重新打开' : '标记完成', onSelect: () => { check(commit((d, c) => toggleIdeaStatus(d, idea.id, c))); } },
      {
        label: '从消息盒子移除', danger: true, onSelect: async () => {
          const s = snapshot.value;
          if (!(await confirmAsk('从消息盒子移除？', `「${ideaTitle(s, idea)}」的所有正文仍保留在说说中。`, true))) return;
          if (check(commit((d, c) => removeIdea(d, idea.id, c))) && detail) navigate('ideas');
        },
      },
    ]} />
  );
}
