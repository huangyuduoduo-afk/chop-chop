/* 问一问: one input, one verdict, optional pushback. Only runs on an explicit tap. */
import { useRef, useState } from 'preact/hooks';
import { useDraft } from '../../app/drafts';
import { aiConfig, commit, getApp, snapshot } from '../../app/state';
import { aiErrorText, runAI, type AiMessage } from '../../core/ai';
import * as T from '../../domain/today';
import { AutoTextarea, Button, Card, ask, toast } from '../../ui/kit';

type Phase = 'idle' | 'verdict' | 'follow' | 'final';

/** The textarea's live value (on iOS the last IME character may not have fired `input` yet). */
const liveValue = (id: string, fallback: string) => (document.getElementById(id) as HTMLTextAreaElement | null)?.value ?? fallback;

export function AskCard() {
  const s = snapshot.value;
  const clock = getApp().clock;
  const input = useDraft('today-ask');
  const answer = useDraft('today-ask-answer');
  const history = useRef<AiMessage[]>([]);
  const [busy, setBusy] = useState<'' | 'start' | 'argue'>('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [reply, setReply] = useState('');
  const [err, setErr] = useState('');
  const rules = s.qyx_rules || [];

  const run = async (system: string, messages: AiMessage[]) => {
    const r = await runAI(aiConfig(), system, messages);
    if (!r.text) throw new Error('没有返回内容');
    return r.text;
  };

  const start = async () => {
    if (busy) return;
    const typed = liveValue('today-ask-input', input.text);
    const snap = snapshot.value;
    setBusy('start'); setErr(''); setPhase('idle'); setReply('');
    const system = T.aiFirstSystem(T.aiContext(snap, clock));
    history.current = [{ role: 'user', content: T.aiFirstUser(snap, typed) }];
    try {
      const text = await run(system, history.current);
      history.current.push({ role: 'assistant', content: text });
      setReply(text); setPhase('verdict');
      commit((d, c) => { T.logAiFirst(d, text, typed, c); });
    } catch (e) {
      setErr(aiErrorText(e));
    } finally { setBusy(''); }
  };

  const argue = async () => {
    const ans = liveValue('today-ask-answer', answer.text).trim();
    if (!ans || busy) return;
    const snap = snapshot.value;
    setBusy('argue'); setErr('');
    const system = T.aiArgueSystem(T.aiContext(snap, clock));
    const turns = [...history.current, { role: 'user' as const, content: T.aiArgueUser(snap, ans) }];
    try {
      const text = await run(system, turns);
      setReply(text); setPhase('final');
      commit((d, c) => { T.logAiArgue(d, text, ans, c); });
      answer.discard();
      history.current = [];
    } catch (e) {
      setErr(aiErrorText(e)); // history untouched: a retry sends the same turns once
    } finally { setBusy(''); }
  };

  const obey = () => {
    history.current = [];
    setPhase('idle'); setReply(''); setErr('');
    input.discard(); answer.discard();
    toast('去吧。');
  };

  const saveRule = async () => {
    const v = await ask({ title: '存为我的准则', text: '保存前还可以改成更像你的话。', input: 'text', value: T.ruleSeed(reply) });
    if (v === null) return;
    const r = commit((d, c) => T.saveRule(d, v, c));
    if (r === 'saved') toast('存了。以后同类的，按这条来。');
  };

  return (
    <Card title="问一问" sub="今天卡在哪儿？我帮你理一下。" icon="sparkle" class="ask-card">
      <AutoTextarea id="today-ask-input" value={input.text} onInput={input.onInput} minRows={3} aria-label="背景、选项和你的想法"
        placeholder="背景 + 选项 + 你的想法（有截止时间一定写上）" />
      <div class="row-end">
        <button type="button" class="btn btn-primary" disabled={!!busy} onClick={() => void start()}>{busy === 'start' ? '…' : '开始梳理 ✦'}</button>
      </div>
      {err && <p class="ai-err" role="alert">{err}</p>}
      {reply && <p class="ai-reply" aria-live="polite">{reply}</p>}
      {reply && phase !== 'follow' && (
        <div class="ai-actions">
          <Button variant="primary" onClick={obey}>照做</Button>
          {phase === 'verdict' && <Button onClick={() => setPhase('follow')}>不服</Button>}
          <Button variant="ghost" onClick={() => void saveRule()}>存准则</Button>
        </div>
      )}
      {phase === 'follow' && (
        <div class="ai-follow">
          <AutoTextarea id="today-ask-answer" value={answer.text} onInput={answer.onInput} minRows={2} autoFocus placeholder="说吧" aria-label="追问或不服" />
          <div class="row-end">
            <button type="button" class="btn btn-soft" disabled={!!busy} onClick={() => void argue()}>{busy === 'argue' ? '…' : '再切一次'}</button>
          </div>
        </div>
      )}
      {rules.length > 0 && (
        <details class="fold-lite">
          <summary>我的准则 <span class="count">{rules.length}</span></summary>
          {rules.map((r) => (
            <div class="rule-line">
              <span>{r.text}</span>
              <button type="button" class="chip-x" aria-label={`删除准则：${r.text}`} onClick={() => { commit((d, c) => T.removeRule(d, r, c)); }}>✕</button>
            </div>
          ))}
        </details>
      )}
    </Card>
  );
}
