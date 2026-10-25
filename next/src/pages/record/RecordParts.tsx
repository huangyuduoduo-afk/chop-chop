/*
 * Pieces shared by the 说说 list and the idea timeline: "…" record menu, checklist tasks,
 * tag chips, date picking.
 */
import { useState } from 'preact/hooks';
import { navigate } from '../../app/router';
import { commit, getApp, now as nowSignal, snapshot } from '../../app/state';
import { selectTaskForToday } from '../../domain/today';
import {
  addRecordToIdea, addTask, createIdeaFromRecord, editTask, findIdea, ideaTitle, isTaskInToday, liveIdeas, moveRecord,
  moveTask, ownerOf, recordTasks, removeTask, scheduleTask, todayKey, tomorrowKey, toggleTask,
} from '../../domain/ideas';
import { deleteRecord } from '../../domain/records';
import { ask, Check, confirmAsk, Menu, toast, type MenuItem } from '../../ui/kit';
import type { Snapshot } from '../../core/types';

/** 今天 / 明天 / 选择日期 / 清除安排. Resolves a day, null (clear) or undefined (cancelled). */
export async function askDay(current?: string | null): Promise<string | null | undefined> {
  const clock = getApp().clock;
  const c = { today: todayKey(clock), tomorrow: tomorrowKey(clock) };
  const pick = await ask({
    title: '安排到某天',
    choices: [
      { label: '今天', value: 'today' }, { label: '明天', value: 'tomorrow' },
      { label: '选择日期', value: 'custom' }, { label: '清除安排', value: 'clear' },
    ],
  });
  if (!pick) return undefined;
  if (pick === 'today') return c.today;
  if (pick === 'tomorrow') return c.tomorrow;
  if (pick === 'clear') return null;
  const v = await ask({ title: '选择日期', input: 'date', value: current || c.today });
  if (v === null) return undefined;
  return v.trim() || undefined;
}

function fail(reason: string) { toast(reason); }

export function tagPath(s: Snapshot, id: string): string | null {
  const tags = s.qyx_tags || [];
  let t = tags.find((x) => x.id === id);
  if (!t) return null;
  const parts: string[] = [];
  for (let n = 0; t && n < 8; n++) { parts.unshift(t.name); t = t.parent_id ? tags.find((x) => x.id === t!.parent_id) : undefined; }
  return parts.join('/');
}

export function TagChips({ recordId }: { recordId: string }) {
  const s = snapshot.value;
  const ids = [...new Set(s.qyx_record_tags?.[recordId] || [])];
  const chips = ids.map((id) => ({ id, path: tagPath(s, id) })).filter((x) => x.path);
  if (!chips.length) return null;
  return (
    <div class="tag-chips">
      {chips.map((c) => (
        <button type="button" class="chip tag-chip" onClick={() => navigate('settings', 'tags', c.id)}>#{c.path}</button>
      ))}
    </div>
  );
}

export function TaskList({ recordId }: { recordId: string }) {
  const s = snapshot.value;
  nowSignal.value; // refresh at day rollover
  const tasks = recordTasks(s, recordId);
  if (!tasks.length) return null;
  return (
    <div class="rec-tasks" aria-label="这条记录的清单">
      {tasks.map((t) => {
        const items: MenuItem[] = [
          {
            label: '修改文字', onSelect: async () => {
              const v = await ask({ title: '修改清单项', input: 'line', value: t.text });
              if (v === null) return;
              const r = commit((d, c) => editTask(d, t.id, v, c));
              if (!r.ok) fail(r.reason);
            },
          },
          {
            label: '安排到某天', onSelect: async () => {
              const day = await askDay(t.scheduledDate);
              if (day === undefined) return;
              const r = commit((d, c) => scheduleTask(d, t.id, day, c));
              if (!r.ok) fail(r.reason);
            },
          },
          {
            label: '选入今天', onSelect: () => {
              let ok = false;
              try { ok = commit((d, c) => selectTaskForToday(d, t.id, c)); } catch { ok = false; }
              if (ok) toast('放进今天了。'); else toast('今天三件事已满');
            },
          },
          { label: '上移', onSelect: () => { commit((d, c) => moveTask(d, t.id, 'up', c)); } },
          { label: '下移', onSelect: () => { commit((d, c) => moveTask(d, t.id, 'down', c)); } },
          {
            label: '删除清单项', danger: true, onSelect: async () => {
              const text = isTaskInToday(s, t.id, getApp().clock)
                ? '正文记录仍会保留；已选入今天三件事，也会一起移出。' : '正文记录仍会保留。';
              if (!(await confirmAsk('删除这条清单？', text, true))) return;
              commit((d, c) => removeTask(d, t.id, c));
            },
          },
        ];
        return (
          <div class="task-row" key={t.id}>
            <Check checked={t.done} label={t.done ? '取消完成' : '标记完成'} onToggle={() => { commit((d, c) => toggleTask(d, t.id, c)); }} />
            <span class={`task-text ${t.done ? 'done' : ''}`}>{t.text}</span>
            {t.scheduledDate && <small class="task-day">安排到 {t.scheduledDate}</small>}
            <Menu label="清单操作" items={items} />
          </div>
        );
      })}
    </div>
  );
}

