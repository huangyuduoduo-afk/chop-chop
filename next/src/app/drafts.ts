/*
 * Drafts: everything typed survives reloads, crashes and app switches, and a submit is
 * idempotent.
 *
 * - Saved on every input under `qyx_draft_v5:<context>` (same key as 5.x, so a draft
 *   typed in the old app shows up here).
 * - Each draft carries a `submissionId`. The record created from it is `rec5_<submissionId>`,
 *   so a double tap, or a retry after a crash, finds the existing record instead of adding
 *   another.
 * - Submit reads the textarea's live value (not component state): on iOS the last IME
 *   character may not have fired an input event yet when the button is tapped.
 * - The draft is cleared only after the commit succeeded, and is not restored after that.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

const PREFIX = 'qyx_draft_v5:';

export interface Draft {
  id: string;
  context: string;
  revision: number;
  submissionId: string;
  text: string;
  [extra: string]: unknown;
}

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function read(context: string): Draft | null {
  try {
    const raw = localStorage.getItem(PREFIX + context);
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d.text === 'string' ? d : null;
  } catch {
    return null;
  }
}

function write(d: Draft) {
  try { localStorage.setItem(PREFIX + d.context, JSON.stringify(d)); } catch { /* quota: keep typing, nothing else to do */ }
}

export function fresh(context: string, extra: Partial<Draft> = {}): Draft {
  return { id: uuid(), context, revision: 0, submissionId: uuid(), text: '', ...extra };
}

export function loadDraft(context: string): Draft {
  return read(context) ?? fresh(context);
}

export function clearDraft(context: string) {
  try { localStorage.removeItem(PREFIX + context); } catch { /* ignore */ }
}

export function hasUnsavedDraft(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && read(k.slice(PREFIX.length))?.text.trim()) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Bind a textarea to a persisted draft.
 *
 *   const d = useDraft('note');
 *   <textarea ref={d.ref} value={d.text} onInput={d.onInput} />
 *   d.submit((text, submissionId) => commit(...))   // returns false to keep the draft
 */
export function useDraft(context: string, extra: Partial<Draft> = {}) {
  const [draft, setDraft] = useState<Draft>(() => loadDraft(context));
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const busy = useRef(false);

  useEffect(() => { setDraft(loadDraft(context)); }, [context]);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...extra, ...patch, revision: d.revision + 1 };
      write(next);
      return next;
    });
  };

  const onInput = (e: Event) => update({ text: (e.currentTarget as HTMLTextAreaElement).value });

  async function submit(
    save: (text: string, submissionId: string, draft: Draft) => unknown | Promise<unknown>,
    opts: { allowEmpty?: boolean } = {},
  ): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    try {
      const live = ref.current ? ref.current.value : draft.text;
      if (!live.trim() && !opts.allowEmpty) return false;
      const current = { ...draft, text: live };
      write(current);
      const ok = await save(live, current.submissionId, current);
      if (ok === false) return false;
      clearDraft(context);
      setDraft(fresh(context));
      return true;
    } finally {
      busy.current = false;
    }
  }

  return {
    ref,
    text: draft.text,
    draft,
    onInput,
    update,
    submit,
    discard: () => { clearDraft(context); setDraft(fresh(context)); },
  };
}
