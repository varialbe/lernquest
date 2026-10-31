import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { checkAnswer, headingAnchor, PETS, type LevelResponse, type Question, type RewardResponse } from '@lernquest/shared';
import { EstimateInput, fmtNum } from '../components/Estimate.tsx';
import { Icon } from '../components/icons.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Mascot } from '../components/Pet.tsx';
import { Button, Modal, ProgressBar, Spinner } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { queueSubmission } from '../lib/offline.ts';
import { useConfig } from '../lib/queries.ts';
import { isMuted, setMuted, sfx } from '../lib/sound.ts';
import { Reward } from './Reward.tsx';

const TYPE_LABEL: Record<Question['type'], string> = {
  single: 'Wähle die richtige Antwort',
  multi: 'Wähle alle richtigen Antworten',
  truefalse: 'Wahr oder falsch?',
  cloze: 'Fülle die Lücke',
  code_output: 'Was gibt dieser Code aus?',
  calc: 'Rechne nach',
  diagram: 'Schau dir das Diagramm an',
  estimate: 'Schätze!',
};
const PRAISE = ['Super!', 'Richtig!', 'Stark!', 'Genau so!', 'Klasse!', 'Volltreffer!'];

type Phase = 'answering' | 'correct' | 'wrong';

function SourceLink({ q }: { q: Question }) {
  const { data: cfg } = useConfig();
  const file = q.source.file.split('/').pop()!.replace(/\.md$/, '');
  const short = file.replace(/^(Diskrete Strukturen|Einführung in die Rechnerarchitektur|EIP)\s*/i, '') || file;
  const href = cfg ? `${cfg.sourceLinkBase}/${q.source.file.split('/').map(encodeURIComponent).join('/')}${q.source.heading ? `#${headingAnchor(q.source.heading)}` : ''}` : undefined;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 truncate rounded-xl bg-black/5 px-2.5 py-1 text-xs font-extrabold hover:underline dark:bg-white/10">
      <Icon name="link" size={14} />
      <span className="truncate">
        {short}
        {q.source.heading ? ` › ${q.source.heading}` : ''}
      </span>
    </a>
  );
}

