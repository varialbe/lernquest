import { usePageT } from '../i18n/pages.ts';
import { translateGameText } from '../i18n/catalog.ts';
import { formatNumber, useLocale } from '../i18n/index.tsx';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { LEAGUES, type LeaderboardEntry } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Avatar, Mascot } from '../components/Pet.tsx';
import { Page } from '../components/Shell.tsx';
import { Segmented, Spinner } from '../components/ui.tsx';
import { useLeaderboard } from '../lib/queries.ts';

const LEAGUE_COLORS = ['#cd7f32', '#a8b3c7', '#f5b301', '#3b82f6', '#e11d48', '#22d3ee'];
const TABS = [
  { value: 'league', label: 'Liga' },
  { value: 'alltime', label: 'Allzeit' },
  { value: 'streak', label: 'Streaks' },
  { value: 'ds', label: 'DS' },
  { value: 'eip', label: 'EIP' },
  { value: 'era', label: 'ERA' },
];

function useCountdown(iso?: string) {
  const t = usePageT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return '';
  const ms = Math.max(0, Date.parse(iso) - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? t("{days} T {hours} Std", {days: d, hours: h}) : t("{hours} Std {minutes} Min", {hours: h, minutes: Math.floor((ms % 3_600_000) / 60_000)});
}

function Row({ e, unit }: { e: LeaderboardEntry; unit: string }) {
  const t = usePageT();
  const { locale } = useLocale();
  const medal = e.rank <= 3 ? ['#f5b301', '#a8b3c7', '#cd7f32'][e.rank - 1] : undefined;
  return (
    <Link href={e.me ? '/profile' : `/u/${e.username}`}>
      <motion.div layout className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${e.me ? 'border-2 border-primary bg-primary-soft' : 'border-2 border-transparent'}`}>
        <span className="w-7 text-center text-lg font-black" style={{ color: medal ?? 'var(--c-muted)' }}>
          {e.rank}
        </span>
        <Avatar pet={e.pet} petStage={e.petStage} frame={e.frame} size={46} name={e.displayName} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-black">{e.displayName}{e.me && t(' (du)')}</p>
          <p className="truncate text-xs font-bold text-muted">@{e.username}</p>
        </div>
        <span className="shrink-0 font-black tabular-nums">
          {formatNumber(e.value, locale)} <span className="text-xs text-muted">{unit}</span>
        </span>
      </motion.div>
    </Link>
  );
}

export default function League() {
  const t = usePageT();
  const { locale } = useLocale();
  const [kind, setKind] = useState('league');
  const { data, isLoading } = useLeaderboard(kind);
  const countdown = useCountdown(data?.resetsAt);
  const tier = data?.league ? LEAGUES.indexOf(data.league as (typeof LEAGUES)[number]) : -1;
  const unit = kind === 'streak' ? t('Tage') : 'XP';

  return (
    <Page topLeft={<h1 className="text-xl font-black">{t("Bestenliste")}</h1>}>
      <Segmented value={kind} onChange={setKind} options={TABS.map((tab) => ({ ...tab, label: translateGameText(tab.label, locale) }))} />
      {kind === 'league' && data?.league && (
        <div className="mt-4 flex flex-col items-center text-center">
          <div className="no-scrollbar flex max-w-full gap-2 overflow-x-auto px-2 py-1">
            {LEAGUES.map((l, i) => (
              <div key={l} className={`flex h-12 w-11 shrink-0 items-center justify-center ${i === tier ? 'scale-125' : 'opacity-40 grayscale'}`} title={translateGameText(l, locale)}>
                <Icon name="shield" size={40} weight={2} style={{ color: LEAGUE_COLORS[i] }} fill={i <= tier ? LEAGUE_COLORS[i] : 'transparent'} />
              </div>
            ))}
          </div>
          <h2 className="mt-2 text-2xl font-black">{translateGameText(data.title, locale)}</h2>
          <p className="font-bold text-muted">{t("Die Besten steigen auf · noch {time}", {time: countdown})}</p>
        </div>
      )}
      {isLoading && <Spinner />}
      {data && data.entries.length <= 1 && kind === 'league' && (
        <div className="mt-6 flex flex-col items-center text-center">
          <Mascot pose="think" size={110} />
          <p className="max-w-xs font-bold text-muted">{t("Lade Freunde ein, damit ihr euch in der Liga messen könnt!")}</p>
        </div>
      )}
      <div className="mt-4 space-y-1">
        {data?.entries.map((e, i) => {
          const prev = data.entries[i - 1];
          const showPromote = kind === 'league' && i > 0 && prev?.zone === 'promote' && e.zone !== 'promote';
          const showDemote = kind === 'league' && e.zone === 'demote' && prev?.zone !== 'demote';
          return (
            <div key={e.userId}>
              {showPromote && <div className="my-2 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-success"><span className="h-0.5 flex-1 bg-success/40" />{t("▲ Aufstiegszone")}<span className="h-0.5 flex-1 bg-success/40" /></div>}
              {showDemote && <div className="my-2 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-error"><span className="h-0.5 flex-1 bg-error/40" />{t("▼ Abstiegszone")}<span className="h-0.5 flex-1 bg-error/40" /></div>}
              <Row e={e} unit={unit} />
            </div>
          );
        })}
      </div>
    </Page>
  );
}
