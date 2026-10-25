/* Browser-side helpers for downloads, printing and the PNG long image. No data logic here. */
import { imageLines } from '../../domain/export';

export function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  try { a.click(); } finally { setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000); }
}

export const downloadText = (name: string, text: string, type: string) => downloadBlob(name, new Blob([text], { type }));

/** Print-styled page in a new window; falls back to a hidden iframe when pop-ups are blocked. */
export function printHtml(html: string) {
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
    return;
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) { frame.remove(); throw new Error('浏览器阻止了窗口，请允许弹窗后再试'); }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); }, 300);
  setTimeout(() => frame.remove(), 120000);
}

const token = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

/** 1080 px wide long image of the Markdown (max 330 wrapped lines, like legacy). Colours come from the design tokens. */
export function downloadImage(name: string, md: string, subtitle: string) {
  const W = 1080, pad = 76, maxW = W - pad * 2, font = "'PingFang SC','Microsoft YaHei',sans-serif";
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('这个浏览器不支持生成图片');
  ctx.font = `500 27px ${font}`;
  const raw: { text: string; heading: boolean }[] = [];
  imageLines(md).forEach(({ text, heading }) => {
    if (!text) { raw.push({ text: '', heading: false }); return; }
    let part = '';
    for (const ch of text) {
      if (ctx.measureText(part + ch).width > maxW) { raw.push({ text: part, heading }); part = ch; } else part += ch;
    }
    if (part) raw.push({ text: part, heading });
  });
  const maxLines = 330;
  const lines = raw.slice(0, maxLines);
  if (raw.length > maxLines) lines.push({ text: '内容较多，完整内容请使用 Markdown 或 JSON 导出。', heading: false });
  const lineH = 44, H = Math.max(900, 180 + lines.length * lineH);
  cv.width = W; cv.height = H;
  ctx.fillStyle = token('--bg', 'white'); ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = token('--sky-deep', 'black'); ctx.font = `700 48px ${font}`; ctx.fillText('chop chop!', pad, 82);
  ctx.fillStyle = token('--ink-faint', 'gray'); ctx.font = `500 22px ${font}`; ctx.fillText(subtitle, pad, 122);
  let y = 176;
  lines.forEach((l) => {
    ctx.font = l.heading ? `700 31px ${font}` : `500 27px ${font}`;
    ctx.fillStyle = l.heading ? token('--sky-deep', 'black') : token('--ink', 'black');
    ctx.fillText(l.text, pad, y);
    y += lineH;
  });
  cv.toBlob((blob) => { if (blob) downloadBlob(name, blob); }, 'image/png');
}