/** "…" menu of a record. `onEdit` opens the edit sheet owned by the page. */
export function RecordMenu({ recordId, type = 'note', onEdit, insideIdea }: { recordId: string; type?: string; onEdit: (id: string) => void; insideIdea?: string }) {
  const s = snapshot.value;
  const owner = ownerOf(s, recordId);
  const isNote = type === 'note';
  const chooseIdea = async (title: string, withNew: boolean, exclude?: string, none?: boolean) => {
    const choices = [
      ...(withNew ? [{ label: '作为新想法', value: 'new' }] : []),
      ...(none ? [{ label: '移出此想法，保留说说', value: 'none' }] : []),
      ...liveIdeas(s).filter((i) => i.id !== exclude).map((i) => ({ label: (withNew ? '补充到：' : '移到：') + ideaTitle(s, i), value: i.id })),
    ];
    return ask({ title, choices });
  };
  const items: MenuItem[] = [
    { label: '编辑', hidden: !isNote, onSelect: () => onEdit(recordId) },
    {
      label: '添加清单项', hidden: !isNote, onSelect: async () => {
        const v = await ask({ title: '添加清单项', input: 'line', placeholder: '写下一件可勾选的小事' });
        if (!v?.trim()) return;
        commit((d, c) => addTask(d, recordId, v, c));
      },
    },
    { label: '查看所属想法', hidden: !owner || owner.ideaId === insideIdea, onSelect: () => navigate('ideas', owner!.ideaId, recordId) },
    {
      label: '移到别的想法', hidden: !owner || owner.role === 'root', onSelect: async () => {
        const pick = await chooseIdea('更改归属', false, owner!.ideaId, true);
        if (!pick) return;
        const r = commit((d, c) => moveRecord(d, recordId, pick === 'none' ? null : pick, c));
        if (!r.ok) return fail(r.reason);
        if (pick !== 'none') navigate('ideas', pick, recordId);
      },
    },
    {
      label: '收进消息盒子', hidden: !!owner || !isNote, onSelect: async () => {
        const pick = await chooseIdea('收进消息盒子', true);
        if (!pick) return;
        if (pick === 'new') {
          const r = commit((d, c) => createIdeaFromRecord(d, recordId, {}, c));
          if (!r.ok) return fail(r.reason);
          navigate('ideas', r.ideaId, recordId);
        } else {
          const r = commit((d, c) => addRecordToIdea(d, recordId, pick, c));
          if (!r.ok) return fail(r.reason);
          navigate('ideas', pick, recordId);
        }
      },
    },
    {
      label: '删除', danger: true, onSelect: async () => {
        const text = owner ? '这条正文也会从所属想法中移除，其他补充会保留。' : undefined;
        if (!(await confirmAsk('删除这条记录？', text, true))) return;
        commit((d, c) => deleteRecord(d, recordId, c));
      },
    },
  ];
  return <Menu label="记录菜单" items={items} />;
}

/** Unused-state helper so pages can toggle long text. */
export function useToggle(initial = false) {
  const [v, set] = useState(initial);
  return [v, () => set(!v)] as const;
}

export { findIdea };
