/* 说说: composer on top, then every record newest first, grouped by day. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { navigate, route } from '../../app/router';
import { getApp, now, snapshot } from '../../app/state';
import { Markdown } from '../../domain/markdown';
import { charCount, fmtSpan } from '../../domain/refs';
import { dayTitle, greeting, groupByDay, ownerIdea, recordsNewestFirst } from '../../domain/records';
import { ideaTitle } from '../../domain/ideas';
import type { LogEntry } from '../../core/types';
import { Empty } from '../../ui/kit';
import { pad } from '../../core/util';
import { Composer, EditRecordSheet } from './Composer';
import { RecordMenu, TagChips, TaskList } from './RecordParts';
import { YesterdayCard } from './YesterdayCard';
import './record.css';

const TYPE_BADGE: Record<string, string> = { dice: '骰子', ai: '问一句', draw: '抽签', done: '完成', bonus: 'bonus' };
const CLAMP = 360;

function Row({ r, log, onEdit, hit }: { r: LogEntry; log: LogEntry[]; onEdit: (id: string) => void; hit: boolean }) {
  const [open, setOpen] = useState(false);
  const s = snapshot.value;
  const idea = ownerIdea(s, r.id);
  const d = new Date(r.t);
  const long = r.text.length > CLAMP;
  const badge = r.type === 'mark' ? (r.mark === 'trash' ? '不再出现' : '有启发') : TYPE_BADGE[r.type] || (r.type === 'note' ? '' : r.type);
  const wall = Number(r.wall), active = Number(r.active);
  return (
    <article class={`rec ${hit ? 'ref-hit' : ''}`} id={'rec-' + r.id} data-record-id={r.id}>
      <header class="rec-head">
        <time>{pad(d.getHours())}:{pad(d.getMinutes())}</time>
        {badge && <span class="rec-badge">{badge}</span>}
        {typeof r.src === 'string' && r.src && <span class="rec-badge">{r.src}</span>}
        {r.mood && <span class="rec-mood" aria-label="心情">{r.mood}</span>}
        <span class="grow" />
        {r.id && <RecordMenu recordId={r.id} type={r.type} onEdit={onEdit} />}
      </header>
      {r.type === 'ai' && r.q && <p class="rec-q">{r.q}</p>}
      {(r.text || r.type !== 'note') && (
        <div class={long && !open ? 'rec-text clamped' : 'rec-text'}>
          <Markdown text={r.text} log={log} onGo={(t) => navigate('record', t.id)} />
        </div>
      )}
      {long && <button type="button" class="link-btn" onClick={() => setOpen(!open)}>{open ? '收起' : '展开全文'}</button>}
      {r.type === 'note' && wall > 0 && active > 0 && (
        <p class="rec-trace">{charCount(r.text)} 字 · {fmtSpan(active)}{wall - active > 60000 ? ` · 中间离开 ${fmtSpan(wall - active)}` : ''}</p>
      )}
      <TaskList recordId={r.id} />
      <TagChips recordId={r.id} />
      {idea && <button type="button" class="chip owner-chip" onClick={() => navigate('ideas', idea.id)}>↗ {ideaTitle(s, idea)}</button>}
    </article>
  );
}

export default function RecordPage() {
  const snap = snapshot.value;
  now.value;
  const clock = getApp().clock;
  const target = route.value.params[0];
  const [editing, setEditing] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [limit, setLimit] = useState(60);
  const [flash, setFlash] = useState<string | null>(null);
  const [pick] = useState(() => Math.floor(Math.random() * 1000));

  const groups = useMemo(() => groupByDay(recordsNewestFirst(snap)), [snap.qyx_log]);
  const log = snap.qyx_log || [];

  // Opened from a @引用 card ("去那条"): reveal the row and flash it.
  useEffect(() => {
    if (!target) return;
    setAll(true);
    setLimit(Infinity as number);
    setFlash(target);
    const t1 = setTimeout(() => document.getElementById('rec-' + target)?.scrollIntoView({ block: 'center' }), 60);
    const t2 = setTimeout(() => setFlash(null), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [target]);

  let shownGroups = all ? groups : groups.slice(0, 2);
  let budget = limit;
  shownGroups = shownGroups.map((g) => {
    const rows = g.rows.slice(0, Math.max(0, budget));
    budget -= rows.length;
    return { ...g, rows };
  }).filter((g) => g.rows.length);
  const hidden = groups.length > 2 && !all;
  const more = all && budget <= 0 && log.length > limit;

  return (
    <div class="record-page">
      <div class="greet">
        <img src="avatar.jpg" alt="陪你记录的头像" width="44" height="44" />
        <p>{greeting(snap, clock, pick)}</p>
      </div>
      <YesterdayCard />
      <section class="card composer-card" aria-label="写一笔">
        <Composer mode="note" context="note" />
      </section>

      <div class="list-head">
        <h2>最近事件</h2>
        {groups.length > 2 && <button type="button" class="link-btn" onClick={() => setAll(!all)}>{all ? '收起较早记录' : '查看全部记录'}</button>}
      </div>
      {groups.length === 0 && <Empty>还没有记录。第一笔随时可以来。</Empty>}
      {shownGroups.map((g) => (
        <section class="day-group" key={g.day}>
          <h3>{dayTitle(g.day, clock)}</h3>
          {g.rows.map((r) => <Row key={r.id || r.t} r={r} log={log} onEdit={setEditing} hit={flash === r.id} />)}
        </section>
      ))}
      {hidden && <button type="button" class="all-records" onClick={() => setAll(true)}>查看全部记录　›</button>}
      {more && <button type="button" class="all-records" onClick={() => setLimit(limit + 60)}>再看更多</button>}
      {editing && <EditRecordSheet recordId={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
