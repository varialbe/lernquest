import { usePageT } from '../i18n/pages.ts';
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { DUEL, EXAM, MODULE_INFO, WEAK, type ConceptMastery, type ModuleId } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Page } from '../components/Shell.tsx';
import { Button, Card, Pill, ProgressBar, Segmented } from '../components/ui.tsx';
import { assetUrl } from '../lib/api.ts';
import { savedModule, useCardsOverview, useDuels, useMastery, useMe } from '../lib/queries.ts';
import { MathText } from '../components/MathText.tsx';
import { moduleColor } from '../lib/theme.ts';
import { knowledgeHref } from '../lib/knowledge.ts';

export const LEVEL_COLOR: Record<ConceptMastery['level'], string> = {
  weak: 'var(--c-error)',
  ok: 'var(--c-gold)',
  strong: 'var(--c-success)',
  new: 'var(--c-muted)',
};

export function ConceptBar({ c }: { c: ConceptMastery }) {
  const t = usePageT();
  return (
    <Link href={knowledgeHref(c.concept, c.unitId.split('-')[0])} className="block active:opacity-70" aria-label={t("{concept} in der Wissenssammlung nachschlagen", {concept: c.concept})}>
      <div className="flex items-baseline justify-between gap-2">
        <MathText text={c.concept} className="min-w-0 truncate font-extrabold" />
        <span className="shrink-0 text-sm font-black tabular-nums" style={{ color: LEVEL_COLOR[c.level] }}>
          {c.level === 'new' ? t("neu") : `${Math.round(c.score * 100)} %`}
        </span>
      </div>
      <ProgressBar value={c.level === 'new' ? 0.04 : Math.max(0.04, c.score)} height={10} color={LEVEL_COLOR[c.level]} className="mt-1" />
      <p className="mt-0.5 truncate text-xs font-bold text-muted">
        Unit {c.unitNumber} · <MathText text={c.unitTitle} /> · {t("{correct}/{answered} richtig", {correct: c.correct, answered: c.answered})}
      </p>
    </Link>
  );
}

function Section({ icon, title, sub, children, delay, accent }: { icon: string; title: string; sub: string; children: ReactNode; delay: number; accent: string }) {
  return (
    <motion.div initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay }}>
      <Card className="mt-3">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl" style={{ background: `color-mix(in oklab, ${accent} 18%, var(--c-surface))` }}>
            <img src={assetUrl(icon)} alt="" className="h-10 w-10 object-contain" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-black leading-tight">{title}</h2>
            <p className="text-sm font-semibold text-muted">{sub}</p>
          </div>
        </div>
        <div className="mt-3">{children}</div>
      </Card>
    </motion.div>
  );
}

