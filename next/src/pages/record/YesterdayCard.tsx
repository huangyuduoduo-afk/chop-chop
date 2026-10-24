import { useState } from 'preact/hooks';
import { commit, getApp, now, snapshot } from '../../app/state';
import { fixYesterdaySub, yesterdayReview } from '../../domain/records';
import { Button, toast } from '../../ui/kit';

/** 昨日总结: collapsed by default, read-only except 补勾. */
export function YesterdayCard() {
  const [open, setOpen] = useState(false);
  now.value;
  const v = yesterdayReview(snapshot.value, getApp().clock);
  return (
    <section class="card yday" aria-label="昨日总结">
      <button type="button" class="yday-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="yday-title">昨日总结</span>
        <small>{v.dateLabel}</small>
        <span class="yday-toggle">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div class="yday-body">
          <p class="yday-score"><b>{v.completed} / 3 完成</b><span>完成率 {v.percent}%</span></p>
          {!v.items.length && <p class="empty">昨天没有留下三件事。空白也算一天。</p>}
          {v.items.map((i) => (
            <div class="yday-item">
              <div class="yday-row">
                <span class={`yday-mark ${i.status}`}>{i.status === 'completed' ? '✓' : i.expired ? '×' : i.progress ? i.progress + '%' : ''}</span>
                <span>{i.text}</span>
              </div>
              {i.subs.map((s) => (
                <div class="yday-sub">
                  <span>{s.status === 'completed' ? '✓' : s.status === 'expired' ? '×' : '○'} {s.text}{s.count >= 2 ? ` ×${s.count}` : ''}</span>
                  {s.status !== 'completed' && v.canFix && (
                    <Button small variant="soft" onClick={() => {
                      const r = commit((d, c) => fixYesterdaySub(d, i.text, s.text, c));
                      toast(r.ok ? '补上了，记在昨天。' : r.reason);
                    }}>补勾</Button>
                  )}
                </div>
              ))}
            </div>
          ))}
          <p class="yday-line">切 {v.stats.cut} · 记 {v.stats.notes} · 划掉 {v.stats.done}</p>
          <div class="yday-sec"><b>Bonus</b>
            {v.bonus.length ? v.bonus.map((b) => <span>{b.done ? '✓' : '○'} {b.text}</span>) : <span class="faint">昨天没有留下 Bonus。</span>}
          </div>
          <div class="yday-sec"><b>问一问</b>
            {v.questions.length ? v.questions.map((q) => <div><small>{q.q}</small><p>{q.text}</p></div>) : <span class="faint">昨天没有使用问一问。</span>}
          </div>
          <div class="yday-sec"><b>AI 回望 · 洞察</b><p>{v.insight}</p></div>
          {v.habits.length > 0 && <p class="faint">{v.habits.join('　·　')}</p>}
        </div>
      )}
    </section>
  );
}
