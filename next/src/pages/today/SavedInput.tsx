/*
 * A text input that saves itself: after a pause, on blur and on Enter, and once more when the page
 * unmounts. It never drops what was typed — the shown value only follows the stored value while the
 * input has no unsaved typing — and it waits for IME composition to finish.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

type Props = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onInput' | 'onBlur' | 'onKeyDown'> & {
  value: string;
  onSave: (value: string) => void;
  delay?: number;
};

export function SavedInput({ value, onSave, delay = 700, ...attrs }: Props) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const last = useRef(value);
  const latest = useRef({ onSave, value });
  latest.current = { onSave, value };

  useEffect(() => { if (!dirty.current) { setText(value); last.current = value; } }, [value]);

  const flush = () => {
    clearTimeout(timer.current);
    if (!dirty.current || composing.current) return;
    dirty.current = false;
    if (last.current !== latest.current.value) latest.current.onSave(last.current);
  };
  useEffect(() => () => flush(), []);

  return (
    <input
      {...attrs}
      ref={ref}
      value={text}
      onInput={(e) => {
        const v = e.currentTarget.value;
        last.current = v; dirty.current = true; setText(v);
        clearTimeout(timer.current);
        if (!composing.current) timer.current = setTimeout(flush, delay);
      }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(e) => {
        composing.current = false; last.current = e.currentTarget.value; dirty.current = true;
        clearTimeout(timer.current); timer.current = setTimeout(flush, delay);
      }}
      onBlur={flush}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) { flush(); e.currentTarget.blur(); } }}
    />
  );
}