/** Üben-Hub: Wiederholen (Leitner), Schwächen, Klausur-Check, Duelle. */
export default function Train() {
  const t = usePageT();
  const { data: me } = useMe();
  const { data: mastery } = useMastery();
  const { data: duels } = useDuels();
  const { data: cardsOverview } = useCardsOverview();
  const [mod, setMod] = useState<ModuleId>(savedModule);
  const [, navigate] = useLocation();
  const due = me?.stats.dueReviews ?? 0;
  const concepts = mastery?.modules.find((m) => m.id === mod)?.concepts ?? [];
  const weakest = concepts.filter((c) => c.level !== 'new').slice(0, 3);
  const myTurn = duels?.duels.filter((d) => d.status === 'open' && !d.me.played).length ?? 0;
  const color = moduleColor(mod);
  const cards = cardsOverview?.modules.find((m) => m.id === mod);

  return (
    <Page topLeft={<h1 className="text-xl font-black">{t("Üben")}</h1>}>
      <Segmented
        value={mod}
        onChange={(m) => {
          setMod(m);
          localStorage.setItem('lq.module', m);
        }}
        options={(['DS', 'EIP', 'ERA'] as const).map((m) => ({ value: m, label: m, color: moduleColor(m) }))}
      />

      <Section icon="badge-practice" title={t("Wiederholen")} sub={due ? t("{count} Fragen sind heute fällig", {count: due}) : t("Alles wiederholt – stark!")} delay={0} accent="var(--c-error)">
        <Button full variant={due ? 'primary' : 'secondary'} disabled={!due} onClick={() => navigate('/practice')}>
          {due ? t("Wiederholung starten") : t("Nichts fällig")}
        </Button>
      </Section>

      <Section
        icon="mascot-book"
        title={t("Wissen & Karteikarten")}
        sub={
          !cards?.total
            ? t("Alle Begriffe der Vorlesungen – entsteht gerade")
            : cards.due
              ? t("{due} Karten fällig · {mastered} von {total} gemeistert", {due: cards.due, mastered: cards.mastered, total: cards.total})
              : t("{count} Begriffe zum Abfragen, Nachschlagen und von Grund auf Erklären", {count: cards.total})
        }
        delay={0.03}
        accent="var(--c-primary)"
      >
        <div className="flex flex-col gap-2">
          <Button full variant={cards?.due ? 'primary' : 'secondary'} disabled={!cards?.total} onClick={() => navigate(`/karten?m=${mod}`)}>
            <Icon name="copy" size={20} />
            {t("Karteikarten")}
            {!!cards?.due && <Pill className="bg-white/25 text-white">{cards.due}</Pill>}
          </Button>
          <Button full variant="ghost" onClick={() => navigate(`/wissen?m=${mod}`)}>
            <Icon name="book" size={20} />
            {t("Nachschlagen")}
          </Button>
        </div>
      </Section>

      <Section icon="item-xp" title={t("Schwächen")} sub={t("Deine wackeligsten Konzepte gezielt üben")} delay={0.05} accent={color}>
        {weakest.length ? (
          <div className="space-y-3">
            {weakest.map((c) => (
              <ConceptBar key={c.concept} c={c} />
            ))}
          </div>
        ) : (
          <p className="text-sm font-semibold text-muted">{t("Spiel ein paar Level in {module} – dann siehst du hier, wo es hakt.", {module: MODULE_INFO[mod].short})}</p>
        )}
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" disabled={!weakest.length} onClick={() => navigate(`/weak/${mod}`)}>
            {t("{count} Fragen üben", {count: WEAK.questions})}
          </Button>
          <Link href="/mastery" className="btn3d bg-surface text-primary border-2 border-line shadow-[0_4px_0_var(--c-border)]">
            {t("Alle")}
          </Link>
        </div>
      </Section>

      <Section icon="badge-boss" title={t("Klausur-Check")} sub={t("{questions} Fragen aus allen Units · {minutes} Min · Note am Ende", {questions: EXAM.questions, minutes: Math.round((EXAM.questions * EXAM.secondsPerQuestion) / 60)})} delay={0.1} accent="var(--c-gold)">
        <p className="mb-3 text-sm font-semibold text-muted">{t("Kein Feedback zwischendurch – wie in der echten Klausur. Danach siehst du jede falsche Frage mit Lösung.")}</p>
        <Button full variant="gold" onClick={() => navigate(`/exam/${mod}`)}>
          {t("{module}-Klausur starten", {module: MODULE_INFO[mod].short})}
        </Button>
      </Section>

      <Section icon="badge-collector" title={t("Duelle")} sub={t("{questions} gleiche Fragen, wer mehr richtig hat, gewinnt {coins} Coins", {questions: DUEL.questions, coins: DUEL.winCoins})} delay={0.15} accent="var(--c-primary)">
        <Button full variant="secondary" onClick={() => navigate('/duels')}>
          <Icon name="trophy" size={20} />
          {t("Zu den Duellen")}
          {myTurn > 0 && <Pill className="bg-error text-white">{t("{count} warten", {count: myTurn})}</Pill>}
        </Button>
      </Section>
    </Page>
  );
}
