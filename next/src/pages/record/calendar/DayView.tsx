/* 一天: 精选瞬间, the AI moments card (other agent's), then the whole day in time order. */
import { useState } from 'preact/hooks';
import { navigate } from '../../../app/router';
import { snapshot } from '../../../app/state';
import { Markdown } from '../../../domain/markdown';
import { dayEntries, dayHighlights } from '../../../domain/moments';
import { pad } from '../../../core/util';
import type { LogEntry } from '../../../core/types';
import { Button, Empty } from '../../../ui/kit';
import { Icon } from '../../../ui/icons';
import { DailyMoments } from '../../sea/Moments';
import { EditRecordSheet } from '../Composer';
import { RecordMenu } from '../RecordParts';
import { RecordPhotos } from '../photos/RecordPhotos';
import { StarButton } from './StarButton';
import { dayLabel, monthOf, shiftDay } from './nav';

const TYPE_BADGE: Record<string, string> = { done: '完成', bonus: 'bonus' };
const hhmm = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function Highlight({ r, why, log }: { r: LogEntry; why: 'star' | 'auto'; log: LogEntry[] }) {
  return (
    <article class="day-hl" data-record-id={r.id}>
      <header class="rec-head">
        <time>{hhmm(r.t)}</time>
        <span class={`rec-badge ${why === 'star' ? 'is-star' : ''}`}>{why === 'star' ? '★ 精选' : '自动'}</span>
      </header>
      {r.text && <div class="day-excerpt"><Markdown text={r.text} log={log} /></div>}
      <RecordPhotos record={r} />
    </article>
  );
}

export function DayView({ day }: { day: string }) {
  const snap = snapshot.value;
  const [editing, setEditing] = useState<string | null>(null);
  const log = snap.qyx_log || [];
  const entries = dayEntries(snap, day);
  const highlights = dayHighlights(snap, day);

  return (
    <section class="day" aria-label="这一天">
      <header class="cal-head">
        <button type="button" class="cal-nav" aria-label="前一天" onClick={() => navigate('record', 'day', shiftDay(day, -1))}>
          <Icon name="back" size={20} />
        </button>
        <h2>{dayLabel(day)}</h2>
        <button type="button" class="cal-nav" aria-label="后一天" onClick={() => navigate('record', 'day', shiftDay(day, 1))}>
          <Icon name="chevron" size={20} />
        </button>
        <span class="grow" />
        <button type="button" class="link-btn" onClick={() => navigate('record', 'cal', monthOf(day))}>返回月历</button>
      </header>

      {entries.length === 0 ? (
        <div class="day-empty">
          <Empty>这一天还没有记录。</Empty>
          <Button variant="primary" onClick={() => navigate('record')}>去写一笔</Button>
        </div>
      ) : (
        <>
          {highlights.length > 0 && (
            <div class="day-block">
              <h3>精选瞬间</h3>
              {highlights.map((h) => <Highlight key={h.entry.id} r={h.entry} why={h.why} log={log} />)}
            </div>
          )}
          <DailyMoments day={day} />
          <div class="day-block">
            <h3>这一天 · {entries.length} 条</h3>
            {entries.map((r) => (
              <article class="rec rec-compact" key={r.id || r.t} data-record-id={r.id}>
                <header class="rec-head">
                  <time>{hhmm(r.t)}</time>
                  {TYPE_BADGE[r.type] && <span class="rec-badge">{TYPE_BADGE[r.type]}</span>}
                  {r.mood && <span class="rec-mood" aria-label="心情">{r.mood}</span>}
                  <span class="grow" />
                  {r.id && <StarButton record={r} />}
                  {r.id && <RecordMenu recordId={r.id} type={r.type} onEdit={setEditing} />}
                </header>
                {r.text && <div class="rec-text"><Markdown text={r.text} log={log} /></div>}
                <RecordPhotos record={r} />
              </article>
            ))}
          </div>
        </>
      )}
      {editing && <EditRecordSheet recordId={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
