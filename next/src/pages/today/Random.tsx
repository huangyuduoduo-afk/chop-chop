/* 交给随机: roll one of the 打转区, 定过的, 待选, and a tiny action when it is hard to move. */
import { useState } from 'preact/hooks';
import { useDraft } from '../../app/drafts';
import { commit, getApp, snapshot } from '../../app/state';
import { pad } from '../../core/util';
import * as T from '../../domain/today';
import { Icon } from '../../ui/icons';
import { Button, Card, IconButton, Menu, toast } from '../../ui/kit';

function Qian({ text, onYes, onAgain, yes = '就这个', again = '再掷' }: { text: string; onYes: () => void; onAgain: () => void; yes?: string; again?: string }) {
  const d = new Date(getApp().clock.now());
  return (
    <div class="qian">
      <p class="qian-text" aria-live="polite">{text}</p>
      <time class="qian-stamp">{pad(d.getHours())}:{pad(d.getMinutes())}</time>
      <div class="qian-actions">
        <Button variant="primary" onClick={onYes}>{yes}</Button>
        <Button variant="ghost" onClick={onAgain}>{again}</Button>
      </div>
    </div>
  );
}

function Opts({ opts, last }: { opts: string[]; last: string | null }) {
  const draft = useDraft('today-opt');
  const add = () => {
    void draft.submit((text) => {
      const t = text.trim();
      const r = commit((d, c) => T.addToOpts(d, t, c));
      toast(r === 'dup' ? '已经在事项池或待选里。' : r === 'bench' ? '满9条了，先放进待选。' : '排进去了。');
    });
  };
  return (
    <>
      <div class="opt-add">
        <input ref={draft.ref as any} class="input" value={draft.text} onInput={draft.onInput} maxLength={120}
          placeholder={`加一件事，最多${T.MAX_OPTS}条`} aria-label="加一件事到打转区" enterkeyhint="done"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) add(); }} />
        <IconButton icon="plus" label="加入打转区" onClick={add} />
      </div>
      {!opts.length && <p class="empty tight">先写几件进来。</p>}
      <div class="chip-wrap">
        {opts.map((o) => (
          <span class={`chip-menu ${last === o ? 'won' : ''}`}>
            <span>{o}</span>
            <Menu label={`${o}：更多`} items={[
              { label: '这次不掷它', onSelect: () => { commit((d) => T.benchOpt(d, o)); } },
              { label: '移除', danger: true, onSelect: () => { commit((d, c) => T.removeOpt(d, o, c)); } },
            ]} />
          </span>
        ))}
      </div>
    </>
  );
}

export function RandomCard() {
  const s = snapshot.value;
  const clock = getApp().clock;
  const opts = s.qyx_opts || [];
  const bench = s.qyx_bench || [];
  const ongoing = s.qyx_ongoing || [];
  const [dice, setDice] = useState<string | null>(null);
  const [micro, setMicro] = useState<string | null>(null);

  const roll = () => {
    if (opts.length < 2) { toast(opts.length === 1 ? '只有一件，不用掷——就它。' : '先在下面写几件进来'); return; }
    setDice(T.pickRandom(opts, dice, Math.random));
  };
  const accept = () => {
    if (dice === null) return;
    commit((d, c) => T.acceptDice(d, dice, c));
    setDice(null);
    toast('定了。去。');
  };
  const rollMicro = () => {
    const pool = T.microPool(s, clock);
    if (!pool.length) { toast('动作池是空的，去设置里加几个'); return; }
    setMicro(T.pickRandom(pool, micro, Math.random));
  };
  const acceptMicro = () => {
    if (micro === null) return;
    commit((d, c) => T.acceptMicro(d, micro, c));
    setMicro(null);
    toast('定了。去。');
  };

  return (
    <Card title="交给随机" sub="选择困难的时候，让它温和地帮你选。" icon="dice" tone="pink" class="random-card">
      <button type="button" class="dice-hero" onClick={roll}>
        <span class="dice-glyph"><Icon name="dice" size={26} /></span>
        <span><strong>交给随机</strong><small>不知道先做什么时，让它温和地帮你选</small></span>
      </button>
      {dice !== null && <Qian text={dice} onYes={accept} onAgain={roll} />}
      <Opts opts={opts} last={dice} />

      {bench.length > 0 && (
        <details class="fold-lite">
          <summary>待选 · 这次不掷 <span class="count">{bench.length}</span></summary>
          <div class="chip-wrap">
            {bench.map((o) => (
              <span class="chip-menu">
                <span>{o}</span>
                <Menu label={`${o}：更多`} items={[
                  { label: '放回打转区', onSelect: () => { if (!commit((d) => T.benchBack(d, o))) toast('满了，先掷掉一件。'); } },
                  { label: '移除', danger: true, onSelect: () => { commit((d, c) => T.removeBench(d, o, c)); } },
                ]} />
              </span>
            ))}
          </div>
        </details>
      )}

      {ongoing.length > 0 && (
        <details class="fold-lite">
          <summary>定过的 · 点一下排回 <span class="count">{ongoing.length}</span></summary>
          <div class="chip-wrap">
            {ongoing.map((o) => (
              <span class="chip-group">
                <button type="button" class="chip" onClick={() => { const r = commit((d, c) => T.addToOpts(d, o.text, c)); toast(r === 'dup' ? '已经在事项池或待选里。' : r === 'bench' ? '满9条了，先放进待选。' : '排进去了。'); }}>↻ {o.text}</button>
                <button type="button" class="chip-x" aria-label={`标记完成：${o.text}`} onClick={() => { commit((d, c) => T.completeOngoing(d, o.id, c)); toast('划掉了。'); }}>✓</button>
              </span>
            ))}
          </div>
        </details>
      )}

      <details class="fold-lite">
        <summary>动不了的时候</summary>
        <div class="row-end">
          <Button onClick={rollMicro}>抽一个最小动作</Button>
        </div>
        {micro !== null && <Qian text={micro} onYes={acceptMicro} onAgain={rollMicro} again="再抽" />}
      </details>
    </Card>
  );
}
