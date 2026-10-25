/* Full-screen photo viewer: a dialog with focus on the close button. Esc / backdrop / × close; arrows and swipe browse. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { PhotoRef } from '../../../core/types';
import { usePhotoUrl } from '../../../app/photos';
import { Icon } from '../../../ui/icons';
import { clampIndex, photoAlt, swipeStep } from './photoLogic';
import { PhotoIcon } from './Thumb';
import './photos.css';

export function PhotoViewer({ photos, start, onClose }: { photos: PhotoRef[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(() => clampIndex(start, photos.length));
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const n = photos.length;
  const cur = photos[clampIndex(i, n)];
  const full = usePhotoUrl(cur?.path);
  const thumb = usePhotoUrl(cur?.thumb);
  const go = (d: -1 | 1) => setI((x) => clampIndex(x + d, n));

  useEffect(() => {
    closeRef.current?.focus();
    document.body.classList.add('no-scroll');
    const back = opener.current as HTMLElement | null;
    return () => { document.body.classList.remove('no-scroll'); back?.focus?.(); };
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Tab') {
      // keep focus inside the dialog
      const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length;
      e.preventDefault();
      items[next].focus();
    }
  };

  if (!cur) return null;
  const shown = full || thumb;
  return createPortal(
    <div class="ph-viewer" role="dialog" aria-modal="true" aria-label={`查看图片 ${i + 1}/${n}`} onKeyDown={onKey}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchStart={(e) => { const t = e.touches[0]; touch.current = t ? { x: t.clientX, y: t.clientY } : null; }}
      onTouchEnd={(e) => {
        const s = touch.current, t = e.changedTouches[0];
        touch.current = null;
        if (!s || !t) return;
        const step = swipeStep(t.clientX - s.x, t.clientY - s.y);
        if (step) go(step === -1 ? 1 : -1);
      }}>
      <button type="button" ref={closeRef} class="ph-close" aria-label="关闭" onClick={onClose}><Icon name="close" size={22} /></button>
      <div class="ph-stage" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {shown
          ? <img class={`ph-full ${full ? '' : 'soft'}`} src={shown} alt={photoAlt(clampIndex(i, n), n)} draggable={false} />
          : <span class="ph-hold big" role="img" aria-label={photoAlt(clampIndex(i, n), n) + '，图片还在路上'}><PhotoIcon size={28} /><small>图片还在路上</small></span>}
      </div>
      {n > 1 && (
        <>
          <button type="button" class="ph-nav prev" aria-label="上一张" disabled={i <= 0} onClick={() => go(-1)}><Icon name="back" size={22} /></button>
          <button type="button" class="ph-nav next" aria-label="下一张" disabled={i >= n - 1} onClick={() => go(1)}><Icon name="chevron" size={22} /></button>
          <p class="ph-count" aria-live="polite">{i + 1} / {n}</p>
        </>
      )}
    </div>,
    document.body,
  );
}
