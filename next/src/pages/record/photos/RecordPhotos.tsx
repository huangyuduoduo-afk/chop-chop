/* Thumbnail grid for a record's photos (+ full-screen viewer). 1 = wide, 2–4 = 2 columns, more = 3. */
import { useState } from 'preact/hooks';
import type { LogEntry } from '../../../core/types';
import { gridColumns, photoAlt, tileAspect } from './photoLogic';
import { PhotoViewer } from './PhotoViewer';
import { Thumb } from './Thumb';
import './photos.css';

export function RecordPhotos({ record }: { record: LogEntry }) {
  const list = record.images || [];
  const [open, setOpen] = useState<number | null>(null);
  if (!list.length) return null;
  const n = list.length;
  return (
    <>
      <div class={`ph-grid cols-${gridColumns(n)}`} role="group" aria-label={`${n} 张图片`}>
        {list.map((p, i) => (
          <button type="button" class="ph-tile" key={p.id} style={{ aspectRatio: String(tileAspect(n, p)) }}
            aria-label={`${photoAlt(i, n)}，点开查看`} onClick={() => setOpen(i)}>
            <Thumb path={p.thumb} alt={photoAlt(i, n)} />
          </button>
        ))}
      </div>
      {open !== null && <PhotoViewer photos={list} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}
