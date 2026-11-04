import { usePageT } from '../i18n/pages.ts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { DUEL, MODULE_INFO, type DuelSummary, type ModuleId } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Avatar, Mascot } from '../components/Pet.tsx';
import { Page } from '../components/Shell.tsx';
import { Button, Modal, Pill, SectionTitle, Segmented, Spinner, Toast } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { savedModule, useDuels } from '../lib/queries.ts';
import { moduleColor } from '../lib/theme.ts';

const hoursLeft = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3600_000));

function DuelRow({ d, onDecline }: { d: DuelSummary; onDecline: (id: string) => void }) {
  const t = usePageT();
  const [, navigate] = useLocation();
  const open = d.status === 'open';
  const myTurn = open && !d.me.played;
  const score = d.me.played ? `${d.me.correct ?? 0} : ${d.them.played ? (d.them.correct ?? '?') : '?'}` : null;
  const status =
    d.status === 'declined'
      ? t("abgelehnt")
      : d.status === 'expired'
        ? t("abgelaufen")
        : d.winner === 'me'
          ? t("gewonnen · +{coins} Coins", {coins: DUEL.winCoins})
          : d.winner === 'them'
            ? t("verloren")
            : d.winner === 'draw'
              ? t("unentschieden")
              : myTurn
                ? d.them.played
                  ? t("{name} hat vorgelegt · noch {hours} Std", {name: d.opponent.displayName, hours: hoursLeft(d.expiresAt)})
                  : t("noch {hours} Std", {hours: hoursLeft(d.expiresAt)})
                : t("wartet auf {name}", {name: d.opponent.displayName});
  return (
    <motion.div layout className={`flex items-center gap-3 rounded-3xl border-2 bg-surface p-3 ${myTurn ? 'border-primary' : 'border-line'}`}>
      <Avatar pet={d.opponent.pet} petStage={d.opponent.petStage} frame={d.opponent.frame} size={48} name={d.opponent.displayName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-black">{d.opponent.displayName}</p>
          <span className="text-xs font-black" style={{ color: moduleColor(d.module) }}>
            {MODULE_INFO[d.module].short}
          </span>
        </div>
        <p className={`truncate text-sm font-bold ${d.winner === 'me' ? 'text-success' : d.winner === 'them' ? 'text-error' : 'text-muted'}`}>{status}</p>
      </div>
      {score && <span className="shrink-0 text-lg font-black tabular-nums">{score}</span>}
      {myTurn && (
        <div className="flex shrink-0 flex-col gap-1">
          <Button className="min-h-10! px-3!" onClick={() => navigate(`/duel/${d.id}`)}>
            {t("Spielen")}
          </Button>
          {!d.challengedByMe && !d.them.played && (
            <button className="text-xs font-black text-muted hover:text-error" onClick={() => onDecline(d.id)}>
              {t("Ablehnen")}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

export default function Duels() {
  const t = usePageT();
  const { data, isLoading } = useDuels();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [picking, setPicking] = useState(false);
  const [opponent, setOpponent] = useState<string | null>(null);
  const [mod, setMod] = useState<ModuleId>(savedModule);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  const create = useMutation({
    mutationFn: () => api<DuelSummary>('/api/duels', { method: 'POST', body: { opponent, module: mod } }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['duels'] });
      setPicking(false);
      navigate(`/duel/${d.id}`); // Herausforderer legt direkt vor
    },
    onError: (e) => flash((e as Error).message),
  });
  const decline = useMutation({
    mutationFn: (id: string) => api(`/api/duels/${id}/decline`, { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['duels'] }),
    onError: (e) => flash((e as Error).message),
  });

  const list = data?.duels ?? [];
  const myTurn = list.filter((d) => d.status === 'open' && !d.me.played);
  const waiting = list.filter((d) => d.status === 'open' && d.me.played);
  const finished = list.filter((d) => d.status !== 'open');

  return (
    <Page
      topLeft={
        <Link href="/train" className="flex items-center gap-1 text-xl font-black">
          <Icon name="chevronLeft" />
          {t("Duelle")}
        </Link>
      }
    >
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-[#38bdf8] p-4 text-white shadow-card">
        <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15" />
        <div className="relative flex items-center gap-3">
          <Mascot pose="cheer" size={80} />
          <div className="min-w-0">
            <p className="text-lg font-black leading-tight">{t("Fordere jemanden heraus!")}</p>
            <p className="mt-1 text-sm font-bold text-white/90">
              {t("{questions} gleiche Fragen, {hours} Std Zeit. Mehr Richtige gewinnt, bei Gleichstand die schnellere Zeit.", {questions: DUEL.questions, hours: DUEL.expiresHours})}
            </p>
          </div>
        </div>
        <Button full variant="secondary" className="relative mt-4" onClick={() => setPicking(true)} disabled={!data?.opponents.length}>
          {t("Neues Duell")}
        </Button>
      </div>

      {isLoading && <Spinner />}
      {data && !list.length && <p className="mt-8 text-center font-semibold text-muted">{t("Noch keine Duelle. Fang einfach an!")}</p>}

      {myTurn.length > 0 && (
        <>
          <SectionTitle>
            {t("Du bist dran")} <Pill className="ml-1 bg-error text-white">{myTurn.length}</Pill>
          </SectionTitle>
          <div className="space-y-2">
            {myTurn.map((d) => (
              <DuelRow key={d.id} d={d} onDecline={(id) => decline.mutate(id)} />
            ))}
          </div>
        </>
      )}
      {waiting.length > 0 && (
        <>
          <SectionTitle>{t("Warten auf Gegner")}</SectionTitle>
          <div className="space-y-2">
            {waiting.map((d) => (
              <DuelRow key={d.id} d={d} onDecline={() => {}} />
            ))}
          </div>
        </>
      )}
      {finished.length > 0 && (
        <>
          <SectionTitle>{t("Letzte 14 Tage")}</SectionTitle>
          <div className="space-y-2">
            {finished.map((d) => (
              <DuelRow key={d.id} d={d} onDecline={() => {}} />
            ))}
          </div>
        </>
      )}

      <Modal open={picking} onClose={() => setPicking(false)} title={t("Neues Duell")}>
        <p className="mb-2 text-sm font-black uppercase tracking-wider text-muted">{t("Gegen")}</p>
        <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto p-0.5">
          {data?.opponents.map((o) => (
            <button
              key={o.username}
              onClick={() => setOpponent(o.username)}
              aria-pressed={opponent === o.username}
              className={`flex flex-col items-center gap-1 rounded-2xl border-2 p-2 ${opponent === o.username ? 'border-primary bg-primary-soft' : 'border-line'}`}
            >
              <Avatar pet={o.pet} petStage={o.petStage} frame={o.frame} size={44} name={o.displayName} />
              <span className="w-full truncate text-xs font-black">{o.displayName}</span>
            </button>
          ))}
        </div>
        <p className="mb-2 mt-4 text-sm font-black uppercase tracking-wider text-muted">{t("Modul")}</p>
        <Segmented value={mod} onChange={setMod} options={(['DS', 'EIP', 'ERA'] as const).map((m) => ({ value: m, label: MODULE_INFO[m].short, color: moduleColor(m) }))} />
        <Button full className="mt-5" disabled={!opponent || create.isPending} onClick={() => create.mutate()}>
          {t("Herausfordern & vorlegen")}
        </Button>
      </Modal>
      <Toast message={toast} kind="error" />
    </Page>
  );
}
