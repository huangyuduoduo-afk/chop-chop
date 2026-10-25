/* 回看这一天 (记忆瞬间; old v5 paragraphs stay readable under 以前的回望) and AI 回望. Both call the AI only from their button. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { aiErrorText } from '../../core/ai';
import { aiConfig, commit, getApp, now, snapshot, today } from '../../app/state';
import { navigate } from '../../app/router';
import type { AiReview, DailyReview } from '../../core/types';
import * as M from '../../domain/moments-ai';
import * as S from '../../domain/sea';
import { Button, Card, confirmAsk, toast } from '../../ui/kit';
import { DailyMoments } from './Moments';

/* ---------------- 回看这一天 ---------------- */

function SourceButtons({ ids }: { ids: string[] }) {
  const s = snapshot.value;
  const open = (id: string) => {
    const r = (s.qyx_log || []).find((x) => x.id === id);
    if (!r) { toast('原记录已删除，无法跳转。'); return; }
    const link = (s.qyx_ideas_v5?.links || []).find((l) => l.recordId === id && !l.removedAt && (s.qyx_ideas_v5?.items || []).some((i) => i.id === l.ideaId && !i.removedAt));
    if (link) navigate('ideas', link.ideaId, id);
    else navigate('record', id);
  };
  return (
    <div class="daily-sources">
      {[...new Set(ids || [])].map((id) => {
        const r = (s.qyx_log || []).find((x) => x.id === id);
        return <button type="button" key={id} onClick={() => open(id)}>{r ? `${S.fmtZh(r.t)} · ${String(r.text || '').trim().slice(0, 38)}` : '原记录已删除'}</button>;
      })}
    </div>
  );
}

function DailyEntry({ e }: { e: DailyReview }) {
  const g = S.gentleNoteOf(e);
  return (
    <article class="daily-entry">
      <small>{e.date} · {S.fmtZh(e.t)}</small>
      {e.paragraphs.map((p, i) => (
        <div class="daily-par" key={i}><p>{p.text}</p><SourceButtons ids={p.source_ids || []} /></div>
      ))}
      {g && <div class="daily-par"><p>{g.text}</p><SourceButtons ids={g.source_ids} /></div>}
    </article>
  );
}

export function DailyCard() {
  const [day, setDay] = useState(today.value);
  const s = snapshot.value;
  const { older } = useMemo(() => M.momentsForDay(s, day), [s.qyx_daily_review_v51, day]);

  return (
    <Card title="回看这一天" sub="挑出值得留下的瞬间，看看自己当时写下的话。" icon="calendar" tone="sky">
      <label class="daily-date">日期 <input class="input" type="date" value={day} onInput={(e) => setDay(e.currentTarget.value || today.value)} /></label>
      <DailyMoments day={day} />
      {older.length > 0 && (
        <details class="daily-older"><summary>以前的回望 · {older.length}</summary>{older.map((e) => <DailyEntry key={e.id} e={e} />)}</details>
      )}
    </Card>
  );
}

/* ---------------- AI 回望 ---------------- */

const hintOff = () => { try { return localStorage.getItem('qyx_review_hint') === '0'; } catch { return false; } };
const hintSince = () => { try { return Number(localStorage.getItem('qyx_review_hint_since')) || 0; } catch { return 0; } };

function ReviewText({ item }: { item: AiReview }) {
  const text = S.cleanAIText(item.text);
  const [folded, setFolded] = useState(text.length > 170);
  return (
    <>
      <div class={`review-text ${folded ? 'folded' : ''}`}>{text}</div>
      {text.length > 170 && <button type="button" class="link-btn" onClick={() => setFolded(!folded)}>{folded ? '展开' : '收起'}</button>}
    </>
  );
}

export function AiReviewCard() {
  const s = snapshot.value;
  const hist = useMemo(() => S.readReviews(s, now.value), [s.qyx_ai_review]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ from: number; to: number; text: string; error?: boolean } | null>(null);
  const [showHist, setShowHist] = useState(false);
  const [openRow, setOpenRow] = useState(-1);

  // Quiet hint: ≥ 7 days and ≥ 20 notes since the last review; goes silent after 14 days of showing.
  const { on, count } = S.reviewHintCount(s, now.value);
  const hintShown = !hintOff() && on && !(hintSince() && now.value - hintSince() >= 14 * 864e5);
  useEffect(() => {
    try {
      if (hintOff() || !on) localStorage.removeItem('qyx_review_hint_since');
      else if (!hintSince()) localStorage.setItem('qyx_review_hint_since', String(now.value));
    } catch { /* local preference only */ }
  }, [on]);

  const generate = async () => {
    setBusy(true); setNote(null);
    try { localStorage.removeItem('qyx_review_hint_since'); } catch { /* ignore */ }
    try {
      const out = await S.requestReview(snapshot.value, aiConfig(), getApp().clock.now());
      if (out.kind === 'ok') commit((st, c) => S.addReview(st, out.item, c));
      else if (out.kind === 'error') setNote({ from: out.from, to: out.to, text: aiErrorText(new Error(out.message)) + '。这次没有保存，记录也没有被消耗。', error: true });
      else setNote({ from: out.from, to: out.to, text: out.text });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (index: number) => {
    if (!(await confirmAsk('删掉这条回望？', '删掉之后，这段时间的记录可以重新回望。', true))) return;
    commit((st, c) => S.deleteReview(st, index, c));
  };

  const latest = hist[0];
  return (
    <Card title="回望 · AI 望望" sub="从这段时间的记录和瓶子里，看看反复出现的主题。" icon="sparkle" tone="pink" actions={<span class="badge">BETA</span>}>
      {hintShown && <p class="review-hint">攒了 {count} 条记录了</p>}
      <div class="sea-row"><Button variant="primary" disabled={busy} onClick={() => void generate()}>{busy ? '正在回望…' : hist.length ? '回望这段时间' : '生成回望'}</Button></div>
      {note && (
        <div class={`review-note ${note.error ? 'err' : ''}`} role={note.error ? 'alert' : 'status'}>
          <div class="review-range">{S.reviewRangeText(note)}</div>
          <p>{note.text}</p>
        </div>
      )}
      {latest && (
        <div class="review-box">
          <div class="review-range"><span>{S.reviewRangeText(latest)}</span><button type="button" class="link-btn" onClick={() => void remove(0)}>删</button></div>
          <ReviewText key={latest.t} item={latest} />
        </div>
      )}
      {hist.length > 1 && (
        <>
          <button type="button" class="link-btn" aria-expanded={showHist} onClick={() => setShowHist(!showHist)}>以前的回望 · {hist.length - 1}</button>
          {showHist && hist.slice(1).map((item, i) => (
            <div class="review-hist" key={item.t}>
              <div class="review-hist-row">
                <button type="button" class="review-hist-item" onClick={() => setOpenRow(openRow === i ? -1 : i)}>
                  <span>{S.reviewRangeText(item)}</span><span>{S.cleanAIText(item.text).slice(0, 40)}</span>
                </button>
                <button type="button" class="link-btn" onClick={() => void remove(i + 1)}>删</button>
              </div>
              {openRow === i && <div class="review-text">{S.cleanAIText(item.text)}</div>}
            </div>
          ))}
        </>
      )}
    </Card>
  );
}
