import confetti from 'canvas-confetti';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { ACHIEVEMENTS, type PetDef, type RewardResponse } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Mascot, PetImage } from '../components/Pet.tsx';
import { Button } from '../components/ui.tsx';
import { assetUrl } from '../lib/api.ts';
import { sfx } from '../lib/sound.ts';

function CountUp({ to, delay = 0 }: { to: number; delay?: number }) {
  const v = useMotionValue(0);
  const rounded = useTransform(v, (x) => Math.round(x).toString());
  useEffect(() => {
    const c = animate(v, to, { duration: 0.9, delay, ease: 'easeOut' });
    return () => c.stop();
  }, [to, delay, v]);
  return <motion.span>{rounded}</motion.span>;
}

function Tile({ label, color, icon, children, delay }: { label: string; color: string; icon: string; children: React.ReactNode; delay: number }) {
  return (
    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay }} className="overflow-hidden rounded-2xl border-2 text-center" style={{ borderColor: color }}>
      <div className="py-1 text-[11px] font-black uppercase tracking-wider text-white" style={{ background: color }}>
        {label}
      </div>
      <div className="flex items-center justify-center gap-1.5 bg-surface py-3 text-2xl font-black" style={{ color }}>
        <img src={assetUrl(icon)} alt="" className="h-7 w-7" />
        {children}
      </div>
    </motion.div>
  );
}

export function Reward({ result, practice, petName, onContinue }: { result: RewardResponse | 'offline'; practice: boolean; petName: (id: string) => PetDef | undefined; onContinue: (to: string) => void }) {
  useEffect(() => {
    if (result === 'offline') return;
    const fire = (x: number) => confetti({ particleCount: 70, angle: x < 0.5 ? 60 : 120, spread: 70, origin: { x, y: 0.7 }, colors: ['#7c5cff', '#22c55e', '#f5b301', '#38bdf8', '#f472b6'], disableForReducedMotion: true });
    fire(0.1);
    fire(0.9);
    const t = setTimeout(() => sfx.coin(), 900);
    return () => clearTimeout(t);
  }, [result]);

  if (result === 'offline') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <Mascot pose="think" size={160} />
        <h1 className="text-2xl font-black">Offline gespeichert</h1>
        <p className="max-w-xs font-semibold text-muted">Sobald du wieder online bist, wird dein Ergebnis übertragen und XP, Coins und Streak werden gutgeschrieben.</p>
        <Button className="mt-4" onClick={() => onContinue('/')}>
          Weiter
        </Button>
      </div>
    );
  }

  const r = result;
  const pet = r.pet ? petName(r.pet.petId) : undefined;
  const nextLevel = r.unlocked[0];
  return (
    <div className="safe-top flex min-h-dvh flex-col bg-[radial-gradient(110%_55%_at_50%_0%,var(--c-primary-soft),transparent_70%)]">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-5 pb-36 pt-8 text-center">
        <motion.div initial={{ scale: 0.4, rotate: -10, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 14 }}>
          <Mascot pose="cheer" size={150} />
        </motion.div>
        <h1 className="mt-2 text-3xl font-black text-primary">{practice ? 'Übung geschafft!' : r.stars === 3 ? 'Perfekt!' : 'Level geschafft!'}</h1>

        {!practice && (
          <div className="mt-3 flex gap-2" aria-label={`${r.stars} von 3 Sternen`}>
            {[1, 2, 3].map((s) => (
              <motion.span key={s} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.25 + s * 0.18, type: 'spring', stiffness: 300, damping: 12 }}>
                <Icon name="star" size={44} weight={1.5} className={s <= r.stars ? 'text-gold' : 'text-locked'} fill="currentColor" />
              </motion.span>
            ))}
          </div>
        )}

        <div className="mt-6 grid w-full grid-cols-3 gap-3">
          <Tile label="XP" color="#7c5cff" icon="item-xp" delay={0.3}>
            <CountUp to={r.xp} delay={0.4} />
          </Tile>
          <Tile label="Coins" color="#e0a100" icon="item-coin" delay={0.45}>
            <CountUp to={r.coins} delay={0.55} />
          </Tile>
          <Tile label="Genau" color="#22c55e" icon="badge-perfect" delay={0.6}>
            <CountUp to={Math.round(r.accuracy * 100)} delay={0.7} />%
          </Tile>
        </div>

        {r.streakIncreased && (
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.9, type: 'spring' }} className="mt-5 flex w-full items-center gap-3 rounded-2xl border-2 border-flame/40 bg-surface p-3">
            <motion.img src={assetUrl('item-flame')} alt="" className="h-14 w-14" animate={{ scale: [1, 1.18, 1], rotate: [0, -6, 6, 0] }} transition={{ delay: 1.1, duration: 0.9 }} />
            <div className="text-left">
              <p className="text-xl font-black text-flame">{r.streak} {r.streak === 1 ? 'Tag' : 'Tage'} Streak!</p>
              <p className="text-sm font-bold text-muted">Komm morgen wieder, um ihn zu verlängern.</p>
            </div>
          </motion.div>
        )}

        {r.dailyGoalReached && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="mt-3 rounded-2xl bg-success-soft px-4 py-2 font-black text-success-dark dark:text-success">
            🎯 Tagesziel erreicht – +5 Bonus-Coins
          </motion.p>
        )}

        {r.pet && pet && (
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1.2 }} className="mt-5 flex w-full items-center gap-3 rounded-2xl border-2 border-line bg-surface p-3">
            <motion.div animate={{ y: [0, -14, 0, -8, 0] }} transition={{ delay: 1.4, duration: 1 }}>
              <PetImage petId={r.pet.petId} stage={r.pet.stage} accessory={r.pet.accessory} size={72} />
            </motion.div>
            <div className="text-left">
              <p className="font-black">{r.pet.evolved ? `✨ ${pet.name} hat sich entwickelt!` : `${pet.stageNames[r.pet.stage - 1]} freut sich!`}</p>
              <p className="text-sm font-bold text-muted">{r.pet.evolved ? `Jetzt: ${pet.stageNames[r.pet.stage - 1]}` : `+${r.xp} Pet-XP`}</p>
            </div>
          </motion.div>
        )}

        {r.newAchievements.length > 0 && (
          <div className="mt-5 w-full">
            <p className="mb-2 text-sm font-black uppercase tracking-wider text-muted">Neues Abzeichen</p>
            {r.newAchievements.map((id) => {
              const a = ACHIEVEMENTS.find((x) => x.id === id);
              return a ? (
                <motion.div key={id} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 1.5 }} className="mb-2 flex items-center gap-3 rounded-2xl border-2 border-gold/50 bg-surface p-2.5 text-left">
                  <img src={assetUrl(a.icon)} alt="" className="h-12 w-12" />
                  <div>
                    <p className="font-black">{a.name}</p>
                    <p className="text-sm font-semibold text-muted">{a.description}</p>
                  </div>
                </motion.div>
              ) : null;
            })}
          </div>
        )}
      </main>
      <div className="safe-bottom fixed inset-x-0 bottom-0 border-t-2 border-line bg-bg">
        <div className="mx-auto flex max-w-md flex-col gap-2 px-5 py-4">
          {nextLevel && !practice ? (
            <>
              <Button full onClick={() => onContinue(`/level/${nextLevel}`)}>
                Nächstes Level
              </Button>
              <Button full variant="ghost" onClick={() => onContinue('/')}>
                Zum Lernpfad
              </Button>
            </>
          ) : (
            <Button full onClick={() => onContinue('/')}>
              Weiter
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
