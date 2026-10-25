/*
 * Composer shared by 说说 and 消息盒子. Contexts follow v5 so drafts typed in the old app show up here:
 * 'note', 'new-idea', 'new-from:<id>' (unused), 'idea:<ideaId>', 'edit:<recordId>'.
 *
 * Saving is one tap: useDraft.submit reads the live textarea, the record id derives from the draft's
 * submissionId (a repeat submit never adds a second record) and the draft is cleared only after the
 * commit succeeded. Voice input writes into the draft continuously.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { useDraft } from '../../app/drafts';
import { navigate } from '../../app/router';
import { commit, getApp, snapshot } from '../../app/state';
import { editRecord, editableText, MOODS, submitRecord } from '../../domain/records';
import { IDEA_ICONS, ideaTitle, liveIdeas, ownerOf } from '../../domain/ideas';
import { displayReferences, excerptText, fmtDT, refCandidates, refToken, resolveToken, type RefMap } from '../../domain/refs';
import { Button, Sheet, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { IdeaIcon } from '../ideas/IdeaIcon';
import { useVoice } from './voice';
import './record.css';

export type ComposerMode = 'note' | 'append' | 'new-idea' | 'edit';

export interface ComposerProps {
  mode: ComposerMode;
  context: string;
  /** append: the idea being continued (default owner). */
  ideaId?: string;
  /** edit: the record being edited. */
  editId?: string;
  placeholder?: string;
  saveLabel?: string;
  autoFocus?: boolean;
  onSaved?: (r: { recordId: string; ideaId: string | null }) => void;
  onCancel?: () => void;
}

const wrapTools: { id: string; label: string; title: string }[] = [
  { id: 'bold', label: 'B', title: '加粗' },
  { id: 'italic', label: 'I', title: '斜体' },
  { id: 'heading', label: 'H', title: '小标题' },
  { id: 'bullet', label: '•', title: '项目列表' },
  { id: 'number', label: '1.', title: '序号列表' },
  { id: 'quote', label: '❝', title: '引用段落' },
  { id: 'checklist', label: '☑', title: '可勾选清单' },
  { id: 'link', label: '↗', title: '链接' },
];

