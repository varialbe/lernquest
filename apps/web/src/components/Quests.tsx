import { useLocale } from '../i18n/index.tsx';
import { translateGameText } from '../i18n/catalog.ts';
import { useCommonT } from '../i18n/common.ts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import type { QuestsResponse } from '@lernquest/shared';
import { api, assetUrl } from '../lib/api.ts';
import { useQuests } from '../lib/queries.ts';
import { fx } from '../lib/fx.ts';
import { sfx } from '../lib/sound.ts';
import { ProgressBar } from './ui.tsx';

/** Drei Tagesaufgaben mit Coin-Belohnung zum Einlösen. */
export function QuestsCard() {
  const { locale } = useLocale();
  const ct = useCommonT();
  const { data } = useQuests();
  const qc = useQueryClient();
  const claim = useMutation({
    mutationFn: (v: { id: string; at: DOMRect }) => api<QuestsResponse>(`/api/quests/${v.id}/claim`, { method: 'POST', body: {} }),
    onSuccess: (q, v) => {
      sfx.claim();
      fx.coins(v.at);
      qc.setQueryData(['quests'], q);
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  if (!data) return null;
  const left = data.quests.filter((q) => !q.claimed).length;
  return (
    <section className="mt-3 rounded-3xl border-2 border-line bg-surface p-4 shadow-card" aria-label={ct("Tagesaufgaben")}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-black">{ct("Tagesaufgaben")}</h2>
        <span className="text-xs font-black uppercase tracking-wider text-muted">{left ? ct("{p0} offen", { p0: left }) : ct("alle erledigt ✓")}</span>
      </div>
      <ul className="space-y-2.5">
        {data.quests.map((q) => (
          <li key={q.id} className={`flex items-center gap-3 ${q.claimed ? 'opacity-55' : ''}`}>
            <img src={assetUrl(q.icon)} alt="" className="h-9 w-9 shrink-0 object-contain" />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-extrabold ${q.claimed ? 'line-through' : ''}`}>{translateGameText(q.title, locale)}</p>
              <div className="mt-1 flex items-center gap-2">
                <ProgressBar value={q.progress / q.target} height={8} color={q.done ? 'var(--c-gold)' : 'var(--c-success)'} />
                <span className="shrink-0 text-xs font-black tabular-nums text-muted">
                  {q.progress}/{q.target}
                </span>
              </div>
            </div>
            <AnimatePresence mode="wait">
              {q.done && !q.claimed ? (
                <motion.button
                  key="claim"
                  initial={{ scale: 0.6 }}
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ repeat: Infinity, duration: 1.6 }}
                  onClick={(e) => claim.mutate({ id: q.id, at: e.currentTarget.getBoundingClientRect() })}
                  disabled={claim.isPending}
                  className="flex shrink-0 items-center gap-1 rounded-xl bg-gold px-2.5 py-1.5 text-sm font-black text-[#4a3300] shadow-[0_3px_0_var(--c-gold-dark)]"
                >
                  <img src={assetUrl('item-coin')} alt="" className="h-4 w-4" />+{q.coins}
                </motion.button>
              ) : (
                <span key="reward" className="flex shrink-0 items-center gap-1 text-sm font-black text-gold-dark">
                  <img src={assetUrl('item-coin')} alt="" className="h-4 w-4" />
                  {q.claimed ? '✓' : q.coins}
                </span>
              )}
            </AnimatePresence>
          </li>
        ))}
      </ul>
    </section>
  );
}
