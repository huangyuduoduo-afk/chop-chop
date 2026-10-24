/*
 * Shared UI kit. Pages compose these; they do not restyle them.
 * Low-frequency actions go into <Menu> ("…"), never as always-visible buttons.
 */
import { signal } from '@preact/signals';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from './icons';
import './kit.css';

export function Card({ title, sub, icon, actions, children, tone, class: cls }: {
  title?: ComponentChildren; sub?: ComponentChildren; icon?: IconName; actions?: ComponentChildren;
  children?: ComponentChildren; tone?: 'sky' | 'pink' | 'star'; class?: string;
}) {
  return (
    <section class={`card ${tone ? 'tone-' + tone : ''} ${cls || ''}`}>
      {(title || actions) && (
        <header class="card-head">
          {icon && <span class="card-icon"><Icon name={icon} /></span>}
          <div class="card-titles">
            {title && <h2>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          {actions && <div class="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

type BtnProps = JSX.HTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost' | 'danger'; icon?: IconName; small?: boolean };
export function Button({ variant = 'soft', icon, small, children, class: cls, ...rest }: BtnProps) {
  return (
    <button type="button" class={`btn btn-${variant} ${small ? 'btn-sm' : ''} ${cls || ''}`} {...rest}>
      {icon && <Icon name={icon} size={small ? 16 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, class: cls, ...rest }: JSX.HTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" class={`icon-btn ${cls || ''}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

/** Round check toggle used for tasks. */
export function Check({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" class={`check ${checked ? 'on' : ''}`} role="checkbox" aria-checked={checked} aria-label={label} onClick={onToggle}>
      {checked && <Icon name="check" size={15} />}
    </button>
  );
}

export function Chip({ children, active, onClick, tone }: { children: ComponentChildren; active?: boolean; onClick?: () => void; tone?: 'sky' | 'pink' | 'star' }) {
  const Tag = onClick ? 'button' : 'span';
  return <Tag type={onClick ? 'button' : undefined} class={`chip ${active ? 'active' : ''} ${tone ? 'tone-' + tone : ''}`} onClick={onClick}>{children}</Tag>;
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}

/** Textarea that grows with its content. */
export function AutoTextarea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { minRows = 3, class: cls, ...rest } = props;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }, [props.value]);
  return <textarea ref={ref} rows={minRows} class={`textarea ${cls || ''}`} {...rest} />;
}

/* ---------- "…" menu ---------- */

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; icon?: IconName; hidden?: boolean }

export function Menu({ items, label = '更多' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <div class="menu" ref={ref}>
      <IconButton icon="more" label={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} />
      {open && (
        <div class="menu-pop" role="menu">
          {visible.map((i) => (
            <button type="button" role="menuitem" class={i.danger ? 'danger' : ''} onClick={() => { setOpen(false); i.onSelect(); }}>
              {i.icon && <Icon name={i.icon} size={17} />}
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- bottom sheet ---------- */

export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title?: ComponentChildren; children: ComponentChildren; footer?: ComponentChildren;
}) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    document.body.classList.add('no-scroll');
    return () => { document.removeEventListener('keydown', esc); document.body.classList.remove('no-scroll'); };
  }, [open]);
  if (!open) return null;
  return (
    <div class="sheet-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="sheet" role="dialog" aria-modal="true">
        <header class="sheet-head">
          <h2>{title}</h2>
          <IconButton icon="close" label="关闭" onClick={onClose} />
        </header>
        <div class="sheet-body">{children}</div>
        {footer && <footer class="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- toast ---------- */

const toastText = signal('');
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Light, translucent confirmation. Keep messages short. */
export function toast(text: string, ms = 1800) {
  toastText.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastText.value = ''; }, ms);
}
export function ToastHost() {
  return toastText.value ? <div class="toast" role="status">{toastText.value}</div> : null;
}

/* ---------- dialogs (replace alert/confirm/prompt) ---------- */

interface DialogReq {
  title: string; text?: string; input?: 'line' | 'text' | 'date'; value?: string; placeholder?: string;
  ok?: string; cancel?: string; danger?: boolean; choices?: { label: string; value: string }[];
  resolve: (v: string | null) => void;
}
const dialog = signal<DialogReq | null>(null);

/** Ask for a value. Resolves null on cancel. For confirm-only, omit `input`: resolves '' on OK. */
export function ask(opts: Omit<DialogReq, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => { dialog.value = { ...opts, resolve }; });
}
export async function confirmAsk(title: string, text?: string, danger = false): Promise<boolean> {
  return (await ask({ title, text, danger, ok: danger ? '删除' : '好' })) !== null;
}

export function DialogHost() {
  const d = dialog.value;
  const [val, setVal] = useState('');
  useEffect(() => { setVal(d?.value ?? ''); }, [d]);
  if (!d) return null;
  const done = (v: string | null) => { dialog.value = null; d.resolve(v); };
  return (
    <Sheet open onClose={() => done(null)} title={d.title}
      footer={!d.choices && <>
        <Button variant="ghost" onClick={() => done(null)}>{d.cancel || '取消'}</Button>
        <Button variant={d.danger ? 'danger' : 'primary'} onClick={() => done(d.input ? val : '')}>{d.ok || '好'}</Button>
      </>}>
      {d.text && <p class="dialog-text">{d.text}</p>}
      {d.input === 'line' && <input class="input" autoFocus value={val} placeholder={d.placeholder} onInput={(e) => setVal(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) done(val); }} />}
      {d.input === 'date' && <input class="input" type="date" autoFocus value={val} onInput={(e) => setVal(e.currentTarget.value)} />}
      {d.input === 'text' && <AutoTextarea autoFocus value={val} placeholder={d.placeholder} onInput={(e) => setVal(e.currentTarget.value)} />}
      {d.choices && <div class="choice-list">{d.choices.map((c) => <button type="button" class="choice" onClick={() => done(c.value)}>{c.label}</button>)}</div>}
    </Sheet>
  );
}
