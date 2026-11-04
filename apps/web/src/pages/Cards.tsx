import { usePageT } from '../i18n/pages.ts';
import { translateGameText } from '../i18n/catalog.ts';
import { useLocale } from '../i18n/index.tsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { KNOWLEDGE_KIND_LABEL, MODULE_INFO, MODULES, type CardSession, type KnowledgeModuleResponse, type ModuleId } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { MathText } from '../components/MathText.tsx';
import { Mascot } from '../components/Pet.tsx';
import { Page } from '../components/Shell.tsx';
import { Button, Pill, ProgressBar, Segmented, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fx } from '../lib/fx.ts';
import { knowledgeHref } from '../lib/knowledge.ts';
import { savedModule } from '../lib/queries.ts';
import { sfx } from '../lib/sound.ts';
import { moduleColor } from '../lib/theme.ts';

type Card = CardSession['cards'][number];
const BOX_LABEL = ['Neu', 'Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5', 'Gemeistert'];


/** Eine Karte: vorne Begriff, hinten Kurzfassung + Erklärung. Nach dem Umdrehen wischen: rechts = gewusst, links = nochmal. */
function FlashCard({ card, color, flipped, onFlip, onAnswer }: { card: Card; color: string; flipped: boolean; onFlip: () => void; onAnswer: (known: boolean) => void }) {
  const t = usePageT();
  const { locale } = useLocale();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-10, 10]);
  const knownOpacity = useTransform(x, [30, 120], [0, 1]);
  const againOpacity = useTransform(x, [-120, -30], [1, 0]);
  const e = card.entry;
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (!flipped) return;
    if (info.offset.x > 110 || info.velocity.x > 600) onAnswer(true);
    else if (info.offset.x < -110 || info.velocity.x < -600) onAnswer(false);
  };
  return (
    <motion.div
      key={e.id}
      drag={flipped ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={onDragEnd}
      style={{ x, rotate }}
      initial={{ y: 24, opacity: 0, scale: 0.97 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      className="relative touch-pan-y"
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={flipped ? t("Karte") : t("Karte umdrehen")}
        onClick={() => !flipped && onFlip()}
        onKeyDown={(ev) => (ev.key === ' ' || ev.key === 'Enter') && !flipped && onFlip()}
        className={`relative min-h-[22rem] overflow-hidden rounded-3xl border-2 bg-surface p-5 shadow-card ${flipped ? '' : 'cursor-pointer active:scale-[0.99]'} transition-transform`}
        style={{ borderColor: color }}
      >
        <motion.span style={{ opacity: knownOpacity }} className="pointer-events-none absolute right-4 top-4 rotate-6 rounded-xl border-2 border-success px-2 py-0.5 text-sm font-black uppercase text-success">
          {t("Gewusst")}
        </motion.span>
        <motion.span style={{ opacity: againOpacity }} className="pointer-events-none absolute left-4 top-4 -rotate-6 rounded-xl border-2 border-error px-2 py-0.5 text-sm font-black uppercase text-error">
          {t("Nochmal")}
        </motion.span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill className="bg-surface-2 text-muted">{translateGameText(KNOWLEDGE_KIND_LABEL[e.kind], locale)}</Pill>
          <Pill className="bg-surface-2 text-muted">{translateGameText(BOX_LABEL[card.box ?? 0]!, locale)}</Pill>
          <span className="ml-auto truncate text-xs font-black uppercase tracking-wider" style={{ color }}>
            Unit {card.unitNumber}
          </span>
        </div>
        {!flipped ? (
          <div className="flex min-h-[17rem] flex-col items-center justify-center text-center">
            <p className="text-3xl font-black leading-tight"><MathText text={e.term} /></p>
            <p className="mt-4 text-sm font-bold text-muted">{t("Was bedeutet das? Erst überlegen, dann antippen.")}</p>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3">
            <p className="text-xl font-black leading-tight"><MathText text={e.term} /></p>
            <Markdown inline text={e.short} className="mt-2 block font-extrabold" />
            <div className="mt-3 border-t-2 border-line pt-2 text-[0.95rem]">
              <Markdown text={e.explanation} />
            </div>
            {e.example && (
              <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
                <p className="mb-1 text-xs font-black uppercase tracking-wider text-muted">{t("Beispiel")}</p>
                <Markdown text={e.example} />
              </div>
            )}
            <Link href={knowledgeHref(e.term, card.unitId.split('-')[0])} className="mt-3 inline-flex items-center gap-1 text-sm font-extrabold text-primary">
              <Icon name="book" size={16} /> {t("Im Wissen nachschlagen")}
            </Link>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

/** Karteikarten aus der Wissenssammlung (Üben → Wissen → Karteikarten). */
export default function Cards() {
  const t = usePageT();
  const params = new URLSearchParams(useSearch());
  const initialMod = params.get('m')?.toUpperCase();
  const [mod, setMod] = useState<ModuleId>(() => (MODULES.includes(initialMod as ModuleId) ? (initialMod as ModuleId) : savedModule()));
  const [unit, setUnit] = useState<string | null>(() => params.get('unit'));
  const [round, setRound] = useState(0);
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const color = moduleColor(mod);

  const { data: knowledge } = useQuery({ queryKey: ['knowledge', mod], queryFn: () => api<KnowledgeModuleResponse>(`/api/knowledge/${mod}`), staleTime: 5 * 60_000 });
  const { data: session, isLoading, error } = useQuery({
    queryKey: ['cardSession', mod, unit, round],
    queryFn: () => api<CardSession>(`/api/cards/${mod}${unit ? `?unit=${unit}` : ''}`),
    staleTime: Infinity,
    gcTime: 0,
  });

  // Runde: Warteschlange (Nochmal → ans Ende), gewertet wird nur die erste Antwort je Karte
  const [queue, setQueue] = useState<Card[]>([]);
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    setQueue(session?.cards ?? []);
    setAnswered({});
    setFlipped(false);
  }, [session]);

  const total = session?.cards.length ?? 0;
  const firstKnown = Object.values(answered).filter(Boolean).length;
  const done = total > 0 && queue.length === 0;
  const card = queue[0];

  const answer = (known: boolean) => {
    if (!card) return;
    const id = card.entry.id;
    if (!(id in answered)) {
      setAnswered((a) => ({ ...a, [id]: known }));
      void api('/api/cards/review', { method: 'POST', body: { entryId: id, known } }).catch(() => {});
    }
    if (known) sfx.correct(1);
    else sfx.wrong();
    setFlipped(false);
    setQueue((q) => (known ? q.slice(1) : [...q.slice(1), q[0]!]));
  };

  useEffect(() => {
    if (!done) return;
    sfx.complete();
    fx.correct(5);
    void qc.invalidateQueries({ queryKey: ['cards'] });
    void qc.invalidateQueries({ queryKey: ['knowledge', mod] });
  }, [done, qc, mod]);

  const units = useMemo(() => (knowledge?.units ?? []).filter((u) => u.entries.length), [knowledge]);

  return (
    <Page
      topLeft={
        <Link href="/train" className="flex items-center gap-1 text-xl font-black">
          <Icon name="chevronLeft" />
          {t("Karteikarten")}
        </Link>
      }
    >
      <Segmented
        value={mod}
        onChange={(m) => {
          setMod(m);
          setUnit(null);
          try {
            localStorage.setItem('lq.module', m);
          } catch {
            /* egal */
          }
        }}
        options={MODULES.map((m) => ({ value: m, label: m, color: moduleColor(m) }))}
      />
      {units.length > 0 && (
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Unit">
          {[{ unitId: null, label: t("Alle") }, ...units.map((u) => ({ unitId: u.unitId, label: `Unit ${u.unitNumber}` }))].map((o) => (
            <button
              key={o.label}
              role="tab"
              aria-selected={unit === o.unitId}
              onClick={() => setUnit(o.unitId)}
              className={`shrink-0 rounded-xl border-2 px-2.5 py-1 text-xs font-extrabold ${unit === o.unitId ? 'text-white' : 'border-line bg-surface text-muted'}`}
              style={unit === o.unitId ? { background: color, borderColor: color } : undefined}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {isLoading && <Spinner />}
      {error && !session && <p className="mt-6 text-center font-bold text-muted">{(error as Error).message}</p>}

      {session && total === 0 && (
        <div className="flex flex-col items-center py-10 text-center">
          <Mascot pose="happy" size={140} />
          <p className="mt-2 font-black">{t("Alles erledigt!")}</p>
          <p className="max-w-xs text-sm font-semibold text-muted">{t("Heute ist in {scope} keine Karte fällig und es gibt keine neuen mehr.", {scope: unit ? t('dieser Unit') : MODULE_INFO[mod].short})}</p>
          <Button className="mt-4" variant="secondary" onClick={() => navigate(`/wissen?m=${mod}`)}>
            {t("Wissen durchstöbern")}
          </Button>
        </div>
      )}

      {session && total > 0 && !done && card && (
        <>
          <div className="mt-4 flex items-center gap-3">
            <ProgressBar value={(total - queue.length) / total} color={color} height={12} className="flex-1" />
            <span className="shrink-0 text-sm font-black tabular-nums text-muted">
              {total - queue.length}/{total}
            </span>
          </div>
          <div className="mt-4">
            <AnimatePresence mode="wait">
              <FlashCard key={`${card.entry.id}-${queue.length}`} card={card} color={color} flipped={flipped} onFlip={() => (sfx.tap(), setFlipped(true))} onAnswer={answer} />
            </AnimatePresence>
          </div>
          {flipped && <p className="mt-2 text-center text-xs font-bold text-muted">{t("Tipp: nach rechts wischen = gewusst, nach links = nochmal")}</p>}
          {/* eigene Leiste direkt über der Navigation: deckt den Kartentext ab statt darüber zu schweben */}
          <div className="sticky bottom-[calc(4rem+2px+env(safe-area-inset-bottom))] z-20 -mx-4 mt-3 grid grid-cols-2 gap-3 border-t-2 border-line bg-bg/95 px-4 pb-3 pt-3 backdrop-blur-md">
            {flipped ? (
              <>
                <Button variant="danger-outline" onClick={() => answer(false)}>
                  <Icon name="refresh" size={18} /> {t("Nochmal")}
                </Button>
                <Button variant="success" onClick={() => answer(true)}>
                  <Icon name="check" size={18} /> {t("Gewusst")}
                </Button>
              </>
            ) : (
              <Button full className="col-span-2" onClick={() => (sfx.tap(), setFlipped(true))}>
                {t("Umdrehen")}
              </Button>
            )}
          </div>
        </>
      )}

      {done && (
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center py-8 text-center">
          <Mascot pose="cheer" size={150} />
          <p className="mt-2 text-2xl font-black">{t("Runde geschafft!")}</p>
          <p className="mt-1 font-bold text-muted">
            {t("{known} von {total} auf Anhieb gewusst", {known: firstKnown, total})}
          </p>
          <p className="mt-1 max-w-xs text-sm font-semibold text-muted">{t("Gewusste Karten kommen in wachsenden Abständen wieder, der Rest schon morgen.")}</p>
          <div className="mt-5 flex w-full max-w-xs flex-col gap-2">
            {session && session.dueLeft > 0 && (
              <Button full onClick={() => setRound((r) => r + 1)}>
                {t("Weiter ({count} fällig)", {count: session.dueLeft})}
              </Button>
            )}
            <Button full variant={session && session.dueLeft > 0 ? 'secondary' : 'primary'} onClick={() => setRound((r) => r + 1)}>
              {t("Neue Runde")}
            </Button>
            <Button full variant="secondary" onClick={() => navigate('/train')}>
              {t("Zurück zu Üben")}
            </Button>
          </div>
        </motion.div>
      )}
    </Page>
  );
}
