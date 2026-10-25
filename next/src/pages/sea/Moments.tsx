/*
 * 当天的记忆瞬间: the AI only picks 1–3 of the day's records and labels them; each moment shows the
 * label, then her own words (verbatim, excerpt + 展开), the time and the photos. The model is called
 * only from the button; failures show the error and save nothing.
 */
import { useMemo, useState } from 'preact/hooks';
import { aiConfig, commit, getApp, snapshot, today } from '../../app/state';
import { navigate } from '../../app/router';
import type { LogEntry } from '../../core/types';
import * as M from '../../domain/moments-ai';
import { displayReferences } from '../../domain/refs';
import { Button } from '../../ui/kit';
import { RecordPhotos } from '../record/photos/RecordPhotos';

const EXCERPT = 90;

function Quote({ record }: { record: LogEntry }) {
  const log = snapshot.value.qyx_log || [];
  const text = useMemo(() => displayReferences(log, String(record.text || '').trim(), new Map()), [record.text, record.id]);
  const long = Array.from(text).length > EXCERPT;
  const [open, setOpen] = useState(false);
  return (
    <>
      <blockquote class="moment-quote">{long && !open ? Array.from(text).slice(0, EXCERPT).join('') + '…' : text}</blockquote>
      {long && <button type="button" class="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起' : '展开'}</button>}
    </>
  );
}

function Moment({ m }: { m: M.Moment }) {
  const r = (snapshot.value.qyx_log || []).find((x) => x.id === m.recordId);
  const d = r ? new Date(r.t) : null;
  const time = d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  return (
    <article class="moment">
      <h4 class="moment-title">{m.title}</h4>
      {r ? (
        <>
          <Quote record={r} />
          {!!r.images?.length && <RecordPhotos record={r} />}
          <button type="button" class="moment-time" onClick={() => navigate('record', r.id)} aria-label={`打开 ${time} 的记录`}>{time}</button>
        </>
      ) : <p class="sea-fine">原记录已删除。</p>}
    </article>
  );
}

export function DailyMoments({ day }: { day: string }) {
  const s = snapshot.value;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [isError, setIsError] = useState(false);
  const [folded, setFolded] = useState(false);
  const { latest, stale } = useMemo(() => M.momentsForDay(s, day), [s.qyx_daily_review_v51, s.qyx_log, day]);
  const hasRows = useMemo(() => M.momentsMaterial(s, day).length > 0, [s.qyx_log, day]);
  const moments = latest ? M.entryMoments(latest) : [];

  const go = async () => {
    setBusy(true); setIsError(false); setStatus('');
    try {
      const out = await M.requestMoments(snapshot.value, day, aiConfig(), getApp().clock, {
        onSending: () => setStatus(M.MOMENTS_STATUS.sending),
        avoidIds: moments.map((m) => m.recordId),
      });
      if (out.kind === 'ok') {
        commit((st) => M.saveMoments(st, out.entry));
        setFolded(false);
        setStatus(M.MOMENTS_STATUS.saved);
      } else if (out.kind === 'error') {
        setStatus(out.message); setIsError(true);
      } else setStatus(M.MOMENTS_STATUS[out.kind]);
    } finally {
      setBusy(false);
    }
  };

  if (!latest && !hasRows) return <section class="moments" aria-label="记忆瞬间"><p class="sea-fine">这一天还没有文字记录。</p></section>;
  const label = day === today.value ? '挑出今天的瞬间' : '挑出这天的瞬间';
  return (
    <section class="moments" aria-label="记忆瞬间">
      {!latest || !moments.length ? (
        <div class="sea-row"><Button variant="primary" disabled={busy} onClick={() => void go()}>{busy ? '正在挑…' : label}</Button></div>
      ) : folded ? (
        <div class="sea-row"><Button variant="soft" onClick={() => setFolded(false)}>看看挑出的瞬间 · {moments.length}</Button></div>
      ) : (
        <>
          {moments.map((m) => <Moment key={m.recordId} m={m} />)}
          <div class="sea-row">
            <Button variant="soft" disabled={busy} onClick={() => void go()}>{busy ? '正在挑…' : '换一组'}</Button>
            <Button variant="ghost" onClick={() => setFolded(true)}>收起</Button>
          </div>
        </>
      )}
      <p class={`daily-status ${isError ? 'err' : ''}`} role="status" aria-live="polite">{status || (latest && stale ? M.MOMENTS_STATUS.changed : '')}</p>
      {!latest && !status && <p class="sea-fine">{M.MOMENTS_STATUS.empty}</p>}
    </section>
  );
}
