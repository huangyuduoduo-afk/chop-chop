/* Rounded line icons, 24px grid, stroke = currentColor. Add new ones here, not inline. */
import type { JSX } from 'preact';

const paths: Record<string, JSX.Element> = {
  inbox: <><path d="M4 13.5 6.2 6.6A2 2 0 0 1 8.1 5.2h7.8a2 2 0 0 1 1.9 1.4L20 13.5" /><path d="M4 13.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5h-4.2a1 1 0 0 0-.9.6l-.5 1a1 1 0 0 1-.9.6h-3a1 1 0 0 1-.9-.6l-.5-1a1 1 0 0 0-.9-.6Z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1" /></>,
  pen: <><path d="M5 19h4L19 9a2.1 2.1 0 0 0-3-3L6 16Z" /><path d="m14.5 7.5 3 3" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".6" fill="currentColor" /></>,
  bottle: <><path d="M10 3h4M10.5 3v3.2c0 .6-.3 1.1-.7 1.5A5 5 0 0 0 8 11.6V19a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-7.4a5 5 0 0 0-1.8-3.9c-.4-.4-.7-.9-.7-1.5V3" /><path d="M8 14h8" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.3 3h-4l-.3 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.3 2.7h4l.3-2.7a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" /></>,
  sync: <><path d="M19.5 8.5A8 8 0 0 0 5.2 7.4M4.5 15.5a8 8 0 0 0 14.3 1.1" /><path d="M19.8 4.5v4h-4M4.2 19.5v-4h4" /></>,
  more: <><circle cx="6" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="18" cy="12" r="1.3" fill="currentColor" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.2 4.2L19 7" />,
  back: <path d="M15 5 8 12l7 7" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  star: <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8Z" />,
  sparkle: <path d="M12 4c.5 3.6 2.4 5.5 6 6-3.6.5-5.5 2.4-6 6-.5-3.6-2.4-5.5-6-6 3.6-.5 5.5-2.4 6-6Z" />,
  dice: <><rect x="4.5" y="4.5" width="15" height="15" rx="4" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /><circle cx="15" cy="9" r="1" fill="currentColor" /><circle cx="9" cy="15" r="1" fill="currentColor" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
  tag: <><path d="M4 12.6V5.5A1.5 1.5 0 0 1 5.5 4h7.1a1.5 1.5 0 0 1 1 .4l6 6a1.5 1.5 0 0 1 0 2.2l-7 7a1.5 1.5 0 0 1-2.2 0l-6-6a1.5 1.5 0 0 1-.4-1Z" /><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  trash: <><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></>,
  export: <><path d="M12 15V4M8 8l4-4 4 4" /><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></>,
  list: <path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden={label ? undefined : 'true'} aria-label={label} role={label ? 'img' : undefined}>
      {paths[name]}
    </svg>
  );
}
