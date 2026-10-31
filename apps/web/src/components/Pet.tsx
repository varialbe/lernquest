import { useState } from 'react';
import { PETS, petStage } from '@lernquest/shared';
import { assetUrl } from '../lib/api.ts';

/** Position des Accessoires relativ zum Pet-Bild (in %). */
const ACC_POS: Record<string, { top: string; left: string; width: string; rotate?: number }> = {
  'acc:party_hat': { top: '-14%', left: '30%', width: '40%', rotate: -8 },
  'acc:grad_cap': { top: '-10%', left: '24%', width: '52%', rotate: -6 },
  'acc:crown': { top: '-12%', left: '28%', width: '44%' },
  'acc:glasses': { top: '28%', left: '26%', width: '48%' },
  'acc:headphones': { top: '-2%', left: '12%', width: '76%' },
  'acc:scarf': { top: '52%', left: '22%', width: '56%' },
};

export function PetImage({ petId, stage, accessory, size = 96, className = '', silhouette = false }: { petId: string; stage: number; accessory?: string | null; size?: number; className?: string; silhouette?: boolean }) {
  const [broken, setBroken] = useState(false);
  const pet = PETS.find((p) => p.id === petId);
  const acc = accessory ? ACC_POS[accessory] : undefined;
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {broken ? (
        <div className="flex h-full w-full items-center justify-center rounded-full text-3xl font-black text-white" style={{ background: pet?.color ?? '#999' }}>
          {pet?.name[0] ?? '?'}
        </div>
      ) : (
        <img
          src={assetUrl(`pet-${petId}-${stage}`)}
          alt={pet ? pet.stageNames[stage - 1] : petId}
          className={`h-full w-full object-contain drop-shadow-[0_6px_6px_rgba(40,20,90,0.18)] ${silhouette ? 'opacity-35 brightness-0 dark:invert' : ''}`}
          onError={() => setBroken(true)}
          draggable={false}
        />
      )}
      {acc && !silhouette && (
        <img
          src={assetUrl(accessory!.replace(':', '-'))}
          alt=""
          className="pointer-events-none absolute"
          style={{ top: acc.top, left: acc.left, width: acc.width, transform: acc.rotate ? `rotate(${acc.rotate}deg)` : undefined }}
          draggable={false}
        />
      )}
    </div>
  );
}

export function PetFromState({ pet, size }: { pet: { petId: string; xp: number; accessory: string | null } | undefined; size?: number }) {
  if (!pet) return null;
  return <PetImage petId={pet.petId} stage={petStage(pet.xp)} accessory={pet.accessory} size={size} />;
}

export function Mascot({ pose = 'happy', size = 140, className = '' }: { pose?: 'happy' | 'cheer' | 'sad' | 'think' | 'sleep' | 'book'; size?: number; className?: string }) {
  return <img src={assetUrl(`mascot-${pose}`)} alt="Lumo" width={size} height={size} className={`object-contain ${className}`} style={{ width: size, height: size }} draggable={false} />;
}

const FRAME_STYLE: Record<string, string> = {
  gold: 'conic-gradient(from 0deg, #ffe27a, #f5b301, #c98d00, #ffe27a)',
  rainbow: 'conic-gradient(#ff5f6d, #ffc371, #f9f871, #6ee7b7, #60a5fa, #a78bfa, #ff5f6d)',
  circuit: 'repeating-conic-gradient(#16a34a 0 12deg, #4ade80 12deg 24deg)',
};

/** Rundes Avatar (aktives Pet) mit optionalem Profilrahmen aus dem Shop. */
export function Avatar({ pet, petStage: stage = 1, frame, size = 48, name }: { pet: string | null; petStage?: number; frame: string | null; size?: number; name: string }) {
  const ring = frame ? FRAME_STYLE[frame] : undefined;
  return (
    <div className="shrink-0 rounded-full p-[3px]" style={{ background: ring ?? 'var(--c-border)', width: size, height: size }}>
      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-surface-2">
        {pet ? <PetImage petId={pet} stage={stage} size={size * 0.86} /> : <span className="text-lg font-black text-muted">{name[0]?.toUpperCase()}</span>}
      </div>
    </div>
  );
}
