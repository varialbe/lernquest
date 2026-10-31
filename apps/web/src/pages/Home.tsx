import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { MODULE_INFO, PETS, petStage, type LevelNode, type ModuleId, type UnitNode } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Mascot, PetImage } from '../components/Pet.tsx';
import { Page } from '../components/Shell.tsx';
import { Button, Card, Modal, Pill, ProgressBar, Segmented, Spinner } from '../components/ui.tsx';
import { assetUrl } from '../lib/api.ts';
import { useMe, usePath } from '../lib/queries.ts';

const OFFSETS = [0, 56, 84, 56, 0, -56, -84, -56];
const KIND_ICON = { basics: 'star', apply: 'dumbbell', deepen: 'book' } as const;

function LevelButton({ level, color, current, onOpen }: { level: LevelNode; color: string; current: boolean; onOpen: () => void }) {
  const locked = level.status === 'locked';
  const gold = level.status === 'gold';
  const done = level.status === 'done' || gold;
  const boss = level.kind === 'boss';
  const bg = locked ? 'var(--c-locked)' : gold ? 'var(--c-gold)' : done ? color : color;
  const shadow = locked ? 'var(--c-locked-dark)' : gold ? 'var(--c-gold-dark)' : `color-mix(in oklab, ${color} 70%, black)`;
  const size = boss ? 84 : 72;
  return (
    <div className="relative flex flex-col items-center">
      {current && (
        <motion.div
          className="absolute -top-12 z-10 whitespace-nowrap rounded-xl border-2 border-line bg-surface px-3 py-1.5 text-sm font-black uppercase tracking-wide shadow-card"
          style={{ color }}
          animate={{ y: [0, -5, 0] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        >
          Start
          <span className="absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-line bg-surface" />
        </motion.div>
      )}
      <button
        onClick={onOpen}
        aria-label={`${level.title}${locked ? ' (gesperrt)' : done ? ' (abgeschlossen)' : ''}`}
        className={`relative flex items-center justify-center rounded-full transition-transform active:translate-y-[6px] ${current ? 'animate-ring' : ''}`}
        style={{ width: size, height: size - 6, background: bg, boxShadow: `0 6px 0 ${shadow}` }}
      >
        <span className="absolute inset-x-3 top-2 h-3 rounded-full bg-white/25" />
        {boss ? (
          <img src={assetUrl('item-chest')} alt="" className={`h-14 w-14 object-contain ${locked ? 'opacity-50 grayscale' : ''}`} />
        ) : locked ? (
          <Icon name="lock" size={30} className="text-white/90" weight={2.8} />
        ) : done ? (
          <Icon name={gold ? 'star' : 'check'} size={34} className="text-white" weight={3.2} fill={gold ? 'white' : undefined} />
        ) : (
          <Icon name={KIND_ICON[level.kind as keyof typeof KIND_ICON]} size={32} className="text-white" weight={2.8} fill={level.kind === 'basics' ? 'white' : undefined} />
        )}
      </button>
      {done && (
        <div className="mt-2 flex gap-0.5" aria-label={`${level.stars} von 3 Sternen`}>
          {[1, 2, 3].map((s) => (
            <Icon key={s} name="star" size={14} weight={1.5} className={s <= level.stars ? 'text-gold' : 'text-locked-dark'} fill="currentColor" />
          ))}
        </div>
      )}
    </div>
  );
}

function UnitSection({ unit, color, currentId, onOpen, index }: { unit: UnitNode; color: string; currentId: string | null; onOpen: (u: UnitNode, l: LevelNode) => void; index: number }) {
  const [info, setInfo] = useState(false);
  const allLocked = unit.levels.every((l) => l.status === 'locked');
  return (
    <section className="mb-6">
      <div className="relative overflow-hidden rounded-3xl p-4 text-white shadow-card" style={{ background: allLocked ? 'var(--c-locked-dark)' : color }}>
        <div className="absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/10" />
        <div className="absolute -bottom-10 right-10 h-20 w-20 rounded-full bg-white/10" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white/80">
              Unit {unit.number}
              {unit.isNew && <Pill className="bg-white text-[11px]" ><span style={{ color }}>Neu</span></Pill>}
            </div>
            <h2 className="mt-0.5 text-xl font-black leading-tight">{unit.title}</h2>
          </div>
          <button onClick={() => setInfo(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 border-white/30 bg-white/15" aria-label="Worum geht's?">
            <Icon name="book" size={22} />
          </button>
        </div>
      </div>

      <div className="relative mt-12 flex flex-col items-center gap-9">
        {unit.levels.map((l, i) => (
          <div key={l.id} style={{ transform: `translateX(${OFFSETS[(i + index * 2) % OFFSETS.length]}px)` }}>
            <LevelButton level={l} color={color} current={l.id === currentId} onOpen={() => onOpen(unit, l)} />
          </div>
        ))}
      </div>

      <Modal open={info} onClose={() => setInfo(false)} title={unit.title}>
        <p className="font-semibold text-muted">{unit.summary}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {unit.concepts.map((c) => (
            <span key={c} className="rounded-xl bg-surface-2 px-2.5 py-1 text-sm font-bold">
              {c}
            </span>
          ))}
        </div>
        <Button full className="mt-6" onClick={() => setInfo(false)}>
          Verstanden
        </Button>
      </Modal>
    </section>
  );
}

function DailyCard() {
  const { data: me } = useMe();
  if (!me) return null;
  const pet = me.pets.find((p) => p.petId === me.settings.activePet);
  const def = PETS.find((p) => p.id === pet?.petId);
  const s = me.stats;
  const done = s.todayXp >= s.dailyGoal;
  return (
    <Card className="flex items-center gap-3">
      <Link href="/pets" className="animate-float">
        {pet ? <PetImage petId={pet.petId} stage={petStage(pet.xp)} accessory={pet.accessory} size={76} /> : <Mascot size={76} />}
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold text-muted">
          {done ? `${def?.name ?? 'Dein Pet'} ist stolz auf dich!` : `Hallo ${me.user.displayName}!`}
        </p>
        <p className="font-black">{done ? 'Tagesziel geschafft 🎉' : `Tagesziel: ${s.todayXp} / ${s.dailyGoal} XP`}</p>
        <ProgressBar value={s.todayXp / s.dailyGoal} className="mt-2" height={12} color={done ? 'var(--c-gold)' : 'var(--c-success)'} />
      </div>
      {s.dueReviews > 0 && (
        <Link href="/practice" className="flex shrink-0 flex-col items-center rounded-2xl border-2 border-line px-2 py-1.5 text-center" aria-label={`${s.dueReviews} Fehler üben`}>
          <Icon name="dumbbell" className="text-error" />
          <span className="text-xs font-black text-error">{s.dueReviews}</span>
        </Link>
      )}
    </Card>
  );
}

export function Home() {
  const { data, isLoading } = usePath();
  const [, navigate] = useLocation();
  const [mod, setMod] = useState<ModuleId>(() => (localStorage.getItem('lq.module') as ModuleId) || 'DS');
  const [sel, setSel] = useState<{ unit: UnitNode; level: LevelNode } | null>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  useEffect(() => localStorage.setItem('lq.module', mod), [mod]);
  const module = data?.modules.find((m) => m.id === mod);
  const color = MODULE_INFO[mod].color;
  const currentId = useMemo(() => module?.units.flatMap((u) => u.levels).find((l) => l.status === 'open')?.id ?? null, [module]);

  useEffect(() => {
    const el = document.querySelector('[data-current="1"]');
    el?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  }, [mod, data]);

  return (
    <Page topLeft={<span className="text-xl font-black tracking-tight text-primary">LernQuest</span>}>
      <DailyCard />
      <div className="mt-5 flex items-center justify-between gap-3">
        <Segmented
          value={mod}
          onChange={setMod}
          options={(['DS', 'EIP', 'ERA'] as const).map((m) => ({ value: m, label: m, color: MODULE_INFO[m].color }))}
        />
        {module && <span className="shrink-0 text-sm font-black text-muted">{Math.round(module.progress * 100)} %</span>}
      </div>
      <p className="mb-4 mt-1 px-1 text-sm font-bold text-muted">{MODULE_INFO[mod].name}</p>

      {isLoading && <Spinner />}
      {module && module.units.length === 0 && (
        <div className="flex flex-col items-center py-10 text-center">
          <Mascot pose="sleep" size={160} />
          <p className="mt-3 text-lg font-black">Noch keine Vorlesungen</p>
          <p className="max-w-xs font-semibold text-muted">Sobald eine neue Mitschrift im Studium-Repo landet, entsteht hier über Nacht eine neue Unit.</p>
        </div>
      )}
      {module?.units.map((u, i) => (
        <div key={u.id} ref={u.levels.some((l) => l.id === currentId) ? currentRef : undefined} data-current={u.levels.some((l) => l.id === currentId) ? '1' : undefined}>
          <UnitSection unit={u} color={color} currentId={currentId} index={i} onOpen={(unit, level) => setSel({ unit, level })} />
        </div>
      ))}
      {module && module.units.length > 0 && (
        <div className="flex flex-col items-center pb-4 pt-2 text-center">
          <Mascot pose="think" size={110} />
          <p className="max-w-[16rem] text-sm font-bold text-muted">Die nächste Unit erscheint, sobald die nächste Vorlesung mitgeschrieben ist.</p>
        </div>
      )}

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.level.title}>
        {sel && (
          <div>
            <p className="font-bold text-muted">
              Unit {sel.unit.number} · {sel.unit.title}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-surface-2 p-3">
                <p className="text-xs font-extrabold uppercase text-muted">Fragen</p>
                <p className="text-2xl font-black">{sel.level.questionCount}</p>
              </div>
              <div className="rounded-2xl bg-surface-2 p-3">
                <p className="text-xs font-extrabold uppercase text-muted">Bestwert</p>
                <p className="text-2xl font-black">{sel.level.bestAccuracy != null ? `${Math.round(sel.level.bestAccuracy * 100)} %` : '–'}</p>
              </div>
            </div>
            {sel.level.status === 'locked' ? (
              <p className="mt-5 flex items-center gap-2 rounded-2xl bg-surface-2 p-3 font-bold text-muted">
                <Icon name="lock" /> Schließe zuerst das vorherige Level ab.
              </p>
            ) : (
              <Button full className="mt-5" style={{ background: color, boxShadow: `0 4px 0 color-mix(in oklab, ${color} 70%, black)` }} onClick={() => navigate(`/level/${sel.level.id}`)}>
                {sel.level.status === 'open' ? 'Starten' : 'Wiederholen'}
              </Button>
            )}
          </div>
        )}
      </Modal>
    </Page>
  );
}