function ReportDialog({ q, open, onClose }: { q: Question; open: boolean; onClose: (sent: boolean) => void }) {
  const [reason, setReason] = useState<'wrong_answer' | 'unclear' | 'typo' | 'other'>('wrong_answer');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api('/api/reports', { method: 'POST', body: { questionId: q.id, reason, comment: comment || undefined } });
      onClose(true);
    } catch {
      onClose(false);
    } finally {
      setBusy(false);
    }
  };
  const reasons = [
    ['wrong_answer', 'Die markierte Antwort ist falsch'],
    ['unclear', 'Die Frage ist unklar'],
    ['typo', 'Tipp- oder Formelfehler'],
    ['other', 'Etwas anderes'],
  ] as const;
  return (
    <Modal open={open} onClose={() => onClose(false)} title="Frage melden">
      <div className="space-y-2">
        {reasons.map(([v, label]) => (
          <label key={v} className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 font-bold ${reason === v ? 'border-primary bg-primary-soft' : 'border-line'}`}>
            <input type="radio" name="reason" className="accent-[var(--c-primary)]" checked={reason === v} onChange={() => setReason(v)} />
            {label}
          </label>
        ))}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          placeholder="Optional: Was genau stimmt nicht?"
          className="mt-1 h-24 w-full resize-none rounded-2xl border-2 border-line bg-surface-2 p-3 font-semibold outline-none focus:border-primary"
        />
      </div>
      <Button full className="mt-4" onClick={send} disabled={busy}>
        Melden
      </Button>
    </Modal>
  );
}

function OptionCard({ q, opt, index, selected, phase, onToggle }: { q: Question; opt: Question['options'][number]; index: number; selected: boolean; phase: Phase; onToggle: () => void }) {
  const isRight = q.correct.includes(opt.id);
  const reveal = phase !== 'answering';
  let cls = 'border-line bg-surface shadow-[0_4px_0_var(--c-border)]';
  if (selected && !reveal) cls = 'border-primary bg-primary-soft shadow-[0_4px_0_var(--c-primary)]';
  if (reveal && isRight) cls = 'border-success bg-success-soft shadow-[0_4px_0_var(--c-success)]';
  if (reveal && selected && !isRight) cls = 'border-error bg-error-soft shadow-[0_4px_0_var(--c-error)]';
  const multi = q.type === 'multi';
  return (
    <motion.button
      layout
      onClick={onToggle}
      disabled={reveal}
      whileTap={reveal ? undefined : { scale: 0.98 }}
      className={`flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-3 text-left transition-colors ${cls} ${reveal && !isRight && !selected ? 'opacity-60' : ''}`}
      aria-pressed={selected}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center border-2 text-sm font-black ${multi ? 'rounded-lg' : 'rounded-xl'} ${selected ? 'border-primary bg-primary text-white' : 'border-line text-muted'}`}
      >
        {multi && selected ? <Icon name="check" size={18} weight={3.4} /> : index + 1}
      </span>
      <Markdown text={opt.text} className="min-w-0 flex-1 font-bold" />
    </motion.button>
  );
}

function TrueFalse({ q, selected, phase, onPick }: { q: Question; selected: string[]; phase: Phase; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {q.options.map((o) => {
        const sel = selected.includes(o.id);
        const reveal = phase !== 'answering';
        const right = q.correct.includes(o.id);
        let cls = 'border-line bg-surface shadow-[0_5px_0_var(--c-border)]';
        if (sel && !reveal) cls = 'border-primary bg-primary-soft shadow-[0_5px_0_var(--c-primary)]';
        if (reveal && right) cls = 'border-success bg-success-soft shadow-[0_5px_0_var(--c-success)]';
        if (reveal && sel && !right) cls = 'border-error bg-error-soft shadow-[0_5px_0_var(--c-error)]';
        return (
          <motion.button key={o.id} whileTap={reveal ? undefined : { scale: 0.97 }} disabled={reveal} onClick={() => onPick(o.id)} aria-pressed={sel} className={`flex h-32 flex-col items-center justify-center gap-2 rounded-3xl border-2 ${cls}`}>
            <span className={`flex h-12 w-12 items-center justify-center rounded-full ${o.id === 'true' ? 'bg-success text-white' : 'bg-error text-white'}`}>
              <Icon name={o.id === 'true' ? 'check' : 'x'} size={28} weight={3.4} />
            </span>
            <span className="text-lg font-black">{o.text}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

export function Quiz({ levelId, practice }: { levelId?: string; practice?: boolean }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: practice ? ['practice-set'] : ['level', levelId],
    queryFn: async () => (practice ? { level: null, questions: (await api<{ questions: Question[] }>('/api/practice')).questions } : api<LevelResponse>(`/api/levels/${levelId}`)),
    staleTime: Infinity,
    gcTime: 0,
  });
  const questions = data?.questions ?? [];

  const [queue, setQueue] = useState<number[]>([]);
  const [firstTry, setFirstTry] = useState<Record<string, string[]>>({});
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('answering');
  const [combo, setCombo] = useState(0);
  const [praise, setPraise] = useState(PRAISE[0]!);
  const [shake, setShake] = useState(0);
  const [quit, setQuit] = useState(false);
  const [report, setReport] = useState(false);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<RewardResponse | 'offline' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [started] = useState(Date.now());

  useEffect(() => {
    if (questions.length && !queue.length && !solved.size) setQueue(questions.map((_, i) => i));
  }, [questions]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = queue.length ? questions[queue[0]!] : undefined;
  const progress = questions.length ? solved.size / questions.length : 0;

  const submit = useCallback(
    async (answers: { questionId: string; selected: string[] }[]) => {
      const url = practice ? '/api/practice/complete' : `/api/levels/${levelId}/complete`;
      const body = practice ? { answers } : { answers, durationSec: Math.round((Date.now() - started) / 1000) };
      try {
        const r = await api<RewardResponse>(url, { method: 'POST', body });
        sfx.complete();
        setResult(r);
        void qc.invalidateQueries({ queryKey: ['me'] });
        void qc.invalidateQueries({ queryKey: ['path'] });
        void qc.invalidateQueries({ queryKey: ['discover'] });
        void qc.invalidateQueries({ queryKey: ['profile'] });
        void qc.invalidateQueries({ queryKey: ['lb'] });
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) {
          queueSubmission(url, body);
          setResult('offline');
        } else setSubmitError((e as Error).message);
      }
    },
    [levelId, practice, qc, started],
  );

  const check = useCallback(() => {
    if (!q || !selected.length || phase !== 'answering') return;
    const ok = checkAnswer(q, selected);
    if (!(q.id in firstTry)) setFirstTry((f) => ({ ...f, [q.id]: selected }));
    if (ok) {
      setPhase('correct');
      setCombo((c) => c + 1);
      setPraise(PRAISE[Math.floor(Math.random() * PRAISE.length)]!);
      setSolved((s) => new Set(s).add(q.id));
      sfx.correct();
      void confetti({ particleCount: 40, spread: 60, startVelocity: 28, origin: { y: 0.82 }, scalar: 0.8, colors: ['#22c55e', '#7c5cff', '#f5b301', '#38bdf8'], disableForReducedMotion: true });
    } else {
      setPhase('wrong');
      setCombo(0);
      setShake((n) => n + 1);
      sfx.wrong();
    }
  }, [q, selected, phase, firstTry]);

  const next = useCallback(() => {
    if (!q) return;
    const rest = queue.slice(1);
    // falsch beantwortete Fragen kommen am Ende noch einmal
    const newQueue = phase === 'wrong' ? [...rest, queue[0]!] : rest;
    setSelected([]);
    setPhase('answering');
    if (!newQueue.length) {
      setQueue([]);
      void submit(questions.map((x) => ({ questionId: x.id, selected: firstTry[x.id] ?? [] })));
    } else setQueue(newQueue);
  }, [q, queue, phase, questions, firstTry, submit]);

  const toggle = useCallback(
    (id: string) => {
      if (!q || phase !== 'answering') return;
      sfx.tap();
      if (q.type === 'multi') setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
      else setSelected([id]);
    },
    [q, phase],
  );

  // Tastatur: 1–6 wählen, Enter prüfen/weiter
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (quit || report || result) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (phase === 'answering') check();
        else next();
      }
      const n = Number(e.key);
      if (q && n >= 1 && n <= q.options.length) toggle(q.options[n - 1]!.id);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [phase, check, next, toggle, q, quit, report, result]);

  const gap = useMemo(() => {
    if (!q || q.type !== 'cloze') return undefined;
    const opt = q.options.find((o) => o.id === selected[0]);
    return (
      <span className={`mx-1 inline-flex min-w-20 items-center justify-center rounded-xl border-b-4 px-2 py-0.5 align-middle font-black ${opt ? 'border-primary bg-primary-soft text-primary' : 'border-line-strong bg-surface-2 text-transparent'}`}>
        {opt ? <Markdown text={opt.text} className="inline [&_p]:inline" /> : '____'}
      </span>
    );
  }, [q, selected]);

  if (isLoading) return <Spinner label="Level wird geladen …" />;
  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <Mascot pose="sad" size={140} />
        <p className="font-bold text-muted">{(error as Error).message}</p>
        <Button onClick={() => navigate('/')}>Zurück</Button>
      </div>
    );
  }
  if (practice && !questions.length) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <Mascot pose="cheer" size={170} />
        <h1 className="text-2xl font-black">Keine Fehler zum Üben!</h1>
        <p className="max-w-xs font-semibold text-muted">Falsch beantwortete Fragen tauchen hier in steigenden Abständen wieder auf, bis du sie sicher kannst.</p>
        <Button className="mt-4" onClick={() => navigate('/')}>
          Zum Lernpfad
        </Button>
      </div>
    );
  }
  if (result) {
    const petName = (id: string) => PETS.find((p) => p.id === id);
    return <Reward result={result} practice={!!practice} petName={petName} onContinue={(to) => navigate(to === '/' && data?.level?.kind === 'bonus' ? '/praxis' : to)} />;
  }
  if (!q) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        {submitError ? (
          <>
            <Mascot pose="sad" size={140} />
            <p className="font-bold text-error">{submitError}</p>
            <Button onClick={() => void submit(questions.map((x) => ({ questionId: x.id, selected: firstTry[x.id] ?? [] })))}>Erneut senden</Button>
          </>
        ) : (
          <Spinner label="Wird ausgewertet …" />
        )}
      </div>
    );
  }

  const retry = q.id in firstTry && phase === 'answering';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-20 bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-3 px-4">
          <button onClick={() => setQuit(true)} aria-label="Beenden" className="-ml-1 rounded-xl p-1.5 text-muted hover:bg-surface-2">
            <Icon name="x" size={26} weight={2.8} />
          </button>
          <ProgressBar value={progress} />
          <AnimatePresence>
            {combo >= 2 && (
              <motion.span key={combo} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} className="flex shrink-0 items-center gap-0.5 font-black text-flame" aria-label={`${combo}er-Combo`}>
                <img src="/assets/item-flame.webp" alt="" className="h-6 w-6" />×{combo}
              </motion.span>
            )}
          </AnimatePresence>
          <button
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
            aria-label={muted ? 'Ton an' : 'Ton aus'}
            className="rounded-xl p-1.5 text-muted hover:bg-surface-2"
          >
            <Icon name={muted ? 'mute' : 'sound'} />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-64 pt-2">
        <AnimatePresence mode="wait">
          <motion.div key={`${q.id}-${queue.length}`} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ duration: 0.22 }}>
            <div className="mb-2 flex items-center gap-2">
              {retry && <span className="rounded-lg bg-error-soft px-2 py-0.5 text-xs font-black uppercase text-error">Noch mal</span>}
              {data?.level?.kind === 'bonus' && <span className="rounded-lg bg-gold/20 px-2 py-0.5 text-xs font-black uppercase text-gold-dark">Praxis</span>}
              <h1 className="text-sm font-black uppercase tracking-wider text-primary">{TYPE_LABEL[q.type]}</h1>
            </div>
            <div key={shake} className={phase === 'wrong' ? 'animate-shake' : ''}>
              <Markdown text={q.prompt} gap={gap} className="mb-5 text-[1.18rem] font-extrabold leading-snug" />
              {q.type === 'estimate' && q.slider ? (
                <EstimateInput
                  slider={q.slider}
                  value={selected.length ? Number(selected[0]) : null}
                  onChange={(v) => phase === 'answering' && setSelected([String(v)])}
                  reveal={phase !== 'answering'}
                  correct={phase === 'correct'}
                />
              ) : q.type === 'truefalse' ? (
                <TrueFalse q={q} selected={selected} phase={phase} onPick={toggle} />
              ) : (
                <div className="space-y-3">
                  {q.options.map((o, i) => (
                    <OptionCard key={o.id} q={q} opt={o} index={i} selected={selected.includes(o.id)} phase={phase} onToggle={() => toggle(o.id)} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Fußbereich: Prüfen bzw. Feedback-Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-30">
        <AnimatePresence mode="wait">
          {phase === 'answering' ? (
            <motion.div key="check" className="safe-bottom border-t-2 border-line bg-bg" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="mx-auto max-w-xl px-4 py-4">
                <Button full variant="success" disabled={!selected.length} onClick={check}>
                  Prüfen
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="feedback"
              role="status"
              className={`safe-bottom rounded-t-3xl ${phase === 'correct' ? 'bg-success-soft' : 'bg-error-soft'}`}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            >
              <div className="mx-auto max-h-[60dvh] max-w-xl overflow-y-auto px-4 pb-4 pt-5">
                <div className={`flex items-center gap-3 ${phase === 'correct' ? 'text-success-dark dark:text-success' : 'text-error-dark dark:text-error'}`}>
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${phase === 'correct' ? 'bg-success' : 'bg-error'}`}>
                    <Icon name={phase === 'correct' ? 'check' : 'x'} size={24} weight={3.4} />
                  </span>
                  <h2 className="flex-1 text-2xl font-black">{phase === 'correct' ? praise : 'Nicht ganz …'}</h2>
                  <button
                    onClick={() => setReport(true)}
                    disabled={reported.has(q.id)}
                    aria-label="Frage melden"
                    className="rounded-xl p-2 opacity-70 hover:bg-black/5 hover:opacity-100 disabled:opacity-30"
                  >
                    <Icon name="flag" />
                  </button>
                </div>
                {phase === 'wrong' && (
                  <div className="mt-3 text-error-dark dark:text-error">
                    <p className="text-sm font-black uppercase">Richtig wäre:</p>
                    {q.slider && (
                      <p className="text-lg font-black">
                        {fmtNum(q.slider.answer)} {q.slider.unit ?? ''}
                        {q.slider.tolerance > 0 && <span className="text-sm font-extrabold opacity-80"> (± {fmtNum(q.slider.tolerance)} zählt als richtig)</span>}
                      </p>
                    )}
                    {q.options
                      .filter((o) => q.correct.includes(o.id))
                      .map((o) => (
                        <Markdown key={o.id} text={o.text} className="font-extrabold" />
                      ))}
                  </div>
                )}
                <Markdown text={q.explanation} className="mt-2 font-semibold text-ink/85" />
                <div className="mt-3">
                  <SourceLink q={q} />
                </div>
                <Button full variant={phase === 'correct' ? 'success' : 'error'} className="mt-4" onClick={next}>
                  Weiter
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Modal open={quit} onClose={() => setQuit(false)} title="Wirklich aufhören?">
        <div className="flex items-center gap-3">
          <Mascot pose="sad" size={90} />
          <p className="font-semibold text-muted">Dein Fortschritt in diesem Level geht verloren.</p>
        </div>
        <Button full className="mt-5" onClick={() => setQuit(false)}>
          Weiterlernen
        </Button>
        <Button full variant="ghost" className="mt-2 text-error!" onClick={() => navigate('/')}>
          Beenden
        </Button>
      </Modal>
      <ReportDialog
        q={q}
        open={report}
        onClose={(sent) => {
          setReport(false);
          if (sent) setReported((s) => new Set(s).add(q.id));
        }}
      />
    </div>
  );
}
