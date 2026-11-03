import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MODULE_INFO, STUDY, type StudyResponse } from '@lernquest/shared';
import { api, assetUrl } from '../lib/api.ts';
import { fx } from '../lib/fx.ts';
import { sfx } from '../lib/sound.ts';
import { moduleColor } from '../lib/theme.ts';
import { Button, Card, ProgressBar, SectionTitle, Toast } from './ui.tsx';

/** Reihenfolge wie im Stundenplan */
const ORDER = ['EIP', 'ERA', 'DS'] as const;

const hours = (blocks: number) => ((blocks * STUDY.blockMinutes) / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const dm = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });

/** Profil: Lernblöcke (90 min Eigenstudium) je Fach eintragen, Wochenziel, Belohnung am Wochenende */
export function StudyBlocks() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['study'], queryFn: () => api<StudyResponse>('/api/study'), staleTime: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsgRaw] = useState<string | null>(null);
  const setMsg = (m: string) => {
    setMsgRaw(m);
    setTimeout(() => setMsgRaw(null), 3000);
  };
  if (!data) return null;

  const run = async (key: string, url: string) => {
    if (busy) return;
    setBusy(key);
    try {
      const r = await api<StudyResponse & { coins?: number }>(url, { method: 'POST' });
      qc.setQueryData(['study'], r);
      return r;
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const add = async (module: string, goal: number, before: number) => {
    const r = await run(`add-${module}`, `/api/study/${module.toLowerCase()}/add`);
    if (!r) return;
    if (before + 1 === goal) {
      fx.coins();
      sfx.achievement();
      setMsg(`${MODULE_INFO[module as keyof typeof MODULE_INFO].short}: Wochenziel geschafft! 🎉`);
    } else if (before + 1 > goal) {
      setMsg('Ziel ist schon erreicht – denk auch an Pausen 😌');
    } else sfx.correct();
  };

  const claim = async (week: string, el: HTMLElement) => {
    const r = await run(`claim-${week}`, `/api/study/claim/${week}`);
    if (!r?.coins) return;
    fx.coins(el);
    sfx.claim();
    setMsg(`+${r.coins} Coins für deine Lernwoche!`);
    void qc.invalidateQueries({ queryKey: ['me'] });
  };

  const r = data.reward;
  return (
    <>
      <SectionTitle action={<span className="text-sm font-black text-muted">bis So {dm(data.weekEnd)}</span>}>Lernblöcke</SectionTitle>

      {data.pending.map((w) => (
        <Card key={w.week} className="mb-3 border-gold/70! bg-[color-mix(in_oklab,var(--c-gold)_12%,var(--c-surface))]">
          <div className="flex items-center gap-3">
            <img src={assetUrl('item-coin')} alt="" className="h-10 w-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-black leading-tight">Woche {dm(w.week)}–{dm(new Date(Date.parse(`${w.week}T12:00:00Z`) + 6 * 864e5).toISOString().slice(0, 10))} geschafft</p>
              <p className="text-sm font-semibold text-muted">
                {Object.values(w.blocks).reduce((a, b) => a + b, 0)} Blöcke · {w.reward.goalsReached}/3 Ziele
              </p>
            </div>
            <Button onClick={(e) => claim(w.week, e.currentTarget)} disabled={!!busy} className="shrink-0 px-4!">
              +{w.reward.total}
            </Button>
          </div>
        </Card>
      ))}

      <Card className="space-y-4">
        {ORDER.map((id) => data.modules.find((x) => x.module === id)!).map((m) => {
          const done = m.blocks >= m.goalBlocks;
          const color = moduleColor(m.module);
          return (
            <div key={m.module}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="font-black" title={MODULE_INFO[m.module].name}>
                  {MODULE_INFO[m.module].short} {done && <span aria-label="Ziel erreicht">✅</span>}
                </span>
                <span className="text-sm font-black tabular-nums text-muted">
                  {m.blocks}/{m.goalBlocks} Blöcke · {hours(m.blocks)}/{hours(m.goalBlocks)} h
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <ProgressBar value={Math.min(1, m.blocks / m.goalBlocks)} color={color} height={14} />
                </div>
                {m.blocks > 0 && (
                  <button
                    onClick={() => run(`undo-${m.module}`, `/api/study/${m.module.toLowerCase()}/undo`)}
                    disabled={!!busy}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-line text-muted active:scale-95"
                    aria-label={`Letzten ${MODULE_INFO[m.module].name}-Block zurücknehmen`}
                  >
                    <span className="text-xl font-black leading-none">−</span>
                  </button>
                )}
                <button
                  onClick={() => add(m.module, m.goalBlocks, m.blocks)}
                  disabled={!!busy || m.today >= STUDY.maxPerModuleDay}
                  className="btn3d h-10 shrink-0 rounded-xl px-3 text-sm font-black text-white disabled:opacity-50"
                  style={{ background: color, boxShadow: `0 4px 0 color-mix(in oklab, ${color} 70%, black)` }}
                  aria-label={`${MODULE_INFO[m.module].name}: 90 Minuten eintragen`}
                >
                  +90 min
                </button>
              </div>
              {m.today >= STUDY.maxPerModuleDay && <p className="mt-1 text-xs font-bold text-muted">Für heute genug {MODULE_INFO[m.module].short} – morgen geht es weiter.</p>}
            </div>
          );
        })}

        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <div className="flex items-center justify-between font-black">
            <span>Belohnung am Montag</span>
            <span className="flex items-center gap-1">
              <img src={assetUrl('item-coin')} alt="" className="h-5 w-5" />
              {r.total}
            </span>
          </div>
          <p className="mt-1 font-semibold text-muted">
            {STUDY.coinsPerBlock} pro Block bis zum Ziel · +{STUDY.goalBonus} je erreichtem Ziel · +{STUDY.allGoalsBonus} wenn alle drei klappen. Darüber
            gibt es nur noch {STUDY.coinsPerExtraBlock} pro Block (max. {STUDY.extraMax} je Fach), denn Pausen gehören dazu.
          </p>
        </div>
      </Card>
      <Toast message={msg} />
    </>
  );
}
