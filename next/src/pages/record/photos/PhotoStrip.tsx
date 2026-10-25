/*
 * Composer's picture strip: thumbnails of what will be saved, × to remove, tap one to reorder (◀ ▶).
 * Calm by default: the reorder row only shows for the selected photo.
 */
import { useEffect, useState } from 'preact/hooks';
import type { PhotoRef } from '../../../core/types';
import { Icon } from '../../../ui/icons';
import { photoAlt } from './photoLogic';
import { Thumb } from './Thumb';
import './photos.css';

export function PhotoStrip({ items, working, confirmRemove, onRemove, onMove }: {
  items: PhotoRef[];
  /** Files still being compressed / staged. */
  working: number;
  /** First × only arms the tile (used when removing deletes an already-saved photo). */
  confirmRemove?: boolean;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  if (!items.length && !working) return null;
  const n = items.length;
  const at = items.findIndex((p) => p.id === sel);
  return (
    <div class="ph-strip-wrap">
      <ul class="ph-strip" aria-label="将要保存的图片">
        {items.map((p, i) => (
          <li key={p.id} class={`ph-chip ${sel === p.id ? 'on' : ''}`}>
            <button type="button" class="ph-chip-main" aria-label={`${photoAlt(i, n)}，点一下可调整顺序`} aria-pressed={sel === p.id}
              onClick={() => setSel(sel === p.id ? null : p.id)}>
              <Thumb path={p.thumb} alt={photoAlt(i, n)} eager />
            </button>
            <button type="button" class={`ph-x ${armed === p.id ? 'armed' : ''}`}
              aria-label={armed === p.id ? `再点一次，删除${photoAlt(i, n)}` : `移除${photoAlt(i, n)}`}
              onClick={() => {
                if (confirmRemove && armed !== p.id) { setArmed(p.id); return; }
                setArmed(null);
                if (sel === p.id) setSel(null);
                onRemove(p.id);
              }}>
              {armed === p.id ? '删除' : <Icon name="close" size={13} />}
            </button>
          </li>
        ))}
        {Array.from({ length: working }, (_, k) => (
          <li key={'w' + k} class="ph-chip working" role="status" aria-label="图片处理中"><span class="ph-hold"><small>处理中</small></span></li>
        ))}
      </ul>
      {at >= 0 && n > 1 && (
        <div class="ph-order" role="group" aria-label="调整图片顺序">
          <span>第 {at + 1} / {n} 张</span>
          <button type="button" aria-label="往前移" disabled={at === 0} onClick={() => onMove(items[at].id, -1)}><Icon name="back" size={18} /></button>
          <button type="button" aria-label="往后移" disabled={at === n - 1} onClick={() => onMove(items[at].id, 1)}><Icon name="chevron" size={18} /></button>
        </div>
      )}
    </div>
  );
}
