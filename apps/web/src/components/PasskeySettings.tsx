import { useCommonT, currentText, currentLocale } from '../i18n/common.ts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { isNative } from '../lib/native.ts';
import { addPasskey, isCancel, passkeyError, passkeysSupported } from '../lib/passkey.ts';
import { Icon } from './icons.tsx';

type Passkey = { id: string; name: string; createdAt: number; lastUsedAt: number | null };

const deviceName = () => (/iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Mac/.test(navigator.userAgent) ? 'Mac' : currentText("Gerät"));

/** Profil → Passkeys: anlegen (Safari/PWA) und entfernen. In der iOS-App nur ein Hinweis. */
export function PasskeySettings({ row, flash }: { row: string; flash: (m: string) => void }) {
  const ct = useCommonT();
  const qc = useQueryClient();
  const supported = passkeysSupported();
  const { data } = useQuery({ queryKey: ['passkeys'], queryFn: () => api<{ passkeys: Passkey[] }>('/api/me/passkeys') });
  const [busy, setBusy] = useState(false);
  const list = data?.passkeys ?? [];

  const add = async () => {
    setBusy(true);
    try {
      await addPasskey(`${deviceName()} · ${new Date().toLocaleDateString(currentLocale())}`);
      flash(ct("Passkey gespeichert 🔑"));
      void qc.invalidateQueries({ queryKey: ['passkeys'] });
    } catch (e) {
      if (!isCancel(e)) flash(passkeyError(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p: Passkey) => {
    if (!confirm(ct("Passkey „{p0}“ entfernen?", { p0: p.name }))) return;
    await api(`/api/me/passkeys/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).catch((e: Error) => flash(e.message));
    void qc.invalidateQueries({ queryKey: ['passkeys'] });
  };

  return (
    <div className="py-3">
      <div className={`${row} py-0`}>
        <span className="flex items-center gap-2 font-bold">
          <Icon name="key" size={20} /> Passkeys
        </span>
        {supported && (
          <button onClick={add} disabled={busy} className="rounded-xl border-2 border-primary px-2.5 py-1 text-sm font-black text-primary disabled:opacity-50">
            {busy ? '…' : ct("+ Hinzufügen")}
          </button>
        )}
      </div>
      {!supported && (
        <p className="mt-1 text-xs font-semibold text-muted">
          {isNative ? ct("In der iOS-App nicht verfügbar (bräuchte einen bezahlten Apple-Account). Öffne LernQuest in Safari oder als Home-Screen-App, um einen Passkey anzulegen.") : ct("Dein Browser unterstützt keine Passkeys.")}
        </p>
      )}
      {list.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {list.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-bold">{p.name}</span>
                <span className="text-xs font-semibold text-muted">{p.lastUsedAt ? ct("zuletzt {p0}", { p0: new Date(p.lastUsedAt).toLocaleDateString(currentLocale()) }) : ct("noch nicht benutzt")}</span>
              </span>
              <button onClick={() => void remove(p)} aria-label={ct("{p0} entfernen", { p0: p.name })} className="rounded-lg p-1.5 text-muted hover:text-error">
                <Icon name="x" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
