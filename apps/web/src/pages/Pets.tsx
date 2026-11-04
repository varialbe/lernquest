import { usePageT } from '../i18n/pages.ts';
import { translateGameText } from '../i18n/catalog.ts';
import { useLocale } from '../i18n/index.tsx';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'wouter';
import { PET_STAGE_XP, PETS, SHOP_ITEMS, petStage } from '@lernquest/shared';
import { PetImage } from '../components/Pet.tsx';
import { Page } from '../components/Shell.tsx';
import { Button, Card, ProgressBar, SectionTitle, Spinner } from '../components/ui.tsx';
import { api, assetUrl } from '../lib/api.ts';
import { useMe, useMeMutation } from '../lib/queries.ts';
import type { MeResponse } from '@lernquest/shared';

export default function Pets() {
  const t = usePageT();
  const { locale } = useLocale();
  const { data: me } = useMe();
  const [focus, setFocus] = useState<string | null>(null);
  const setActive = useMeMutation((petId: string) => api<MeResponse>('/api/me/settings', { method: 'PATCH', body: { activePet: petId } }));
  const equip = useMeMutation((v: { petId: string; accessory: string | null }) => api<MeResponse>('/api/pets/equip', { method: 'POST', body: v }));
  if (!me) return <Spinner />;

  const owned = new Map(me.pets.map((p) => [p.petId, p]));
  const shownId = focus ?? me.settings.activePet ?? me.pets[0]?.petId;
  const shown = shownId ? owned.get(shownId) : undefined;
  const def = PETS.find((p) => p.id === shownId);
  const steps: readonly number[] = PET_STAGE_XP;
  const names: readonly string[] = def?.stageNames ?? [];
  const accessories = SHOP_ITEMS.filter((i) => i.category === 'accessory' && me.inventory.includes(i.id));

  return (
    <Page topLeft={<h1 className="text-xl font-black">Pets</h1>}>
      {shown && def && (
        <Card className="relative overflow-hidden text-center">
          <div className="absolute inset-x-0 top-0 h-28 opacity-25" style={{ background: `radial-gradient(60% 100% at 50% 0%, ${def.color}, transparent)` }} />
          <motion.div key={shown.petId + shown.accessory} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative mx-auto w-fit animate-float">
            <PetImage petId={shown.petId} stage={shown.stage} accessory={shown.accessory} size={190} />
          </motion.div>
          <h2 className="mt-1 text-2xl font-black">{translateGameText(def.stageNames[shown.stage - 1]!, locale)}</h2>
          <p className="font-bold text-muted">
            {t("Stufe {stage} von 3 · {xp} XP", {stage: shown.stage, xp: shown.xp})}
          </p>
          {shown.stage < 3 ? (
            <div className="mx-auto mt-3 max-w-xs">
              <ProgressBar value={(shown.xp - steps[shown.stage - 1]!) / (steps[shown.stage]! - steps[shown.stage - 1]!)} color={def.color} height={12} />
              <p className="mt-1 text-xs font-bold text-muted">
                {t("Noch {xp} XP bis {name}", {xp: steps[shown.stage]! - shown.xp, name: translateGameText(names[shown.stage]!, locale)})}
              </p>
            </div>
          ) : (
            <p className="mt-2 font-black text-gold-dark">{t("Voll entwickelt ✨")}</p>
          )}
          <p className="mt-3 text-sm font-semibold text-muted">{t("Dein Lieblings-Pet bekommt alle XP, die du sammelst.")}</p>
          {me.settings.activePet === shown.petId ? (
            <p className="mt-3 font-black text-success">{t("★ Lieblings-Pet")}</p>
          ) : (
            <Button className="mt-3" onClick={() => setActive.mutate(shown.petId)}>
              {t("Als Lieblings-Pet wählen")}
            </Button>
          )}

          {accessories.length > 0 && (
            <div className="mt-5 text-left">
              <p className="mb-2 px-1 text-sm font-black uppercase tracking-wider text-muted">{t("Accessoire")}</p>
              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                <button onClick={() => equip.mutate({ petId: shown.petId, accessory: null })} className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 text-xs font-black ${!shown.accessory ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                  {t("Ohne")}
                </button>
                {accessories.map((a) => (
                  <button
                    key={a.id}
                    aria-label={translateGameText(a.name, locale)}
                    onClick={() => equip.mutate({ petId: shown.petId, accessory: a.id })}
                    className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 ${shown.accessory === a.id ? 'border-primary bg-primary-soft' : 'border-line'}`}
                  >
                    <img src={assetUrl(a.id.replace(':', '-'))} alt="" className="h-11 w-11 object-contain" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <SectionTitle action={<Link href="/shop" className="text-sm font-black text-primary">{t("Zum Shop")}</Link>}>{t("Sammlung")}</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        {PETS.map((p) => {
          const o = owned.get(p.id);
          const active = shownId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => (o ? setFocus(p.id) : undefined)}
              className={`flex flex-col items-center rounded-2xl border-2 bg-surface p-2 ${active ? 'border-primary shadow-[0_4px_0_var(--c-primary)]' : 'border-line shadow-[0_4px_0_var(--c-border)]'}`}
            >
              <PetImage petId={p.id} stage={o ? petStage(o.xp) : 1} size={76} silhouette={!o} />
              <span className="mt-1 text-sm font-black">{o ? translateGameText(p.stageNames[petStage(o.xp) - 1]!, locale) : '???'}</span>
              {!o && (
                <span className="flex items-center gap-0.5 text-xs font-black text-gold-dark">
                  <img src={assetUrl('item-coin')} alt="" className="h-4 w-4" />
                  {p.price}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Page>
  );
}
