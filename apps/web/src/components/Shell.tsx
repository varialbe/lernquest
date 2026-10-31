import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { petStage } from '@lernquest/shared';
import { assetUrl } from '../lib/api.ts';
import { useMe } from '../lib/queries.ts';
import { Icon, type IconName } from './icons.tsx';
import { Avatar } from './Pet.tsx';

function Stat({ img, value, label, color, to }: { img: string; value: ReactNode; label: string; color: string; to?: string }) {
  const inner = (
    <span className="flex items-center gap-1 rounded-xl px-1.5 py-1 font-black" style={{ color }} aria-label={label} title={label}>
      <img src={assetUrl(img)} alt="" className="h-7 w-7 object-contain" />
      <span className="tabular-nums">{value}</span>
    </span>
  );
  return to ? <Link href={to}>{inner}</Link> : inner;
}

/** Kopfzeile: Streak, Coins, Tagesziel-Ring, Avatar. */
export function TopBar({ left }: { left?: ReactNode }) {
  const { data: me } = useMe();
  const s = me?.stats;
  const goal = s ? Math.min(1, s.todayXp / s.dailyGoal) : 0;
  const active = me?.pets.find((p) => p.petId === me.settings.activePet);
  return (
    <header className="safe-top sticky top-0 z-30 border-b-2 border-line bg-bg/92 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-xl items-center justify-between gap-2 px-3">
        <div className="min-w-0 flex-1">{left}</div>
        <div className="flex items-center gap-0.5">
          <Stat img="item-flame" value={s?.streak ?? '–'} label={`${s?.streak ?? 0} Tage Streak`} color={s?.streakActiveToday ? 'var(--c-flame)' : 'var(--c-muted)'} to="/profile" />
          <Stat img="item-coin" value={s?.coins ?? '–'} label="Coins" color="var(--c-gold-dark)" to="/shop" />
          <Link href="/profile" aria-label="Profil" className="relative ml-1">
            <svg width="44" height="44" viewBox="0 0 44 44" className="absolute -inset-[2px] -rotate-90" aria-hidden>
              <circle cx="22" cy="22" r="20" fill="none" stroke="var(--c-border)" strokeWidth="3" />
              <circle cx="22" cy="22" r="20" fill="none" stroke="var(--c-success)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${goal * 125.7} 125.7`} />
            </svg>
            <Avatar pet={me?.settings.activePet ?? null} petStage={active ? petStage(active.xp) : 1} frame={me?.settings.frame ?? null} size={40} name={me?.user.displayName ?? '?'} />
          </Link>
        </div>
      </div>
    </header>
  );
}

const NAV: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: '/', label: 'Lernen', icon: 'book', match: (p) => p === '/' },
  { to: '/practice', label: 'Üben', icon: 'dumbbell', match: (p) => p.startsWith('/practice') },
  { to: '/praxis', label: 'Praxis', icon: 'sparkle', match: (p) => p.startsWith('/praxis') },
  { to: '/league', label: 'Liga', icon: 'trophy', match: (p) => p.startsWith('/league') },
  { to: '/pets', label: 'Pets', icon: 'paw', match: (p) => p.startsWith('/pets') },
  { to: '/shop', label: 'Shop', icon: 'store', match: (p) => p.startsWith('/shop') },
];

export function BottomNav() {
  const [path] = useLocation();
  const { data: me } = useMe();
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-2 border-line bg-surface/95 backdrop-blur-md" aria-label="Navigation">
      <div className="mx-auto grid h-16 max-w-xl grid-cols-6">
        {NAV.map((n) => {
          const active = n.match(path);
          const badge = n.to === '/practice' ? (me?.stats.dueReviews ?? 0) : 0;
          return (
            <Link key={n.to} href={n.to} className="group flex flex-col items-center justify-center gap-0.5" aria-current={active ? 'page' : undefined}>
              <span className={`relative flex h-9 w-11 items-center justify-center rounded-2xl border-2 transition-colors ${active ? 'border-primary bg-primary-soft text-primary' : 'border-transparent text-muted group-hover:text-ink'}`}>
                <Icon name={n.icon} size={22} />
                {badge > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[11px] font-black text-white">{badge > 99 ? '99+' : badge}</span>}
              </span>
              <span className={`text-[11px] font-extrabold ${active ? 'text-primary' : 'text-muted'}`}>{n.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Page({ children, topLeft, noNav }: { children: ReactNode; topLeft?: ReactNode; noNav?: boolean }) {
  return (
    <div className="min-h-dvh">
      <TopBar left={topLeft} />
      <main className={`mx-auto max-w-xl px-4 pt-4 ${noNav ? 'pb-10' : 'pb-28'}`}>{children}</main>
      {!noNav && <BottomNav />}
    </div>
  );
}
