import type { SVGProps } from 'react';

/** Kleines, einheitliches Icon-Set (24er Raster, runde Linien). */
const paths = {
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  sound: 'M4 9v6h4l5 4V5L8 9H4zm12.5-1.5a5 5 0 0 1 0 9M19 5a8.5 8.5 0 0 1 0 14',
  mute: 'M4 9v6h4l5 4V5L8 9H4zm13 0l4 6m0-6l-4 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  book: 'M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2zm0 0v13',
  dumbbell: 'M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5A3 3 0 0 1 16 10M12 13v4m-4 3h8l-1-3H9z',
  store: 'M4 9l1.5-5h13L20 9M4 9h16M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5 11v9h14v-9M10 20v-5h4v5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
  paw: 'M12 13c-3 0-5 3.5-5 5.2 0 1.5 1.3 1.8 2.5 1.8 1 0 1.7-.6 2.5-.6s1.5.6 2.5.6c1.2 0 2.5-.3 2.5-1.8C17 16.5 15 13 12 13zM6 11.5a1.8 2.2 0 1 0 0-.1M18 11.5a1.8 2.2 0 1 0 0-.1M9 7.5a1.8 2.3 0 1 0 0-.1M15 7.5a1.8 2.3 0 1 0 0-.1',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4',
  play: 'M8 5.5v13l10.5-6.5z',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8m0-4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16m0 4v-4h-4',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, weight = 2.4, fill, ...rest }: { name: IconName; size?: number; weight?: number; fill?: string } & Omit<SVGProps<SVGSVGElement>, 'stroke'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ?? 'none'} stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}
