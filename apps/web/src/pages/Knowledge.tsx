import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { KNOWLEDGE_KIND_LABEL, MODULE_INFO, MODULES, type KnowledgeEntryView as KnowledgeEntry, type KnowledgeModuleResponse, type ModuleId } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { MathText, plainMath } from '../components/MathText.tsx';
import { Mascot } from '../components/Pet.tsx';
import { Page } from '../components/Shell.tsx';
import { Button, Card, Modal, Pill, Segmented, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { savedModule } from '../lib/queries.ts';
import { moduleColor } from '../lib/theme.ts';

type UnitK = KnowledgeModuleResponse['units'][number];
type Hit = { e: KnowledgeEntry; unit: UnitK; score: number };

/** Für die Suche: Kleinbuchstaben, ohne Akzente/LaTeX */
const norm = (s: string) =>
  plainMath(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');


/** Ansicht der Liste: nach Vorlesung gruppiert, alphabetisch oder nach Art (Begriff, Konzept, …) */
type View = 'lecture' | 'az' | 'kind';
const VIEWS: { value: View; label: string }[] = [
  { value: 'lecture', label: 'Vorlesung' },
  { value: 'az', label: 'A–Z' },
  { value: 'kind', label: 'Art' },
];
const KIND_ORDER = Object.keys(KNOWLEDGE_KIND_LABEL) as KnowledgeEntry['kind'][];
/** Eine Unit = eine Vorlesung (Mitschrift „… VO<n>.md“) */
const lectureLabel = (u: UnitK) => `Vorlesung ${u.unitNumber} · ${plainMath(u.unitTitle)}`;
const sortKey = (term: string) => plainMath(term).replace(/^[^\p{L}\p{N}]+/u, '');
const byTerm = (a: { e: KnowledgeEntry }, b: { e: KnowledgeEntry }) => sortKey(a.e.term).localeCompare(sortKey(b.e.term), 'de', { sensitivity: 'base', numeric: true });
/** Anfangsbuchstabe für die A–Z-Überschriften (Umlaute unter dem Grundbuchstaben, Zahlen/Symbole unter „#“) */
const letterOf = (term: string) => {
  const c = norm(sortKey(term)).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

function search(units: UnitK[], q: string): Hit[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: Hit[] = [];
  for (const unit of units) {
    for (const e of unit.entries) {
      const term = norm(e.term);
      const body = norm(`${e.short} ${e.explanation} ${e.example ?? ''} ${e.related.join(' ')}`);
      if (!words.every((w) => term.includes(w) || body.includes(w))) continue;
      const full = words.join(' ');
      const score = (term === full ? 100 : 0) + (term.startsWith(full) ? 50 : 0) + words.filter((w) => term.includes(w)).length * 10;
      hits.push({ e, unit, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.unit.unitNumber - b.unit.unitNumber).slice(0, 60);
}

/** Voraussetzungs-Graph des Moduls (aus der API) + Navigation */
type Graph = {
  byId: Map<string, { e: KnowledgeEntry; unit: UnitK }>;
  usedBy: Map<string, string[]>;
  jump: (id: string) => void;
  explain: (id: string) => void;
};
const GraphCtx = createContext<Graph | null>(null);

/**
 * Lernpfad „von Grund auf“: alle (transitiven) Voraussetzungen bis zum Begriff, Grundlagen zuerst.
 * Deterministisch aus dem Graphen; bei großen Bäumen die nächsten `max` Schritte.
 */
export function learningPath(target: string, requires: (id: string) => { id: string }[], max = 12): string[] {
  const depth = new Map<string, number>([[target, 0]]);
  const queue = [target];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const l of requires(cur)) {
      if (depth.has(l.id)) continue;
      depth.set(l.id, depth.get(cur)! + 1);
      queue.push(l.id);
    }
  }
  const keep = new Set([...depth.entries()].sort((a, b) => a[1] - b[1]).slice(0, max).map(([id]) => id));
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !keep.has(id)) return;
    seen.add(id);
    for (const l of requires(id)) visit(l.id);
    out.push(id);
  };
  visit(target);
  return out;
}

function PathView({ target, onClose }: { target: string; onClose: () => void }) {
  const g = useContext(GraphCtx)!;
  const req = (id: string) => g.byId.get(id)?.e.requires ?? [];
  const steps = learningPath(target, req);
  const [open, setOpen] = useState<string | null>(target);
  const t = g.byId.get(target);
  if (!t) return null;
  return (
    <Modal open onClose={onClose} title={`Von Grund auf: ${t.e.term}`}>
      <p className="-mt-1 mb-3 text-sm font-semibold text-muted">
        {steps.length - 1} {steps.length === 2 ? 'Grundlage' : 'Grundlagen'}, dann der Begriff selbst. Tippe einen Schritt an, um die Erklärung zu sehen.
      </p>
      <ol className="relative space-y-2 border-l-2 border-dashed border-line pl-4">
        {steps.map((id, i) => {
          const x = g.byId.get(id)!;
          const isTarget = id === target;
          // wofür braucht man diesen Schritt (spätere Schritte, die ihn voraussetzen)
          const forSteps = steps.slice(i + 1).flatMap((later) => {
            const link = req(later).find((l) => l.id === id);
            return link ? [{ term: g.byId.get(later)!.e.term, why: (link as { why?: string }).why ?? '' }] : [];
          });
          const expanded = open === id;
          return (
            <li key={id} className="relative">
              <span
                className={`absolute -left-[1.6rem] top-3 flex h-5 w-5 items-center justify-center rounded-full text-[0.65rem] font-black text-white ${isTarget ? 'bg-primary' : 'bg-muted'}`}
                aria-hidden
              >
                {i + 1}
              </span>
              <div className={`rounded-2xl border-2 bg-surface ${isTarget ? 'border-primary' : 'border-line'}`}>
                <button className="w-full p-3 text-left" onClick={() => setOpen(expanded ? null : id)} aria-expanded={expanded}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-black"><MathText text={x.e.term} /></span>
                    <Pill className="bg-surface-2 text-muted">{KNOWLEDGE_KIND_LABEL[x.e.kind]}</Pill>
                    <span className="ml-auto text-xs font-bold text-muted">VO {x.unit.unitNumber}</span>
                  </div>
                  <Markdown inline text={x.e.short} className="mt-1 block text-sm font-semibold text-muted" />
                  {forSteps.length > 0 && (
                    <p className="mt-1 text-xs font-bold text-primary">
                      → nötig für {plainMath(forSteps.map((f) => f.term).join(', '))}
                      {forSteps[0]!.why && <span className="font-semibold text-muted">: {plainMath(forSteps[0]!.why)}</span>}
                    </p>
                  )}
                </button>
                {expanded && (
                  <div className="border-t-2 border-line px-3 pb-3 pt-2 text-sm">
                    <Markdown text={x.e.explanation} />
                    {x.e.example && (
                      <div className="mt-2 rounded-xl bg-surface-2 p-2.5">
                        <p className="mb-1 text-xs font-black uppercase tracking-wider text-muted">Beispiel</p>
                        <Markdown text={x.e.example} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <Button full variant="secondary" className="mt-4" onClick={() => g.jump(target)}>
        Zum Eintrag
      </Button>
    </Modal>
  );
}

function Prereqs({ e }: { e: KnowledgeEntry }) {
  const g = useContext(GraphCtx);
  if (!g) return null;
  const req = e.requires.filter((r) => g.byId.has(r.id));
  const used = (g.usedBy.get(e.id) ?? []).filter((id) => g.byId.has(id));
  if (!req.length && !used.length) return null;
  return (
    <div className="mt-3 rounded-xl bg-surface-2 p-3">
      {req.length > 0 && (
        <>
          <p className="text-xs font-black uppercase tracking-wider text-muted">Dafür brauchst du</p>
          <ul className="mt-1 space-y-1 text-sm">
            {req.map((r) => (
              <li key={r.id} className="font-semibold">
                <button onClick={() => g.jump(r.id)} className="font-extrabold text-primary underline decoration-2 underline-offset-2 active:opacity-70">
                  <MathText text={g.byId.get(r.id)!.e.term} />
                </button>
                {r.why && (
                  <span className="text-muted">
                    {' – '}
                    <Markdown inline text={r.why} />
                  </span>
                )}
              </li>
            ))}
          </ul>
          <Button full variant="secondary" className="mt-3" onClick={() => g.explain(e.id)}>
            <Icon name="sparkle" size={18} />
            Von Grund auf erklären
          </Button>
        </>
      )}
      {used.length > 0 && (
        <div className={`flex flex-wrap items-center gap-1.5 ${req.length ? 'mt-3' : ''}`}>
          <span className="text-xs font-black uppercase tracking-wider text-muted">Baut darauf auf</span>
          {used.slice(0, 8).map((id) => (
            <button key={id} onClick={() => g.jump(id)} className="rounded-full border-2 border-line bg-surface px-2 py-0.5 text-xs font-extrabold text-primary active:scale-95">
              <MathText text={g.byId.get(id)!.e.term} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EntryCard({ e, color, unitLabel, open, onToggle, onRelated }: { e: KnowledgeEntry; color: string; unitLabel?: string; open: boolean; onToggle: () => void; onRelated: (t: string) => void }) {
  return (
    <div id={e.id} className={`scroll-mt-24 rounded-2xl border-2 bg-surface transition-colors ${open ? 'border-[color:var(--acc)]' : 'border-line'}`} style={{ ['--acc' as string]: color }}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 p-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-black leading-tight"><MathText text={e.term} /></span>
            <Pill className="bg-surface-2 text-muted">{KNOWLEDGE_KIND_LABEL[e.kind]}</Pill>
          </div>
          {unitLabel && <p className="mt-0.5 text-xs font-black uppercase tracking-wider" style={{ color }}>{unitLabel}</p>}
          <Markdown inline text={e.short} className={`mt-1 block text-sm font-semibold text-muted ${open ? '' : 'line-clamp-2'}`} />
        </div>
        <Icon name="chevronRight" size={20} className={`mt-0.5 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t-2 border-line px-3 pb-3 pt-2">
              <Markdown text={e.explanation} />
              {e.example && (
                <div className="mt-3 rounded-xl bg-surface-2 p-3">
                  <p className="mb-1 text-xs font-black uppercase tracking-wider text-muted">Beispiel</p>
                  <Markdown text={e.example} />
                </div>
              )}
              {e.pitfalls.length > 0 && (
                <div className="mt-3 rounded-xl border-2 border-dashed border-line p-3">
                  <p className="mb-1 text-xs font-black uppercase tracking-wider text-error">Achtung</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm font-semibold">
                    {e.pitfalls.map((p) => (
                      <li key={p}>
                        <Markdown inline text={p} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Prereqs e={e} />
              {e.related.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="text-xs font-black uppercase tracking-wider text-muted">Siehe auch</span>
                  {e.related.map((r) => (
                    <button key={r} onClick={() => onRelated(r)} className="rounded-full border-2 border-line px-2 py-0.5 text-xs font-extrabold text-primary active:scale-95">
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Wissenssammlung: alle Begriffe/Konzepte jeder Unit zum Nachschlagen (Üben → Wissen). */
export default function Knowledge() {
  const params = new URLSearchParams(useSearch());
  const initialMod = params.get('m')?.toUpperCase();
  const [mod, setMod] = useState<ModuleId>(() => (MODULES.includes(initialMod as ModuleId) ? (initialMod as ModuleId) : savedModule()));
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => (VIEWS.some((v) => v.value === params.get('sort')) ? (params.get('sort') as View) : 'lecture'));
  /** nur Einträge dieser Vorlesung (unitId), null = alle */
  const [lecture, setLecture] = useState<string | null>(null);
  const [newestFirst, setNewestFirst] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['knowledge', mod], queryFn: () => api<KnowledgeModuleResponse>(`/api/knowledge/${mod}`), staleTime: 5 * 60_000 });
  const color = moduleColor(mod);
  const units = data?.units ?? [];
  const total = units.reduce((n, u) => n + u.entries.length, 0);
  const lectures = units.filter((u) => u.entries.length > 0);
  const shownUnits = useMemo(() => {
    const list = lecture ? units.filter((u) => u.unitId === lecture) : units;
    return newestFirst ? [...list].reverse() : list;
  }, [units, lecture, newestFirst]);
  const hits = useMemo(() => search(lecture ? units.filter((u) => u.unitId === lecture) : units, q), [units, lecture, q]);
  const flat = useMemo(() => shownUnits.flatMap((unit) => unit.entries.map((e) => ({ e, unit }))), [shownUnits]);
  /** A–Z: Gruppen je Anfangsbuchstabe; Art: Gruppen je Art, darin nach Vorlesung */
  const groups = useMemo(() => {
    if (view === 'az') {
      const out: { key: string; title: string; items: typeof flat }[] = [];
      for (const it of [...flat].sort(byTerm)) {
        const l = letterOf(it.e.term);
        if (out.at(-1)?.key !== l) out.push({ key: l, title: l, items: [] });
        out.at(-1)!.items.push(it);
      }
      return out;
    }
    if (view === 'kind')
      return KIND_ORDER.map((k) => ({ key: k, title: KNOWLEDGE_KIND_LABEL[k], items: flat.filter((it) => it.e.kind === k) })).filter((g) => g.items.length);
    return [];
  }, [flat, view]);
  // gewählte Vorlesung zurücksetzen, wenn es sie (nach Modulwechsel) nicht gibt
  useEffect(() => {
    if (lecture && !units.some((u) => u.unitId === lecture)) setLecture(null);
  }, [units]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-Link (?q=Konzept): exakten Treffer direkt aufklappen
  useEffect(() => {
    if (q && hits[0] && norm(hits[0].e.term) === norm(q)) setOpenEntry(hits[0].e.id);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Graph: Eintrag → Unit, „baut darauf auf“ (umgekehrte Kanten)
  const graph = useMemo<Omit<Graph, 'jump' | 'explain'>>(() => {
    const byId = new Map<string, { e: KnowledgeEntry; unit: UnitK }>();
    const usedBy = new Map<string, string[]>();
    for (const unit of units) for (const e of unit.entries) byId.set(e.id, { e, unit });
    for (const { e } of byId.values()) for (const r of e.requires) usedBy.set(r.id, [...(usedBy.get(r.id) ?? []), e.id]);
    return { byId, usedBy };
  }, [units]);
  const [pathFor, setPathFor] = useState<string | null>(null);
  const jump = (id: string) => {
    const hit = graph.byId.get(id);
    if (!hit) return;
    setPathFor(null);
    setQ('');
    if (lecture && lecture !== hit.unit.unitId) setLecture(null);
    setOpenUnit(hit.unit.unitId);
    setOpenEntry(id);
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
  };
  const ctx: Graph = { ...graph, jump, explain: setPathFor };

  const related = (term: string) => {
    setQ(term);
    setOpenEntry(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <GraphCtx.Provider value={ctx}>
    <Page
      topLeft={
        <Link href="/train" className="flex items-center gap-1 text-xl font-black">
          <Icon name="chevronLeft" />
          Wissen
        </Link>
      }
    >
      <Segmented
        value={mod}
        onChange={(m) => {
          setMod(m);
          setLecture(null);
          setOpenUnit(null);
          setOpenEntry(null);
          try {
            localStorage.setItem('lq.module', m);
          } catch {
            /* egal */
          }
        }}
        options={MODULES.map((m) => ({ value: m, label: m, color: moduleColor(m) }))}
      />

      <div className="relative mt-3">
        <Icon name="search" size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpenEntry(null);
          }}
          placeholder={total ? `${total} Begriffe in ${MODULE_INFO[mod].short} durchsuchen …` : 'Begriff suchen …'}
          className="w-full rounded-2xl border-2 border-line bg-surface py-2.5 pl-11 pr-10 font-bold outline-none focus:border-primary"
          aria-label="Begriff suchen"
        />
        {q && (
          <button onClick={() => setQ('')} aria-label="Suche leeren" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
            <Icon name="x" size={18} />
          </button>
        )}
      </div>

      {/* Sortierung + Filter nach Vorlesung */}
      {total > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs font-black uppercase tracking-wider text-muted">Sortieren</span>
            <div className="flex flex-1 rounded-2xl border-2 border-line bg-surface p-0.5" role="radiogroup" aria-label="Sortieren nach">
              {VIEWS.map((v) => {
                const active = view === v.value;
                return (
                  <button
                    key={v.value}
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setView(v.value);
                      setOpenEntry(null);
                    }}
                    className={`flex-1 rounded-xl px-2 py-1 text-sm font-extrabold transition-colors ${active ? 'text-white' : 'text-muted'}`}
                    style={active ? { background: color } : undefined}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={lecture ?? ''}
              onChange={(ev) => {
                const id = ev.target.value || null;
                setLecture(id);
                setOpenEntry(null);
                setOpenUnit(id);
              }}
              aria-label="Vorlesung auswählen"
              className="min-w-0 flex-1 truncate rounded-2xl border-2 border-line bg-surface px-3 py-1.5 text-sm font-bold outline-none focus:border-primary"
              style={lecture ? { borderColor: color } : undefined}
            >
              <option value="">Alle Vorlesungen ({lectures.length})</option>
              {lectures.map((u) => (
                <option key={u.unitId} value={u.unitId}>
                  {lectureLabel(u)} ({u.entries.length})
                </option>
              ))}
            </select>
            {view === 'lecture' && !lecture && !q.trim() && (
              <button
                onClick={() => setNewestFirst(!newestFirst)}
                aria-label={newestFirst ? 'Älteste Vorlesung zuerst' : 'Neueste Vorlesung zuerst'}
                className="shrink-0 rounded-2xl border-2 border-line bg-surface px-3 py-1.5 text-sm font-extrabold text-muted active:scale-95"
              >
                {newestFirst ? 'Neueste ↓' : 'Älteste ↓'}
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading && <Spinner />}
      {error && !data && <p className="mt-6 text-center font-bold text-muted">Die Wissenssammlung konnte nicht geladen werden.</p>}

      {data && !total && (
        <div className="flex flex-col items-center py-10 text-center">
          <Mascot pose="book" size={140} />
          <p className="mt-2 font-black">Noch keine Einträge</p>
          <p className="max-w-xs text-sm font-semibold text-muted">Die Wissenssammlung für {MODULE_INFO[mod].short} entsteht gerade – zu jeder Vorlesung automatisch.</p>
        </div>
      )}

      {/* Suchergebnisse */}
      {q.trim() && data && total > 0 && (
        <div className="mt-4 space-y-2">
          <p className="px-1 text-sm font-bold text-muted">{hits.length ? `${hits.length} Treffer` : `Nichts gefunden für „${q}“.`}</p>
          {hits.map(({ e, unit }) => (
            <EntryCard key={e.id} e={e} color={color} unitLabel={lectureLabel(unit)} open={openEntry === e.id} onToggle={() => setOpenEntry(openEntry === e.id ? null : e.id)} onRelated={related} />
          ))}
        </div>
      )}

      {/* A–Z / nach Art */}
      {!q.trim() && total > 0 && view !== 'lecture' && (
        <div className="mt-4 space-y-4">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.title}>
              <h2 className="mb-2 flex items-baseline gap-2 border-b-2 border-line px-1 pb-1">
                <span className="text-lg font-black" style={{ color }}>{g.title}</span>
                <span className="text-xs font-bold text-muted">{g.items.length}</span>
              </h2>
              <div className="space-y-2">
                {g.items.map(({ e, unit }) => (
                  <EntryCard key={e.id} e={e} color={color} unitLabel={lecture ? undefined : lectureLabel(unit)} open={openEntry === e.id} onToggle={() => setOpenEntry(openEntry === e.id ? null : e.id)} onRelated={related} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* nach Vorlesung */}
      {!q.trim() && total > 0 && view === 'lecture' && (
        <div className="mt-4 space-y-3">
          {shownUnits.map((u, i) => {
            const open = openUnit === u.unitId;
            return (
              <motion.div key={u.unitId} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: Math.min(i, 8) * 0.03 }}>
                <Card className="overflow-hidden p-0!">
                  <button onClick={() => setOpenUnit(open ? null : u.unitId)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-black" style={{ background: `color-mix(in oklab, ${color} 18%, var(--c-surface))`, color }}>
                      {u.unitNumber}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black uppercase tracking-wider" style={{ color }}>Vorlesung {u.unitNumber}</p>
                      <p className="font-black leading-tight">
                        <MathText text={u.unitTitle} />
                      </p>
                      <p className="text-sm font-semibold text-muted">{u.entries.length ? `${u.entries.length} Begriffe & Konzepte` : 'kommt bald'}</p>
                    </div>
                    <Icon name="chevronRight" className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
                  </button>
                  {open && (
                    <div className="space-y-2 border-t-2 border-line p-3">
                      {u.overview && (
                        <div className="rounded-2xl bg-surface-2 p-3 text-sm">
                          <Markdown text={u.overview} />
                        </div>
                      )}
                      {u.entries.map((e) => (
                        <EntryCard key={e.id} e={e} color={color} open={openEntry === e.id} onToggle={() => setOpenEntry(openEntry === e.id ? null : e.id)} onRelated={related} />
                      ))}
                    </div>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
      {pathFor && <PathView target={pathFor} onClose={() => setPathFor(null)} />}
    </Page>
    </GraphCtx.Provider>
  );
}
