/* Thumbnail image with a soft placeholder while it loads / has not arrived on this device. */
import { useEffect, useState } from 'preact/hooks';
import { usePhotoUrl } from '../../../app/photos';
import { LATE_MS } from './photoLogic';

/** Small image glyph (the icon set is shared and not ours to extend). */
export function PhotoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="3" /><circle cx="9.5" cy="10" r="1.4" /><path d="m5 17 4.5-4.5L13 16l2.5-2.5L19 17" />
    </svg>
  );
}

export function Thumb({ path, alt, eager }: { path: string; alt: string; eager?: boolean }) {
  const url = usePhotoUrl(path);
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (url) { setLate(false); return; }
    const t = setTimeout(() => setLate(true), LATE_MS);
    return () => clearTimeout(t);
  }, [url, path]);
  if (url) return <img class="ph-img" src={url} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} />;
  return (
    <span class="ph-hold" role="img" aria-label={late ? alt + '，图片还在路上' : alt}>
      <PhotoIcon size={20} />
      {late && <small>图片还在路上</small>}
    </span>
  );
}
