import { usePageT } from '../i18n/pages.ts';
import { useLocale } from '../i18n/index.tsx';
import confetti from 'canvas-confetti';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { EXAM, type Question, type RunResult } from '@lernquest/shared';
import { fmtNum } from '../components/Estimate.tsx';
import { Icon } from '../components/icons.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { QuestionContext } from '../components/QuestionContext.tsx';
import { Mascot } from '../components/Pet.tsx';
import { Button } from '../components/ui.tsx';
import { assetUrl } from '../lib/api.ts';
import { sfx } from '../lib/sound.ts';

const gradeColor = (g: number) => (g <= 1.7 ? 'var(--c-success)' : g <= 2.7 ? 'var(--c-primary)' : g <= 4 ? 'var(--c-gold-dark)' : 'var(--c-error)');

/** Antworttext einer Auswahl (Optionen bzw. Schätzwert) */
function answerText(q: Question, ids: string[]) {
  if (q.type === 'estimate') return ids[0] !== undefined ? `${fmtNum(Number(ids[0]))} ${q.slider?.unit ?? ''}` : '–';
  const t = q.options.filter((o) => ids.includes(o.id)).map((o) => o.text);
  return t.length ? t.join(' · ') : '–';
}

function ReviewItem({ q, selected }: { q: Question; selected: string[] }) {
  const t = usePageT();
  const [open, setOpen] = useState(false);
  const right = q.type === 'estimate' && q.slider ? [String(q.slider.answer)] : q.correct;
  return (
    <li className="rounded-2xl border-2 border-line bg-surface p-3 text-left">
      <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-error text-white">
          <Icon name="x" size={14} weight={3.4} />
        </span>
        <Markdown text={q.prompt} className="min-w-0 flex-1 text-sm font-extrabold" />
        <Icon name="chevronRight" size={18} className={`mt-0.5 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 pl-8 text-sm">
          {q.context && <QuestionContext context={q.context} />}
          <p className="font-bold text-error">
            {t("Deine Antwort:")} <Markdown text={selected.length ? answerText(q, selected) : t("keine (Zeit abgelaufen)")} className="inline [&_p]:inline" />
          </p>
          <p className="font-bold text-success-dark dark:text-success">
            {t("Richtig:")} <Markdown text={answerText(q, right)} className="inline [&_p]:inline" />
          </p>
          <Markdown text={q.explanation} className="font-semibold text-muted" />
        </div>
      )}
    </li>
  );
}

export function ExamResult({ result: r, questions, onDone }: { result: RunResult; questions: Question[]; onDone: (to?: string) => void }) {
  const t = usePageT();
  const { locale } = useLocale();
  const passed = r.accuracy >= EXAM.passAt;
  const grade = r.grade ?? 5;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const wrong = r.review.filter((x) => !x.correct);
  useEffect(() => {
    sfx.complete();
    if (grade <= 2) void confetti({ particleCount: 90, spread: 80, origin: { y: 0.4 }, disableForReducedMotion: true });
  }, [grade]);

  return (
    <div className="safe-top min-h-dvh bg-[radial-gradient(110%_55%_at_50%_0%,var(--c-primary-soft),transparent_70%)]">
      <main className="mx-auto w-full max-w-md px-5 pb-40 pt-8 text-center">
        <Mascot pose={passed ? 'cheer' : 'think'} size={120} className="mx-auto" />
        <p className="mt-2 text-sm font-black uppercase tracking-wider text-muted">{t("Klausur-Check")}</p>
        <motion.p initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="text-7xl font-black tabular-nums" style={{ color: gradeColor(grade) }}>
          {grade.toLocaleString(locale === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        </motion.p>
        <p className="text-lg font-black">{passed ? t("Bestanden") : t("Noch nicht bestanden")}</p>
        <p className="font-bold text-muted">
          {t("{correct} von {total} richtig · {accuracy} %", {correct: r.correctFirstTry, total: r.total, accuracy: Math.round(r.accuracy * 100)})}
        </p>

        <div className="mt-5 flex justify-center gap-3">
          {[
            ['item-xp', `+${r.xp} XP`, 'var(--c-primary)'],
            ['item-coin', `+${r.coins}`, 'var(--c-gold-dark)'],
          ].map(([icon, label, color]) => (
            <span key={icon} className="flex items-center gap-1.5 rounded-2xl border-2 border-line bg-surface px-3 py-2 font-black" style={{ color }}>
              <img src={assetUrl(icon!)} alt="" className="h-6 w-6" />
              {label}
            </span>
          ))}
        </div>
        {!r.rewarded && <p className="mt-3 text-sm font-bold text-muted">{t("Heute gab es schon {count} gewertete Klausur-Checks – dieser zählt ohne XP und Coins.", {count: EXAM.rewardedPerDay})}</p>}

        {wrong.length > 0 ? (
          <>
            <h2 className="mt-8 text-left text-lg font-black">{t("Daran solltest du arbeiten ({count})", {count: wrong.length})}</h2>
            <p className="mb-3 text-left text-sm font-semibold text-muted">{t("Tippe eine Frage an für Lösung und Erklärung. Alle sind jetzt in deiner Wiederholung.")}</p>
            <ul className="space-y-2">{wrong.map((x) => (byId.has(x.questionId) ? <ReviewItem key={x.questionId} q={byId.get(x.questionId)!} selected={x.selected} /> : null))}</ul>
          </>
        ) : (
          <p className="mt-8 rounded-2xl bg-success-soft px-4 py-3 font-black text-success-dark dark:text-success">{t("Alles richtig – du bist bereit! 🎓")}</p>
        )}
      </main>
      <div className="safe-bottom fixed inset-x-0 bottom-0 border-t-2 border-line bg-bg">
        <div className="mx-auto flex max-w-md flex-col gap-2 px-5 py-4">
          {wrong.length > 0 && (
            <Button full onClick={() => onDone('/practice')}>
              {t("Fehler jetzt wiederholen")}
            </Button>
          )}
          <Button full variant={wrong.length ? 'ghost' : 'primary'} onClick={() => onDone()}>
            {t("Fertig")}
          </Button>
        </div>
      </div>
    </div>
  );
}