export function Composer(props: ComposerProps) {
  const { mode, context } = props;
  const d = useDraft(context);
  const refs = useRef<RefMap | null>(null);
  const getRefs = (): RefMap => (refs.current ||= new Map(Object.entries((d.draft.refs as Record<string, string>) || {})));
  const [fmt, setFmt] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [pickRef, setPickRef] = useState(false);
  const [saving, setSaving] = useState(false);
  const trace = useRef({ entered: 0, active: 0, focusedAt: 0, typed: false });
  const composing = useRef(false);
  const el = () => d.ref.current as HTMLTextAreaElement | null;
  const log = snapshot.value.qyx_log || [];
  const ideas = liveIdeas(snapshot.value);

  const mood = (d.draft.mood as string | undefined) || null;
  const ownDefault = props.ideaId || '';
  const rawTarget = d.draft.ideaTarget as string | undefined;
  const target = rawTarget === undefined ? ownDefault : ideas.some((i) => i.id === rawTarget) ? rawTarget : '';
  const title = (d.draft.title as string) || '';
  const icon = (d.draft.icon as string) || 'star';

  /** Write text into textarea + draft together (refs travel with the draft). */
  const setText = (value: string, extra: Record<string, unknown> = {}) => {
    const t = el();
    if (t && t.value !== value) t.value = value;
    d.update({ text: value, refs: Object.fromEntries(getRefs()), ...extra });
  };

  const voice = useVoice(() => el(), (v) => setText(v));

  // Draft restored from the old app may hold raw @tokens; show readable labels. Edit prefills the record.
  useEffect(() => {
    const t = d.draft.text;
    if (mode === 'edit' && !t && props.editId) {
      const r = (snapshot.value.qyx_log || []).find((x) => x.id === props.editId);
      if (r) setText(displayReferences(log, editableText(snapshot.value, r), getRefs()));
      return;
    }
    const shown = displayReferences(log, t, getRefs());
    if (shown !== t) setText(shown);
  }, [context]);

  useEffect(() => {
    if (props.autoFocus) el()?.focus();
  }, []);

  const onInput = (e: Event) => {
    const v = (e.currentTarget as HTMLTextAreaElement).value;
    trace.current.typed = true;
    d.update({ text: v, refs: Object.fromEntries(getRefs()) });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.isComposing || composing.current || e.shiftKey) return;
    const t = e.currentTarget as HTMLTextAreaElement;
    if (t.selectionStart !== t.selectionEnd) return;
    const pos = t.selectionStart;
    const from = t.value.lastIndexOf('\n', pos - 1) + 1;
    const line = t.value.slice(from, pos);
    let m = /^(\s*)- \[[ xX]\] (.*)$/.exec(line);
    let next = '';
    let body = '';
    if (m) { next = m[1] + '- [ ] '; body = m[2]; }
    else if ((m = /^(\s*)- (.*)$/.exec(line))) { next = m[1] + '- '; body = m[2]; }
    else if ((m = /^(\s*)(\d+)\. (.*)$/.exec(line))) { next = m[1] + (Number(m[2]) + 1) + '. '; body = m[3]; }
    else return;
    e.preventDefault();
    if (!body.trim()) {
      t.setRangeText('', from, pos, 'end');
    } else {
      t.setRangeText('\n' + next, pos, pos, 'end');
    }
    setText(t.value);
  };

  /* ---- Aa 排版 ---- */
  const applyTool = (tool: string) => {
    const t = el();
    if (!t || t.readOnly) return;
    const start = t.selectionStart, end = t.selectionEnd, selected = t.value.slice(start, end);
    const put = (value: string, a: number, b = a) => {
      t.setRangeText(value, start, end, 'end');
      t.focus();
      t.setSelectionRange(start + a, start + b);
      setText(t.value);
    };
    if (tool === 'checklist') return put('- [ ] ' + selected, 6, 6 + selected.length);
    if (tool === 'bold' || tool === 'italic') {
      const mk = tool === 'bold' ? '**' : '*';
      return put(mk + selected + mk, mk.length, mk.length + selected.length);
    }
    if (tool === 'link') {
      const v = '[' + (selected || '链接文字') + '](https://)';
      return put(v, v.length - 1);
    }
    const prefix = ({ heading: '## ', quote: '> ', bullet: '- ', number: '1. ' } as Record<string, string>)[tool];
    if (!prefix) return;
    const from = t.value.lastIndexOf('\n', start - 1) + 1;
    const has = t.value.slice(from).startsWith(prefix);
    t.setRangeText(has ? '' : prefix, from, from + (has ? prefix.length : 0), 'end');
    t.focus();
    const cur = Math.max(from, start + (has ? -prefix.length : prefix.length));
    t.setSelectionRange(cur, cur);
    setText(t.value);
  };

  const insertRef = (raw: string) => {
    const t = el();
    if (!t) return;
    const label = displayReferences(log, raw, getRefs());
    const at = t.selectionEnd ?? t.value.length;
    t.setRangeText(label + ' ', at, at, 'end');
    t.focus();
    setText(t.value);
    setPickRef(false);
  };

  const shelf = [...getRefs()].filter(([label]) => d.text.includes(label));
  const openRef = (raw: string) => {
    const hit = resolveToken(log, raw);
    if (!hit) { toast('原记录暂不可用，引用文字仍会保留。'); return; }
    const owner = ownerOf(snapshot.value, hit.id);
    if (owner) navigate('ideas', owner.ideaId);
    else navigate('record', hit.id);
  };

  /* ---- save ---- */
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const t = el();
      const now = getApp().clock.now();
      const tr = trace.current;
      let active = tr.active + (tr.focusedAt ? now - tr.focusedAt : 0);
      const wall = tr.entered ? now - tr.entered : 0;
      if (!tr.typed) active = wall;
      const fixedMood = mood;
      let outcome: { recordId: string; ideaId: string | null } | null = null;
      const ok = await d.submit((text, sid) => {
        try {
          if (mode === 'edit' && props.editId) {
            const res = commit((s, c) => editRecord(s, props.editId!, text, getRefs(), c));
            if (!res.ok) { if (res.reason !== 'empty') toast('尚未完成保存：' + res.reason + '。文字已保留。'); return false; }
            outcome = { recordId: props.editId, ideaId: null };
            return true;
          }
          const res = commit((s, c) => submitRecord(s, {
            submissionId: sid, text, refs: getRefs(),
            mood: mode === 'note' ? fixedMood : null,
            ideaId: mode === 'new-idea' ? (target || null) : target || null,
            newIdea: mode === 'new-idea' && !target ? { title: title.trim(), icon } : null,
            trace: mode === 'note' && wall > 0 ? { wall, active } : null,
          }, c));
          if (!res.ok) return false;
          outcome = { recordId: res.recordId, ideaId: res.ideaId };
          return true;
        } catch (e) {
          toast('尚未完成保存：' + (e instanceof Error ? e.message : '写入失败') + '。文字已保留。', 4000);
          return false;
        }
      });
      if (!ok || !outcome) return;
      refs.current = new Map();
      trace.current = { entered: 0, active: 0, focusedAt: 0, typed: false };
      setMoodOpen(false);
      if (mode !== 'edit') toast('已保存到本机' + (getApp().store.token ? '，等待云端确认。' : '。'));
      props.onSaved?.(outcome);
      if (mode !== 'edit' && (outcome as { ideaId: string | null }).ideaId && mode !== 'append') navigate('ideas', (outcome as { ideaId: string }).ideaId);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { d.discard(); refs.current = new Map(); props.onCancel?.(); };
  const label = props.saveLabel || (mode === 'edit' ? '保存修改' : mode === 'append' ? '保存补充' : mode === 'new-idea' ? '保存想法' : '记下');
  const placeholder = props.placeholder || (mode === 'note' ? '发生了什么、注意到什么，话多正好……' : mode === 'append' ? '补充一点新的想法……' : mode === 'new-idea' ? '一点想法、一段话，都可以留在这里' : '');
  const listening = voice.phase === 'starting' || voice.phase === 'listening';

  return (
    <div class={`composer mode-${mode}`}>
      {mode === 'new-idea' && (
        <div class="composer-meta">
          {!target && (
            <>
              <div class="icon-pick" role="group" aria-label="选择一个小图标">
                {IDEA_ICONS.map((i) => (
                  <button type="button" class={icon === i.key ? 'on' : ''} aria-label={i.name} aria-pressed={icon === i.key} onClick={() => d.update({ icon: i.key })}>
                    <IdeaIcon name={i.key} size={20} />
                  </button>
                ))}
              </div>
              <input class="input" aria-label="标题（可选）" placeholder="给这个想法起个名字（可选）" value={title}
                onInput={(e) => d.update({ title: e.currentTarget.value })} />
            </>
          )}
        </div>
      )}
      <textarea
        ref={d.ref as preact.RefObject<HTMLTextAreaElement>}
        class="textarea composer-text"
        rows={mode === 'note' || mode === 'new-idea' ? 4 : 3}
        value={d.text}
        readOnly={listening}
        placeholder={placeholder}
        aria-label={placeholder || '正文'}
        autocomplete="off"
        onInput={onInput}
        onKeyDown={onKeyDown}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(e) => { composing.current = false; onInput(e); }}
        onFocus={() => {
          const tr = trace.current;
          if (!tr.entered) tr.entered = getApp().clock.now();
          tr.focusedAt = getApp().clock.now();
        }}
        onBlur={() => {
          const tr = trace.current;
          if (tr.focusedAt && tr.typed) tr.active += getApp().clock.now() - tr.focusedAt;
          tr.focusedAt = 0;
        }}
      />

      {shelf.length > 0 && (
        <div class="ref-shelf">
          {shelf.map(([lab, raw]) => <button type="button" class="chip" onClick={() => openRef(raw)}>{lab} ↗</button>)}
        </div>
      )}

      {voice.phase !== 'idle' && (
        <div class="voice-bar" role="status" aria-live="polite">
          <span class={`voice-dot ${voice.phase === 'listening' ? 'on' : ''}`} />
          <span class="voice-msg">{voice.message}</span>
          <span class="voice-time">{voice.time}</span>
          <Button small variant="ghost" onClick={voice.cancel}>取消</Button>
          <Button small variant="soft" onClick={voice.toggle}>{voice.phase === 'paused' ? '继续' : '暂停'}</Button>
          <Button small variant="primary" onClick={voice.finish}>完成</Button>
        </div>
      )}

      <div class="composer-tools">
        <button type="button" class={`tool ${fmt ? 'on' : ''}`} aria-expanded={fmt} onClick={() => setFmt(!fmt)}>Aa 排版</button>
        {mode === 'note' && (
          <button type="button" class={`tool ${moodOpen ? 'on' : ''}`} aria-expanded={moodOpen} aria-label="心情" onClick={() => setMoodOpen(!moodOpen)}>
            {mood || '心情'}
          </button>
        )}
        {voice.supported && voice.phase === 'idle' && (
          <button type="button" class="tool" onClick={voice.start}><Icon name="mic" size={16} /> 语音输入</button>
        )}
      </div>

      {fmt && (
        <div class="fmt-bar" role="toolbar" aria-label="文字排版工具">
          {wrapTools.map((w) => (
            <button type="button" title={w.title} aria-label={w.title} onPointerDown={(e) => e.preventDefault()} onClick={() => applyTool(w.id)}>{w.label}</button>
          ))}
          <button type="button" title="引用一条记录" aria-label="引用一条记录" onPointerDown={(e) => e.preventDefault()} onClick={() => setPickRef(true)}>@</button>
          <button type="button" title="插入标签" aria-label="插入标签" onPointerDown={(e) => e.preventDefault()}
            onClick={() => { const t = el(); if (!t) return; t.setRangeText('#', t.selectionStart, t.selectionEnd, 'end'); t.focus(); setText(t.value); }}>#</button>
        </div>
      )}

      {moodOpen && mode === 'note' && (
        <div class="mood-row" role="group" aria-label="心情">
          {MOODS.map((m) => (
            <button type="button" class={mood === m ? 'on' : ''} aria-pressed={mood === m} aria-label={m} onClick={() => d.update({ mood: mood === m ? null : m })}>{m}</button>
          ))}
        </div>
      )}

      <div class="composer-foot">
        {mode !== 'edit' ? (
          <label class="owner-pick">
            <span>归属</span>
            <select aria-label="归属想法" value={target} onChange={(e) => d.update({ ideaTarget: e.currentTarget.value })}>
              <option value="">{mode === 'new-idea' ? '新建一条想法' : '只留在说说'}</option>
              {ideas.map((i) => <option value={i.id}>{ideaTitle(snapshot.value, i)}</option>)}
            </select>
          </label>
        ) : <span class="grow" />}
        {mode === 'edit' && <Button variant="ghost" onClick={cancel}>取消</Button>}
        <Button variant="primary" class="save-btn" aria-busy={saving} onClick={save}>{label}</Button>
      </div>

      <RefPicker open={pickRef} onClose={() => setPickRef(false)} onPick={insertRef} />
    </div>
  );
}

function RefPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (raw: string) => void }) {
  const [q, setQ] = useState('');
  const log = snapshot.value.qyx_log || [];
  const rows = open ? refCandidates(log, q, 30) : [];
  return (
    <Sheet open={open} onClose={onClose} title="引用哪条记录？">
      <input class="input" aria-label="搜索记录" placeholder="输入关键字筛选" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <div class="choice-list ref-list">
        {rows.length === 0 && <p class="empty">还没有可引用的记录。</p>}
        {rows.map((r) => (
          <button type="button" class="choice" onClick={() => { const raw = refToken(log, r); if (raw) onPick(raw); }}>
            <small>{fmtDT(r.t)}{r.type === 'done' ? ' · 完成' : r.type === 'ai' ? ' · 问一问' : ''}</small>
            <span>{excerptText(r.text).slice(0, 60)}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Edit dialog used from both pages. */
export function EditRecordSheet({ recordId, onClose }: { recordId: string; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="编辑记录">
      <Composer mode="edit" context={'edit:' + recordId} editId={recordId} autoFocus onSaved={onClose} onCancel={onClose} />
    </Sheet>
  );
}
