import { useState } from 'react';
import { ECONOMY, PETS, THEMES, type MeResponse, type ShopCategory, type ShopItem } from '@lernquest/shared';
import { PetImage } from '../components/Pet.tsx';
import { Page } from '../components/Shell.tsx';
import { Button, Modal, SectionTitle, Spinner, Toast } from '../components/ui.tsx';
import { api, assetUrl } from '../lib/api.ts';
import { useMe, useMeMutation, useShop } from '../lib/queries.ts';
import { fx } from '../lib/fx.ts';
import { sfx } from '../lib/sound.ts';

const SECTIONS: { cat: ShopCategory; title: string }[] = [
  { cat: 'powerup', title: 'Power-ups' },
  { cat: 'pet', title: 'Pets' },
  { cat: 'accessory', title: 'Accessoires' },
  { cat: 'theme', title: 'Farbschemata' },
  { cat: 'frame', title: 'Profilrahmen' },
];

function ItemVisual({ item }: { item: ShopItem }) {
  if (item.category === 'pet') return <PetImage petId={item.id.slice(4)} stage={1} size={72} />;
  if (item.category === 'theme') {
    const t = THEMES[item.id.slice(6)]!;
    return (
      <div className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl" style={{ background: `linear-gradient(135deg, ${t.primary}, ${t.primaryDark})` }}>
        <div className="h-7 w-12 rounded-lg bg-white/90 shadow-[0_3px_0_rgba(0,0,0,0.15)]" />
      </div>
    );
  }
  if (item.category === 'frame') {
    const bg = { 'frame:gold': 'conic-gradient(#ffe27a, #f5b301, #c98d00, #ffe27a)', 'frame:rainbow': 'conic-gradient(#ff5f6d, #ffc371, #f9f871, #6ee7b7, #60a5fa, #a78bfa, #ff5f6d)', 'frame:circuit': 'repeating-conic-gradient(#16a34a 0 12deg, #4ade80 12deg 24deg)' }[item.id];
    return (
      <div className="h-[72px] w-[72px] rounded-full p-1.5" style={{ background: bg }}>
        <div className="h-full w-full rounded-full bg-surface-2" />
      </div>
    );
  }
  const img = item.id === 'powerup:streak_freeze' ? 'item-streak_freeze' : item.id.replace(':', '-');
  return <img src={assetUrl(img)} alt="" className="h-[72px] w-[72px] object-contain" />;
}

