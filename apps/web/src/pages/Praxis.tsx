import { usePageT } from '../i18n/pages.ts';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { MODULE_INFO, type DiscoverResponse, type ModuleId } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Mascot } from '../components/Pet.tsx';
import { Page } from '../components/Shell.tsx';
import { Pill, Segmented, Spinner } from '../components/ui.tsx';
import { api, assetUrl } from '../lib/api.ts';
import { MathText } from '../components/MathText.tsx';
import { moduleColor } from '../lib/theme.ts';

/** Praxis-Bereich: Transfer in die echte Welt + Schätzfragen – je Unit ein Bonus-Level. */
export default function Praxis() {
  const t = usePageT();
  const { data, isLoading } = useQuery({ queryKey: ['discover'], queryFn: () => api<DiscoverResponse>('/api/discover'), staleTime: 30_000 });
  const [mod, setMod] = useState<ModuleId>(() => (localStorage.getItem('lq.module') as ModuleId) || 'DS');
  const [, navigate] = useLocation();
  const module = data?.modules.find((m) => m.id === mod);
  const color = moduleColor(mod);

  return (
    <Page topLeft={<h1 className="text-xl font-black">{t("Praxis")}</h1>}>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#ffb347] via-[#ff8a5c] to-[#f25f9c] p-4 text-white shadow-card">
        <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15" />
        <div className="relative flex items-center gap-3">
          <Mascot pose="think" size={84} />
          <div>
            <p className="text-lg font-black leading-tight">{t("Wo steckt das im echten Leben?")}</p>
            <p className="mt-1 text-sm font-bold text-white/90">{t("Alltagsfälle, Aha-Momente und Schätzfragen mit Regler – je Unit ein Bonus-Level.")}</p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Segmented
          value={mod}
          onChange={(m) => {
            setMod(m);
            localStorage.setItem('lq.module', m);
          }}
          options={(['DS', 'EIP', 'ERA'] as const).map((m) => ({ value: m, label: m, color: moduleColor(m) }))}
        />
      </div>

      {isLoading && <Spinner />}
      {module && module.items.length === 0 && (
        <div className="flex flex-col items-center py-10 text-center">
          <Mascot pose="sleep" size={140} />
          <p className="mt-2 font-black">{t("Noch keine Praxis-Level")}</p>
          <p className="max-w-xs text-sm font-semibold text-muted">{t("Sie entstehen automatisch zu jeder neuen Unit.")}</p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {module?.items.map((it, i) => {
          const locked = it.status === 'locked';
          const done = it.status === 'done' || it.status === 'gold';
          return (
            <motion.button
              key={it.id}
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => !locked && navigate(`/level/${it.id}`)}
              aria-disabled={locked}
              className={`flex w-full items-center gap-3 rounded-3xl border-2 bg-surface p-3 text-left transition-transform ${locked ? 'cursor-not-allowed border-line opacity-70' : 'border-line shadow-[0_4px_0_var(--c-border)] active:translate-y-1 active:shadow-none'}`}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl" style={{ background: locked ? 'var(--c-locked)' : `color-mix(in oklab, ${color} 18%, var(--c-surface))` }}>
                {locked ? <Icon name="lock" size={28} className="text-muted" /> : <img src={assetUrl(done ? 'badge-perfect' : 'item-chest')} alt="" className="h-12 w-12 object-contain" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider" style={{ color: locked ? 'var(--c-muted)' : color }}>
                    Unit {it.unitNumber}
                  </span>
                  {it.isNew && <Pill className="bg-gold/20 text-gold-dark">{t("Neu")}</Pill>}
                </div>
                <p className="truncate font-black"><MathText text={it.unitTitle} /></p>
                <p className="truncate text-sm font-semibold text-muted">{locked ? t("Erst „Grundlagen“ abschließen") : t("{title} · {count} Fragen", {title: it.title, count: it.questionCount})}</p>
              </div>
              {done ? (
                <div className="flex shrink-0 gap-0.5" aria-label={t("{stars} von 3 Sternen", {stars: it.stars})}>
                  {[1, 2, 3].map((s) => (
                    <Icon key={s} name="star" size={16} weight={1.5} className={s <= it.stars ? 'text-gold' : 'text-locked-dark'} fill="currentColor" />
                  ))}
                </div>
              ) : (
                !locked && <Icon name="chevronRight" className="shrink-0 text-muted" />
              )}
            </motion.button>
          );
        })}
      </div>
    </Page>
  );
}
