/* The ten idea icons (paths from v5). Unknown keys fall back to the star. */
const PATHS: Record<string, string> = {
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  sprout: 'M12 21V11M12 14C3 15 3 6 3 6s9-1 9 8ZM12 11C12 3 21 3 21 3s0 8-9 8Z',
  cup: 'M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5ZM17 9h2a3 3 0 0 1 0 6h-2M7 3v2m5-2v2M3 22h16',
  note: 'M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5',
  camera: 'M3 7h5l2-3h4l2 3h5v14H3ZM16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  plane: 'm3 10 18-7-7 18-3-8Zm8 3L21 3',
  flower: 'M12 9C5-1 0 10 9 12 0 18 10 24 12 15c6 9 14-1 3-3C25 6 15-2 12 9ZM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  wave: 'M2 18c7 0 3-14 13-13-5 6-1 11 7 10-4 9-12 3-20 3Z',
  light: 'M8 17c0-3-4-3-4-8a8 8 0 1 1 16 0c0 5-4 5-4 8ZM9 21h6M12 17v-6',
  bottle: 'M9 2h6v5l4 5v9H5v-9l4-5ZM9 5h6M5 15h14',
};

export function IdeaIcon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.star} />
    </svg>
  );
}
