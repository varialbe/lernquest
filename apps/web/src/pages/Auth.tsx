import { motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { PETS, STARTER_PETS, type PublicUser } from '@lernquest/shared';
import { Mascot, PetImage } from '../components/Pet.tsx';
import { Button } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { api } from '../lib/api.ts';
import { Copyright } from './Legal.tsx';
import { autofillAvailable, cancelPasskeyAutofill, isCancel, loginWithPasskey, passkeyError, passkeysSupported } from '../lib/passkey.ts';

function Field({ label, hint, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block px-1 text-sm font-extrabold text-muted">{label}</span>
      <input
        {...rest}
        className="h-13 w-full rounded-2xl border-2 border-line bg-surface-2 px-4 text-base font-bold text-ink outline-none transition-colors placeholder:font-semibold placeholder:text-muted/70 focus:border-primary focus:bg-surface"
      />
      {hint && <span className="mt-1 block px-1 text-xs font-semibold text-muted">{hint}</span>}
    </label>
  );
}

function AuthLayout({ children, pose = 'happy', title, subtitle }: { children: ReactNode; pose?: 'happy' | 'cheer' | 'book'; title: string; subtitle: string }) {
  return (
    <div className="safe-top flex min-h-dvh flex-col items-center bg-[radial-gradient(120%_60%_at_50%_0%,var(--c-primary-soft),transparent_70%)] px-5 pb-10">
      <motion.div className="mt-8 animate-float" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
        <Mascot pose={pose} size={150} />
      </motion.div>
      <h1 className="mt-2 text-center text-3xl font-black tracking-tight">{title}</h1>
      <p className="mb-6 mt-1 max-w-xs text-center font-semibold text-muted">{subtitle}</p>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

const ErrorBox = ({ msg }: { msg: string | null }) =>
  msg ? (
    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-error-soft px-4 py-3 text-sm font-bold text-error" role="alert">
      {msg}
    </motion.p>
  ) : null;

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPasskey = passkeysSupported();
  const loginRef = useRef(onLogin);
  loginRef.current = onLogin;
  // Passkey als Vorschlag direkt im Benutzernamen-Feld (Safari/iOS „Passwörter“)
  useEffect(() => {
    let alive = true;
    void autofillAvailable().then((ok) => {
      if (!ok || !alive) return;
      loginWithPasskey(true)
        .then((t) => alive && loginRef.current(t))
        .catch((e) => alive && !isCancel(e) && setError(passkeyError(e)));
    });
    return () => {
      alive = false;
      cancelPasskeyAutofill();
    };
  }, []);
  const passkey = async () => {
    setBusy(true);
    setError(null);
    try {
      onLogin(await loginWithPasskey(false));
    } catch (e) {
      if (!isCancel(e)) setError(passkeyError(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>('/api/auth/login', { method: 'POST', body: { username, password } });
      onLogin(r.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="LernQuest" subtitle="DS, EIP und ERA – jeden Tag ein kleines Level.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Benutzername" id="username" name="username" autoComplete={canPasskey ? 'username webauthn' : 'username'} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />
        <Field label="Passwort" id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <ErrorBox msg={error} />
        <Button type="submit" full disabled={busy || !username || !password}>
          {busy ? 'Einen Moment …' : 'Anmelden'}
        </Button>
        {canPasskey && (
          <Button type="button" variant="secondary" full disabled={busy} onClick={passkey}>
            <span className="inline-flex items-center gap-2">
              <Icon name="key" size={20} /> Mit Passkey anmelden
            </span>
          </Button>
        )}
      </form>
      <p className="mt-8 text-center text-sm font-bold text-muted">
        Neu hier?{' '}
        <Link href="/register" className="text-primary underline-offset-2 hover:underline">
          Mit Einladungscode registrieren
        </Link>
      </p>
      <Copyright className="mt-6" />
    </AuthLayout>
  );
}

export function Register({ onLogin }: { onLogin: (token: string) => void }) {
  const presetCode = new URLSearchParams(location.search).get('code') ?? '';
  const [f, setF] = useState({ inviteCode: presetCode, username: '', displayName: '', password: '', email: '' });
  const [newsletter, setNewsletter] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [pet, setPet] = useState(STARTER_PETS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: PublicUser }>('/api/auth/register', {
        method: 'POST',
        body: { ...f, email: newsletter ? f.email : undefined, newsletter, acceptPrivacy: privacy, starterPet: pet },
      });
      onLogin(r.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Willkommen!" subtitle="Leg dir ein Konto an und such dir dein erstes Pet aus." pose="cheer">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Benutzername" id="username" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={f.username} onChange={set('username')} hint="3–24 Zeichen: Buchstaben, Zahlen, _ . -" required />
        <Field label="Anzeigename" name="nickname" autoComplete="nickname" value={f.displayName} onChange={set('displayName')} placeholder="So sehen dich die anderen" required />
        <Field label="Passwort" id="new-password" name="new-password" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} hint="Mindestens 8 Zeichen" required />
        <div>
          <span className="mb-2 block px-1 text-sm font-extrabold text-muted">Wähle dein erstes Pet</span>
          <div className="grid grid-cols-3 gap-3">
            {STARTER_PETS.map((id) => {
              const p = PETS.find((x) => x.id === id)!;
              const active = pet === id;
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => setPet(id)}
                  aria-pressed={active}
                  className={`flex flex-col items-center rounded-2xl border-2 p-2 transition-all ${active ? 'border-primary bg-primary-soft shadow-[0_4px_0_var(--c-primary)]' : 'border-line bg-surface shadow-[0_4px_0_var(--c-border)]'}`}
                >
                  <PetImage petId={id} stage={1} size={72} />
                  <span className="mt-1 text-sm font-black">{p.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <details className="group rounded-2xl border-2 border-line bg-surface px-4 py-3" open={!!presetCode}>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-extrabold text-muted">
            Einladungscode (optional)
            <Icon name="chevronRight" size={18} className="transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-3">
            <Field label="Code von der Person, die dich eingeladen hat" name="invite" autoComplete="off" placeholder="LQ-XXXX-XXXX" autoCapitalize="characters" value={f.inviteCode} onChange={set('inviteCode')} />
          </div>
        </details>
        <label className="flex cursor-pointer items-start gap-3 px-1 text-sm font-bold">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--c-primary)]" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} />
          <span>Newsletter abonnieren (gelegentlich Neuigkeiten zu LernQuest, jederzeit abbestellbar)</span>
        </label>
        {newsletter && <Field label="E-Mail für den Newsletter" name="email" type="email" autoComplete="email" value={f.email} onChange={set('email')} required />}
        <label className="flex cursor-pointer items-start gap-3 px-1 text-sm font-bold">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--c-primary)]" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required />
          <span>
            Ich habe die{' '}
            <Link href="/datenschutz" className="text-primary underline">
              Datenschutzerklärung
            </Link>{' '}
            gelesen und bin einverstanden.
          </span>
        </label>
        <ErrorBox msg={error} />
        <Button type="submit" full disabled={busy || !privacy}>
          {busy ? 'Einen Moment …' : 'Los geht’s'}
        </Button>
      </form>
      <p className="mt-8 text-center text-sm font-bold text-muted">
        Schon dabei?{' '}
        <Link href="/login" className="text-primary hover:underline">
          Anmelden
        </Link>
      </p>
      <Copyright className="mt-6" />
    </AuthLayout>
  );
}

export function ChangePassword({ forced, onDone, username }: { forced?: boolean; onDone: (token: string) => void; username?: string }) {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ token: string }>('/api/auth/password', { method: 'POST', body: { oldPassword, newPassword } });
      onDone(r.token);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <AuthLayout title="Neues Passwort" subtitle={forced ? 'Dein Passwort wurde zurückgesetzt. Bitte wähle jetzt ein eigenes.' : 'Ändere dein Passwort.'} pose="book">
      <form onSubmit={submit} className="space-y-4">
        {username && <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />}
        {!forced && <Field label="Aktuelles Passwort" type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOld(e.target.value)} required />}
        <Field label="Neues Passwort" name="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} hint="Mindestens 8 Zeichen" required />
        <ErrorBox msg={error} />
        <Button type="submit" full disabled={newPassword.length < 8}>
          Speichern
        </Button>
      </form>
    </AuthLayout>
  );
}
