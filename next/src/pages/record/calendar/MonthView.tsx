/* 月历: Monday-first 6×7 grid with photo covers, record dots and stars; the month's 精选 below. */
import { useMemo } from 'preact/hooks';
import { usePhotoUrl } from '../../../app/photos';
import { navigate } from '../../../app/router';
import { snapshot, today } from '../../../app/state';
import { dayKey, pad } from '../../../core/util';
import { monthGrid, type CalendarDay } from '../../../domain/moments';
import { Button } from '../../../ui/kit';
import { Icon } from '../../../ui/icons';
import { dayLabel, monthLabel, shiftMonth } from './nav';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const STARRABLE = new Set(['note', 'done', 'bonus']);

function Cell({ c, isToday }: { c: CalendarDay; isToday: boolean }) {
  const cover = usePhotoUrl(c.cover?.thumb);
  const n = Number(c.day.slice(8));
  const dots = Math.min(c.records, 4);
  const label = `${dayLabel(c.day)}，${c.records} 条记录${c.starred ? `，${c.starred} 条精选` : ''}`;
  return (
    <button
      type="button"
      role="gridcell"
      class={`cal-cell ${c.inMonth ? '' : 'out'} ${isToday ? 'today' : ''} ${cover ? 'has-cover' : ''} ${c.records ? 'lived' : ''}`}
      data-day={c.day}
      aria-label={label}
      aria-current={isToday ? 'date' : undefined}
      onClick={() => navigate('record', 'day', c.day)}
    >
      {cover && <img class="cal-cover" src={cover} alt="" loading="lazy" />}
      <span class="cal-num">{n}</span>
      {c.starred > 0 && <span class="cal-star" aria-hidden="true">★</span>}
      {dots > 0 && (
        <span class="cal-dots" aria-hidden="true">
          {Array.from({ length: dots }, (_, i) => <i key={i} />)}
        </span>
      )}
    </button>
  );
}

export function MonthView({ month }: { month: string }) {
  const snap = snapshot.value;
  const todayKey = today.value;
  const grid = useMemo(() => monthGrid(snap, month), [snap.qyx_log, month]);
  const starred = useMemo(
    () => (snap.qyx_log || [])
      .filter((e) => e.starredAt && STARRABLE.has(e.type) && dayKey(e.t).slice(0, 7) === month)
      .sort((a, b) => b.t - a.t),
    [snap.qyx_log, month],
  );
  const thisMonth = todayKey.slice(0, 7);

  return (
    <section class="cal" aria-label="月历">
      <header class="cal-head">
        <button type="button" class="cal-nav" aria-label="上个月" onClick={() => navigate('record', 'cal', shiftMonth(month, -1))}>
          <Icon name="back" size={20} />
        </button>
        <h2>{monthLabel(month)}</h2>
        <button type="button" class="cal-nav" aria-label="下个月" onClick={() => navigate('record', 'cal', shiftMonth(month, 1))}>
          <Icon name="chevron" size={20} />
        </button>
        <span class="grow" />
        <Button small variant="soft" disabled={month === thisMonth} onClick={() => navigate('record', 'cal', thisMonth)}>今天</Button>
      </header>
      <div class="cal-grid" role="grid" aria-label={monthLabel(month)}>
        <div class="cal-week" role="row">
          {WEEK.map((w) => <span key={w} role="columnheader">{w}</span>)}
        </div>
        {grid.map((c) => <Cell key={c.day} c={c} isToday={c.day === todayKey} />)}
      </div>
      <div class="cal-starred">
        <h3>精选{starred.length ? ` · ${starred.length}` : ''}</h3>
        {starred.length === 0 && <p class="faint">这个月还没有精选。给想留住的记录点一颗星。</p>}
        {starred.map((e) => {
          const d = new Date(e.t);
          return (
            <button type="button" class="cal-star-row" key={e.id || e.t} onClick={() => navigate('record', 'day', dayKey(e.t))}>
              <span class="cal-star-when">{d.getMonth() + 1}月{d.getDate()}日 {pad(d.getHours())}:{pad(d.getMinutes())}</span>
              <span class="cal-star-text">{(e.text || '').replace(/\s+/g, ' ').trim() || (e.images?.length ? '（图片）' : '（无文字）')}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
