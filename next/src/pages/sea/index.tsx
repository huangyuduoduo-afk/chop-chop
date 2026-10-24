/* 瓶子: throw, fish, 漫游, 标签回望, 事件图回望, 回看这一天, AI 回望. Rendering never writes data; AI only on a tap. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { aiConfig, commit, getApp, now, snapshot, today } from '../../app/state';
import { useDraft } from '../../app/drafts';
import { navigate } from '../../app/router';
import type { Bottle } from '../../core/types';
import * as S from '../../domain/sea';
import { Button, Card, Empty, toast } from '../../ui/kit';
import { AiReviewCard, DailyCard } from './Reviews';
import './sea.css';

const lastFishKey = 'qyx_lastfish';

/* ---------------- throw + fish ---------------- */

function BottleCard({ bottle, onClose }: { bottle: Bottle; onClose: () => void }) {
  const d = useDraft('bottle-followup:' + bottle.id);
  const t = now.value;
  const save = async () => {
    const ok = await d.submit((text) => {
      commit((s, c) => S.addFollowup(s, bottle.id, text, c));
      toast('放回去了。');
    });
    onClose();
    return ok;
  };
  return (
    <section class="bottle-card card" aria-label="捞到的瓶子">
      <div class="bottle-date">{S.daysAgo(bottle.t, t)}的你 · {S.fmtDT(bottle.t)}</div>
      <p class="bottle-text">{bottle.text}</p>
      {(bottle.followups || []).map((f) => (
        <div class="bottle-follow" key={f.t}>
          <div class="bottle-date">后续 · {S.daysAgo(f.t, t)} · {S.fmtDT(f.t)}</div>
          <p class="bottle-text">{f.text}</p>
        </div>
      ))}
      <textarea ref={d.ref as any} class="textarea" rows={2} value={d.text} onInput={d.onInput} placeholder="现在回头看——写个后续（可不写）" aria-label="后续" />
      <div class="bottle-actions">
        <Button variant="primary" onClick={() => void save()}>写好了，放回海里</Button>
        <Button variant="ghost" onClick={onClose}>就看看，放回去</Button>
      </div>
    </section>
  );
}

function ThrowFish() {
  const s = snapshot.value;
  const d = useDraft('bottle');
  const [fished, setFished] = useState<Bottle | null>(null);
  const [none, setNone] = useState('');
  const [lastFish, setLastFish] = useState<unknown>(() => getApp().store.get(lastFishKey, ''));
  const glow = S.pearlOn(s, now.value, lastFish);

  const throwIt = () =>
    d.submit((text) => {
      commit((st, c) => S.throwBottle(st, text, c));
      toast('扔出去了。不用管它了。');
    });
  const fishIt = () => {
    const r = S.fish(snapshot.value, now.value);
    if (r.kind === 'none') { setFished(null); setNone(r.message); return; }
    setNone('');
    // Local-only "fished today" marker (not synced) — written by this tap, never by render.
    getApp().store.setRaw(lastFishKey, today.value);
    setLastFish(today.value);
    setFished(r.bottle);
  };
  // Show the live copy of the bottle so a saved follow-up appears without re-fishing.
  const live = fished ? (s.qyx_bottles || []).find((b) => b.id === fished.id) || fished : null;

  return (
    <>
      <Card title="写下来，扔进海里" sub="担心、灵感和贪心都可以。过些日子再回来看看。" icon="bottle">
        <textarea ref={d.ref as any} class="textarea" rows={3} value={d.text} onInput={d.onInput} placeholder="担心的、贪心的，都行" aria-label="瓶子内容" />
        <div class="sea-row">
          <Button variant="primary" onClick={() => void throwIt()}>扔进海里</Button>
        </div>
      </Card>
      <p class="sea-count" role="status">{S.seaCountText(s)}</p>
      <button type="button" class={`fish-btn ${glow ? 'glow' : ''}`} onClick={fishIt}>
        <b>捞一个瓶子</b><small>随机捞一个旧瓶子</small>
      </button>
      {none && <Empty>{none}</Empty>}
      {live && <BottleCard key={String(live.id)} bottle={live} onClose={() => setFished(null)} />}
    </>
  );
}