export default function Shop() {
  const { data: me } = useMe();
  const { data: shop } = useShop();
  const [pick, setPick] = useState<ShopItem | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  const buy = useMeMutation((itemId: string) => api<MeResponse>('/api/shop/buy', { method: 'POST', body: { itemId } }));
  const theme = useMeMutation((t: string) => api<MeResponse>('/api/me/settings', { method: 'PATCH', body: { theme: t } }));

  if (!me || !shop) return <Spinner />;
  const owned = (i: ShopItem) =>
    i.category === 'pet' ? me.pets.some((p) => p.petId === i.id.slice(4)) : i.id === 'powerup:streak_freeze' ? me.stats.streakFreezes >= ECONOMY.maxStreakFreezes : me.inventory.includes(i.id);
  const flash = (msg: string, kind: 'success' | 'error') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <Page
      topLeft={
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-black">Shop</h1>
        </div>
      }
    >
      <div className="flex items-center gap-3 rounded-3xl bg-gradient-to-br from-[#ffd34d] to-[#f5a300] p-4 text-[#4a3300] shadow-card">
        <img src={assetUrl('item-chest')} alt="" className="h-16 w-16" />
        <div>
          <p className="text-sm font-black uppercase tracking-wider opacity-75">Dein Guthaben</p>
          <p className="flex items-center gap-1.5 text-3xl font-black">
            <img src={assetUrl('item-coin')} alt="" className="h-8 w-8" />
            {me.stats.coins}
          </p>
          <p className="text-xs font-bold opacity-80">Coins gibt’s für Level, Perfekt-Runden, Bosse und dein Tagesziel.</p>
        </div>
      </div>

      {SECTIONS.map((s) => (
        <section key={s.cat}>
          <SectionTitle>{s.title}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {shop.items
              .filter((i) => i.category === s.cat)
              .map((i) => {
                const has = owned(i);
                const isFreeze = i.id === 'powerup:streak_freeze';
                return (
                  <button key={i.id} onClick={() => setPick(i)} className="flex flex-col items-center rounded-3xl border-2 border-line bg-surface p-3 text-center shadow-[0_4px_0_var(--c-border)] active:translate-y-1 active:shadow-none">
                    <ItemVisual item={i} />
                    <p className="mt-2 font-black leading-tight">{i.name}</p>
                    {isFreeze && <p className="text-xs font-bold text-muted">Besitzt du: {me.stats.streakFreezes}/{ECONOMY.maxStreakFreezes}</p>}
                    <span className={`mt-2 flex items-center gap-1 rounded-xl px-2.5 py-1 text-sm font-black ${has ? 'bg-success-soft text-success-dark dark:text-success' : 'bg-gold/15 text-gold-dark'}`}>
                      {has ? (isFreeze ? 'Voll' : 'Besitzt du') : (
                        <>
                          <img src={assetUrl('item-coin')} alt="" className="h-4 w-4" />
                          {i.price}
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            {s.cat === 'theme' && (
              <button onClick={() => theme.mutate('default')} className={`flex flex-col items-center rounded-3xl border-2 bg-surface p-3 shadow-[0_4px_0_var(--c-border)] ${me.settings.theme === 'default' ? 'border-primary' : 'border-line'}`}>
                <div className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c5cff] to-[#5b3fd6]">
                  <div className="h-7 w-12 rounded-lg bg-white/90" />
                </div>
                <p className="mt-2 font-black">LernQuest</p>
                <span className="mt-2 rounded-xl bg-surface-2 px-2.5 py-1 text-sm font-black text-muted">{me.settings.theme === 'default' ? 'Aktiv' : 'Standard'}</span>
              </button>
            )}
          </div>
        </section>
      ))}

      <Modal open={!!pick} onClose={() => setPick(null)} title={pick?.name}>
        {pick && (
          <div className="text-center">
            <div className="flex justify-center">
              <ItemVisual item={pick} />
            </div>
            <p className="mt-3 font-semibold text-muted">{pick.description}</p>
            {pick.category === 'pet' && <p className="mt-1 text-sm font-bold text-muted">Entwickelt sich zu {PETS.find((p) => p.id === pick.id.slice(4))?.stageNames.slice(1).join(' und ')}.</p>}
            {owned(pick) ? (
              pick.category === 'theme' ? (
                <Button full className="mt-5" onClick={() => theme.mutate(pick.id.slice(6), { onSuccess: () => setPick(null) })}>
                  {me.settings.theme === pick.id.slice(6) ? 'Aktiv' : 'Aktivieren'}
                </Button>
              ) : (
                <p className="mt-5 font-black text-success">Schon in deinem Besitz</p>
              )
            ) : (
              <Button
                full
                variant="gold"
                className="mt-5"
                disabled={me.stats.coins < pick.price || buy.isPending}
                onClick={(e) => {
                  const at = e.currentTarget.getBoundingClientRect();
                  buy.mutate(pick.id, {
                    onSuccess: () => {
                      sfx.claim();
                      fx.coins(at);
                      flash(`${pick.name} gekauft!`, 'success');
                      setPick(null);
                    },
                    onError: (err) => flash((err as Error).message, 'error'),
                  });
                }}
              >
                <img src={assetUrl('item-coin')} alt="" className="h-5 w-5" />
                {me.stats.coins < pick.price ? `Noch ${pick.price - me.stats.coins} Coins` : `Für ${pick.price} kaufen`}
              </Button>
            )}
          </div>
        )}
      </Modal>
      <Toast message={toast?.msg ?? null} kind={toast?.kind} />
    </Page>
  );
}
