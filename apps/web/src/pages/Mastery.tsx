import { usePageT } from '../i18n/pages.ts';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { MODULE_INFO, type ModuleId } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Mascot } from '../components/Pet.tsx';
import { Page } from '../components/Shell.tsx';
import { Button, Card, Segmented, Spinner } from '../components/ui.tsx';
import { savedModule, useMastery } from '../lib/queries.ts';
import { ConceptBar, LEVEL_COLOR } from './Train.tsx';
import { moduleColor } from '../lib/theme.ts';

const GROUPS = [
  { level: 'weak', title: 'Unsicher' },
  { level: 'ok', title: 'Fast sicher' },
  { level: 'strong', title: 'Sitzt' },
  { level: 'new', title: 'Zu wenig Daten' },
] as const;

/** Schwächen-Übersicht: Trefferquote je Konzept (letzte 10 Antworten). */
export default function Mastery() {
  const t = usePageT();
  const { data, isLoading } = useMastery();
  const [mod, setMod] = useState<ModuleId>(savedModule);
  const [, navigate] = useLocation();
  const m = data?.modules.find((x) => x.id === mod);
  const touched = m?.concepts.filter((c) => c.level !== 'new') ?? [];

  return (
    <Page
      topLeft={
        <Link href="/train" className="flex items-center gap-1 text-xl font-black">
          <Icon name="chevronLeft" />
          {t("Konzepte")}
        </Link>
      }
    >
      <Segmented
        value={mod}
        onChange={(v) => {
          setMod(v);
          localStorage.setItem('lq.module', v);
        }}
        options={(['DS', 'EIP', 'ERA'] as const).map((x) => ({ value: x, label: x, color: moduleColor(x) }))}
      />
      {isLoading && <Spinner />}
      {m && !m.concepts.length && (
        <div className="flex flex-col items-center py-10 text-center">
          <Mascot pose="think" size={140} />
          <p className="mt-2 font-black">{t("Noch keine Daten")}</p>
          <p className="max-w-xs text-sm font-semibold text-muted">{t("Sobald du Fragen in {module} beantwortest, siehst du hier pro Konzept, wie sicher du bist.", {module: MODULE_INFO[mod].short})}</p>
        </div>
      )}
      {m && m.concepts.length > 0 && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {(['weak', 'ok', 'strong'] as const).map((l) => (
              <div key={l} className="rounded-2xl border-2 border-line bg-surface py-2">
                <p className="text-2xl font-black" style={{ color: LEVEL_COLOR[l] }}>
                  {m.concepts.filter((c) => c.level === l).length}
                </p>
                <p className="text-xs font-black uppercase tracking-wider text-muted">{t(GROUPS.find((g) => g.level === l)!.title)}</p>
              </div>
            ))}
          </div>
          {GROUPS.map((g) => {
            const list = m.concepts.filter((c) => c.level === g.level);
            if (!list.length) return null;
            return (
              <Card key={g.level} className="mt-4">
                <h2 className="mb-3 font-black" style={{ color: LEVEL_COLOR[g.level] }}>
                  {t(g.title)} · {list.length}
                </h2>
                <div className="space-y-3">
                  {list.map((c) => (
                    <ConceptBar key={c.concept} c={c} />
                  ))}
                </div>
              </Card>
            );
          })}
          {m.untouched > 0 && <p className="mt-4 text-center text-sm font-bold text-muted">{t("{count} weitere Konzepte hast du noch nicht geübt.", {count: m.untouched})}</p>}
        </>
      )}
      {touched.length > 0 && (
        <div className="sticky bottom-20 mt-5">
          <Button full onClick={() => navigate(`/weak/${mod}`)}>
            {t("Schwächen üben")}
          </Button>
        </div>
      )}
    </Page>
  );
}