/* ---------------- 漫游 ---------------- */

function Roam() {
  const s = snapshot.value;
  const day = today.value;
  const pick = useMemo(
    () => S.pickRoam(S.roamPool(s, now.value), getApp().store.get<S.RoamSaved | null>('qyx_roam_local', null), now.value),
    [s.qyx_log, s.qyx_dead, day],
  );
  // The chosen three are remembered per day in a local-only key (not synced, not part of the data).
  useEffect(() => { if (pick?.save) getApp().store.setRaw('qyx_roam_local', pick.save); }, [pick]);
  if (!pick) return null;
  return (
    <Card title="漫游" sub="三十天以前的自己" icon="sparkle" tone="pink">
      <div class="roam-list">
        {pick.chosen.map((e) => (
          <article class="roam-item" key={S.roamEntryId(e)}>
            <time>{S.fmtDT(e.t)}</time>{e.mood ? <span class="roam-mood">{e.mood}</span> : null}
            <p>{e.text}</p>
          </article>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- 事件图回望 ---------------- */

function Marked({ text, ev }: { text: string; ev?: string }) {
  const i = ev ? text.indexOf(ev) : -1;
  if (!ev || i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark class="ev">{ev}</mark>{text.slice(i + ev.length)}</>;
}

function MemoryMap() {
  const s = snapshot.value;
  const { entries, groups } = useMemo(() => S.memoryGroups(s, now.value), [s.qyx_log, s.qyx_bottles, today.value]);
  const [open, setOpen] = useState('');
  const [evidence, setEvidence] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const active = groups.find((g) => g.name === open);
  const items = active ? S.memoryEvidenceItems(active) : [];

  /** Explicit tap: sends the (up to 5) entries shown to the AI service and marks one evidence word in each. */
  const markEvidence = async () => {
    if (!active) return;
    setBusy(true);
    try {
      const found = await S.loadMemoryEvidence(snapshot.value, items, active.name, aiConfig());
      setEvidence((old) => new Map([...old, ...found]));
      if (!found.size) toast('没找到可标出的词。');
    } catch {
      toast('这次没连上，先看原文就好。', 3500); // plain text stays; nothing is saved
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="事件图回望" sub="看看最近哪些主题反复出现。" icon="search" actions={<span class="badge">AI回望</span>}>
      {!entries.length ? (
        <Empty>多留几笔，主题会在这里慢慢连起来。</Empty>
      ) : (
        <>
          <div class="memory-row">
            {groups.map((g) => (
              <button type="button" key={g.name} class={`memory-node ${open === g.name ? 'on' : ''}`} aria-pressed={open === g.name} onClick={() => setOpen(open === g.name ? '' : g.name)}>
                <span class="orb">{g.icon}</span><b>{g.name}</b><small>{g.count} 次</small>
              </button>
            ))}
          </div>
          {active && (
            <div class="memory-detail">
              {items.map((e) => (
                <article key={S.memoryEvidenceKey(e)}>
                  <time>{S.fmtDT(e.t)}</time>
                  <p><Marked text={e.text} ev={evidence.get(S.memoryEvidenceKey(e))} /></p>
                </article>
              ))}
              {items.length > 0 && (
                <Button small disabled={busy} onClick={() => void markEvidence()}>{busy ? '正在标…' : '用 AI 标出证据词'}</Button>
              )}
              {items.length > 0 && <p class="sea-fine">点这个按钮才会把上面这几条的文字发给 AI 服务。</p>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function SeaPage() {
  return (
    <div class="sea-page">
      <header class="page-title">
        <h1>瓶子</h1>
        <p>保存未来会想回看的自己。</p>
      </header>
      <ThrowFish />
      <Roam />
      <Card title="标签回望" sub="沿着自己写下的标签，重新找到过去。" icon="tag">
        <Button small onClick={() => navigate('settings', 'tags')}>标签库　›</Button>
      </Card>
      <MemoryMap />
      <DailyCard />
      <AiReviewCard />
    </div>
  );
}
