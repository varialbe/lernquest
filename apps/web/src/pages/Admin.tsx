import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'wouter';
import type { Question } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Page } from '../components/Shell.tsx';
import { Button, Card, Modal, Pill, Segmented, Spinner, Toast } from '../components/ui.tsx';
import { api } from '../lib/api.ts';

type Run = { id: string; mode: string; status: string; startedAt: number; finishedAt: number | null; summary: string | null };
type AdminUser = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  disabled: boolean;
  unlockAll: boolean;
  xp: number;
  coins: number;
  streak: number;
  lastActiveDay: string | null;
  createdAt: number;
  invitedWith: string | null;
  email: string | null;
  emailVerified: boolean;
  newsletter: 'none' | 'pending' | 'confirmed';
  google: boolean;
  hasPassword: boolean;
  sessions: number;
  passkeys: number;
};
type Invite = { code: string; note: string | null; maxUses: number; uses: number; revoked: boolean; expiresAt: number | null; createdAt: number };
type Report = { report: { id: number; questionId: string; reason: string; comment: string | null; status: string; createdAt: number }; username: string | null; question: Question | null; active: boolean | null };
type Note = { id: number; level: string; title: string; body: string; read: boolean; createdAt: number };
type Overview = { users: number; units: number; questions: number; openReports: number; unreadNotifications: number; lastRun: Run | null; failedFiles: { path: string; error: string | null; attempts: number }[] };

const fmt = (t: number) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
const STATUS: Record<string, string> = { success: 'bg-success-soft text-success-dark', nothing_new: 'bg-surface-2 text-muted', partial: 'bg-gold/20 text-gold-dark', failed: 'bg-error-soft text-error', running: 'bg-primary-soft text-primary' };
const REASON: Record<string, string> = { wrong_answer: 'Antwort falsch', unclear: 'Unklar', typo: 'Tippfehler', other: 'Sonstiges' };

function useAdmin<T>(key: string) {
  return useQuery({ queryKey: ['admin', key], queryFn: () => api<T>(`/api/admin/${key}`), refetchInterval: key === 'runs' ? 10_000 : false });
}

function OverviewTab({ flash }: { flash: (m: string) => void }) {
  const qc = useQueryClient();
  const { data } = useAdmin<Overview>('overview');
  const trigger = useMutation({
    mutationFn: (mode: string) => api<{ runId: string }>('/api/admin/runs', { method: 'POST', body: { mode } }),
    onSuccess: (r) => {
      flash(`Lauf ${r.runId} gestartet`);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => flash((e as Error).message),
  });
  if (!data) return <Spinner />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Nutzer', data.users],
          ['Units', data.units],
          ['Aktive Fragen', data.questions],
          ['Offene Meldungen', data.openReports],
        ].map(([l, v]) => (
          <Card key={l as string} className="p-3">
            <p className="text-xs font-black uppercase text-muted">{l}</p>
            <p className="text-2xl font-black">{v}</p>
          </Card>
        ))}
      </div>
      <Card>
        <p className="text-xs font-black uppercase text-muted">Letzter Pipeline-Lauf</p>
        {data.lastRun ? (
          <>
            <div className="mt-1 flex items-center gap-2">
              <Pill className={STATUS[data.lastRun.status]}>{data.lastRun.status}</Pill>
              <span className="text-sm font-bold text-muted">{fmt(data.lastRun.startedAt)}</span>
            </div>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-2 text-xs">{data.lastRun.summary}</pre>
          </>
        ) : (
          <p className="font-bold text-muted">Noch kein Lauf</p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button className="px-2 text-sm" onClick={() => trigger.mutate('run')} disabled={trigger.isPending}>
            Starten
          </Button>
          <Button variant="secondary" className="px-2 text-sm" onClick={() => trigger.mutate('dry-run')} disabled={trigger.isPending}>
            Dry-Run
          </Button>
        </div>
      </Card>
      {data.failedFiles.length > 0 && (
        <Card>
          <p className="mb-2 text-xs font-black uppercase text-error">Fehlgeschlagene Dateien</p>
          {data.failedFiles.map((f) => (
            <div key={f.path} className="mb-2 text-sm">
              <p className="font-black">{f.path}</p>
              <p className="font-semibold text-muted">
                {f.attempts}× · {f.error?.slice(0, 200)}
              </p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function UsersTab({ flash }: { flash: (m: string) => void }) {
  const qc = useQueryClient();
  const { data } = useAdmin<AdminUser[]>('users');
  const [temp, setTemp] = useState<{ user: string; pw: string } | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [edit, setEdit] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ displayName: '', username: '', email: '' });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  const patch = useMutation({
    mutationFn: (v: { id: number; body: Record<string, unknown> }) => api(`/api/admin/users/${v.id}`, { method: 'PATCH', body: v.body }),
    onSuccess: () => {
      refresh();
      setEdit(null);
    },
    onError: (e) => flash((e as Error).message),
  });
  const reset = useMutation({
    mutationFn: (u: AdminUser) => api<{ temporaryPassword: string }>(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' }).then((r) => ({ user: u.username, pw: r.temporaryPassword })),
    onSuccess: (t) => {
      setTemp(t);
      refresh();
    },
    onError: (e) => flash((e as Error).message),
  });
  /** Aktion mit Rückfrage */
  const act = async (u: AdminUser, question: string, method: string, path: string, done: string) => {
    if (!confirm(`${question}\n\n@${u.username} (${u.displayName})`)) return;
    try {
      await api(`/api/admin/users/${u.id}${path}`, { method });
      flash(done);
      refresh();
    } catch (e) {
      flash((e as Error).message);
    }
  };
  if (!data) return <Spinner />;
  const needle = q.trim().toLowerCase();
  const list = needle ? data.filter((u) => [u.username, u.displayName, u.email ?? '', u.invitedWith ?? ''].some((s) => s.toLowerCase().includes(needle))) : data;
  const btn = 'rounded-xl border-2 border-line px-2.5 py-1 font-black';
  const nlLabel = { confirmed: '📧 Newsletter', pending: '📧 wartet auf Bestätigung', none: '' } as const;
  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Suchen in ${data.length} Konten (Name, E-Mail, Code) …`} className="w-full rounded-2xl border-2 border-line bg-surface px-4 py-2.5 font-bold outline-none focus:border-primary" />
      {list.map((u) => (
        <Card key={u.id} className="p-3">
          <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(open === u.id ? null : u.id)} aria-expanded={open === u.id}>
            <div className="min-w-0">
              <p className="truncate font-black">
                {u.displayName} <span className="font-bold text-muted">@{u.username}</span>
              </p>
              <p className="truncate text-xs font-bold text-muted">
                {u.email ? `${u.email}${u.emailVerified ? ' ✓' : ' (unbestätigt)'}` : 'keine E-Mail'} · {u.xp} XP · 🔥 {u.streak}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {u.role === 'admin' && <Pill className="bg-primary-soft text-primary">Admin</Pill>}
              {u.disabled && <Pill className="bg-error-soft text-error">Gesperrt</Pill>}
              <Icon name="chevronRight" size={18} className={`text-muted transition-transform ${open === u.id ? 'rotate-90' : ''}`} />
            </div>
          </button>
          {open === u.id && (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-2xl bg-surface-2 p-3 text-xs font-bold">
                <dt className="text-muted">Registriert</dt>
                <dd>{new Date(u.createdAt).toLocaleDateString('de-DE')}</dd>
                <dt className="text-muted">Zuletzt aktiv</dt>
                <dd>{u.lastActiveDay ?? '–'}</dd>
                <dt className="text-muted">Anmeldung</dt>
                <dd>{[u.hasPassword && 'Passwort', u.google && 'Google', u.passkeys && `${u.passkeys} Passkey${u.passkeys > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || '–'}</dd>
                <dt className="text-muted">Sitzungen</dt>
                <dd>{u.sessions}</dd>
                <dt className="text-muted">Eingeladen via</dt>
                <dd>{u.invitedWith ?? '–'}</dd>
                <dt className="text-muted">Newsletter</dt>
                <dd>{nlLabel[u.newsletter] || 'nein'}</dd>
                <dt className="text-muted">Coins</dt>
                <dd>{u.coins}</dd>
              </dl>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                <button
                  className={btn}
                  onClick={() => {
                    setForm({ displayName: u.displayName, username: u.username, email: u.email ?? '' });
                    setEdit(u);
                  }}
                >
                  Bearbeiten
                </button>
                {u.email && (
                  <button className={btn} onClick={() => void act(u, `Passwort-Reset-Link an ${u.email} senden?`, 'POST', '/send-reset', `Reset-Link an ${u.email} gesendet`)}>
                    Reset-Mail senden
                  </button>
                )}
                <button className={btn} onClick={() => confirm(`Temporäres Passwort für @${u.username} erzeugen? Alle Sitzungen werden beendet.`) && reset.mutate(u)}>
                  Temporäres Passwort
                </button>
                <button className={btn} onClick={() => patch.mutate({ id: u.id, body: { disabled: !u.disabled } })}>
                  {u.disabled ? 'Entsperren' : 'Sperren'}
                </button>
                <button className={`${btn} ${u.unlockAll ? 'border-primary text-primary' : ''}`} onClick={() => patch.mutate({ id: u.id, body: { unlockAll: !u.unlockAll } })}>
                  {u.unlockAll ? 'Alles frei ✓' : 'Alles freischalten'}
                </button>
                <button className={btn} onClick={() => void act(u, 'Alle Sitzungen beenden (auf allen Geräten abmelden)?', 'POST', '/revoke-sessions', 'Abgemeldet')}>
                  Abmelden erzwingen
                </button>
                {u.google && (
                  <button className={btn} onClick={() => void act(u, 'Google-Verknüpfung trennen?', 'DELETE', '/google', 'Google getrennt')}>
                    Google trennen
                  </button>
                )}
                <button className={btn} onClick={() => patch.mutate({ id: u.id, body: { role: u.role === 'admin' ? 'user' : 'admin' } })}>
                  {u.role === 'admin' ? 'Admin entziehen' : 'Zum Admin machen'}
                </button>
                <button className={`${btn} text-error`} onClick={() => void act(u, 'Fortschritt zurücksetzen? XP, Coins, Streak, Level-Fortschritt und Wiederholungen werden gelöscht. Konto, Pets und Items bleiben.', 'POST', '/reset-progress', 'Fortschritt zurückgesetzt')}>
                  Fortschritt zurücksetzen
                </button>
                <button className={`${btn} border-error text-error`} onClick={() => void act(u, 'Konto ENDGÜLTIG löschen? Alle Daten dieses Kontos werden entfernt. Das lässt sich nicht rückgängig machen.', 'DELETE', '', 'Konto gelöscht')}>
                  Konto löschen
                </button>
              </div>
            </>
          )}
        </Card>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`@${edit?.username ?? ''} bearbeiten`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!edit) return;
            const body: Record<string, unknown> = {};
            if (form.displayName !== edit.displayName) body.displayName = form.displayName;
            if (form.username !== edit.username) body.username = form.username;
            if (form.email.trim() !== (edit.email ?? '')) body.email = form.email.trim() || null;
            if (!Object.keys(body).length) return setEdit(null);
            patch.mutate({ id: edit.id, body });
          }}
        >
          {(
            [
              ['displayName', 'Anzeigename', 'text'],
              ['username', 'Benutzername', 'text'],
              ['email', 'E-Mail (leer = entfernen; neue Adresse bekommt eine Bestätigungs-Mail)', 'email'],
            ] as const
          ).map(([k, label, type]) => (
            <label key={k} className="block">
              <span className="mb-1 block px-1 text-sm font-extrabold text-muted">{label}</span>
              <input type={type} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="w-full rounded-2xl border-2 border-line bg-surface-2 px-4 py-2.5 font-bold outline-none focus:border-primary" />
            </label>
          ))}
          <Button full type="submit" disabled={patch.isPending}>
            Speichern
          </Button>
        </form>
      </Modal>
      <Modal open={!!temp} onClose={() => setTemp(null)} title="Temporäres Passwort">
        <p className="font-semibold text-muted">Für @{temp?.user} – wird nur jetzt angezeigt. Beim nächsten Login muss ein neues Passwort gesetzt werden.</p>
        <p className="mt-3 select-all rounded-2xl bg-surface-2 p-3 text-center font-mono text-xl font-black">{temp?.pw}</p>
        <Button full className="mt-4" onClick={() => void navigator.clipboard?.writeText(temp?.pw ?? '').then(() => flash('Kopiert'))}>
          Kopieren
        </Button>
      </Modal>
    </div>
  );
}

function InvitesTab({ flash }: { flash: (m: string) => void }) {
  const qc = useQueryClient();
  const { data } = useAdmin<Invite[]>('invites');
  const [uses, setUses] = useState(1);
  const create = useMutation({
    mutationFn: () => api<Invite>('/api/admin/invites', { method: 'POST', body: { maxUses: uses } }),
    onSuccess: (i) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'invites'] });
      void navigator.clipboard?.writeText(`${location.origin}/register?code=${i.code}`).then(() => flash('Einladungslink kopiert'));
    },
  });
  const revoke = useMutation({ mutationFn: (code: string) => api(`/api/admin/invites/${code}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'invites'] }) });
  if (!data) return <Spinner />;
  return (
    <div className="space-y-3">
      <Card className="flex items-center gap-3">
        <label className="flex items-center gap-2 font-bold">
          Nutzungen
          <input type="number" min={1} max={50} value={uses} onChange={(e) => setUses(Number(e.target.value))} className="w-16 rounded-xl border-2 border-line bg-surface-2 px-2 py-1 font-black" />
        </label>
        <Button className="flex-1" onClick={() => create.mutate()}>
          Code erzeugen
        </Button>
      </Card>
      {data.map((i) => (
        <Card key={i.code} className="flex items-center justify-between gap-2 p-3">
          <div className="min-w-0">
            <p className="font-mono font-black">{i.code}</p>
            <p className="text-xs font-bold text-muted">
              {i.uses}/{i.maxUses} genutzt · {fmt(i.createdAt)} {i.note ? `· ${i.note}` : ''}
            </p>
          </div>
          {i.revoked ? (
            <Pill className="bg-surface-2 text-muted">Widerrufen</Pill>
          ) : (
            <div className="flex gap-1">
              <button aria-label="Link kopieren" className="rounded-xl p-2 text-muted hover:bg-surface-2" onClick={() => void navigator.clipboard?.writeText(`${location.origin}/register?code=${i.code}`).then(() => flash('Kopiert'))}>
                <Icon name="copy" />
              </button>
              <button className="rounded-xl px-2 font-black text-error" onClick={() => revoke.mutate(i.code)}>
                Widerrufen
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function ReportsTab() {
  const qc = useQueryClient();
  const { data } = useAdmin<Report[]>('reports');
  const act = useMutation({
    mutationFn: (v: { id: number; status: string; deactivateQuestion?: boolean }) => api(`/api/admin/reports/${v.id}`, { method: 'PATCH', body: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
  });
  if (!data) return <Spinner />;
  if (!data.length) return <p className="py-10 text-center font-bold text-muted">Keine Meldungen 🎉</p>;
  return (
    <div className="space-y-3">
      {data.map(({ report: r, username, question: q, active }) => (
        <Card key={r.id} className={`p-3 ${r.status !== 'open' ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Pill className="bg-error-soft text-error">{REASON[r.reason] ?? r.reason}</Pill>
            <span className="text-xs font-bold text-muted">
              @{username ?? '?'} · {fmt(r.createdAt)} · {r.questionId}
            </span>
            {active === false && <Pill className="bg-surface-2 text-muted">deaktiviert</Pill>}
          </div>
          {r.comment && <p className="mt-2 rounded-xl bg-surface-2 p-2 text-sm font-semibold">„{r.comment}“</p>}
          {q && (
            <div className="mt-2 text-sm">
              <Markdown text={q.prompt} className="font-bold" />
              {q.slider && (
                <p className="font-black text-success">
                  ✓ {q.slider.answer} {q.slider.unit ?? ''} (± {q.slider.tolerance}, Regler {q.slider.min}–{q.slider.max}, {q.slider.scale})
                </p>
              )}
              <ul className="mt-1 space-y-0.5">
                {q.options.map((o) => (
                  <li key={o.id} className={q.correct.includes(o.id) ? 'font-black text-success' : 'text-muted'}>
                    <Markdown text={`${q.correct.includes(o.id) ? '✓' : '·'} ${o.text}`} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.status === 'open' && (
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <button className="rounded-xl border-2 border-line px-2.5 py-1 font-black" onClick={() => act.mutate({ id: r.id, status: 'dismissed' })}>
                Verwerfen
              </button>
              <button className="rounded-xl border-2 border-line px-2.5 py-1 font-black" onClick={() => act.mutate({ id: r.id, status: 'resolved' })}>
                Erledigt
              </button>
              <button className="rounded-xl border-2 border-error px-2.5 py-1 font-black text-error" onClick={() => act.mutate({ id: r.id, status: 'resolved', deactivateQuestion: true })}>
                Frage deaktivieren
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function RunsTab() {
  const { data } = useAdmin<Run[]>('runs');
  const [open, setOpen] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['admin', 'run', open], queryFn: () => api<Run & { log: string }>(`/api/admin/runs/${open}`), enabled: !!open });
  if (!data) return <Spinner />;
  return (
    <div className="space-y-2">
      {data.map((r) => (
        <Card key={r.id} className="p-3" onClick={() => setOpen(r.id)}>
          <div className="flex items-center gap-2">
            <Pill className={STATUS[r.status]}>{r.status}</Pill>
            <span className="text-sm font-black">{r.mode}</span>
            <span className="ml-auto text-xs font-bold text-muted">{fmt(r.startedAt)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs font-semibold text-muted">{r.summary?.split('\n')[1]}</p>
        </Card>
      ))}
      <Modal open={!!open} onClose={() => setOpen(null)} title={`Lauf ${open}`}>
        {detail.data ? <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-2 text-[11px] leading-snug">{detail.data.log || detail.data.summary}</pre> : <Spinner />}
      </Modal>
    </div>
  );
}

function NotesTab() {
  const qc = useQueryClient();
  const { data } = useAdmin<Note[]>('notifications');
  const read = useMutation({ mutationFn: () => api('/api/admin/notifications/read', { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }) });
  if (!data) return <Spinner />;
  return (
    <div className="space-y-2">
      {data.some((n) => !n.read) && (
        <Button variant="secondary" full onClick={() => read.mutate()}>
          Alle als gelesen markieren
        </Button>
      )}
      {!data.length && <p className="py-10 text-center font-bold text-muted">Keine Benachrichtigungen</p>}
      {data.map((n) => (
        <Card key={n.id} className={`p-3 ${n.read ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-2">
            <Pill className={n.level === 'error' ? 'bg-error-soft text-error' : n.level === 'warn' ? 'bg-gold/20 text-gold-dark' : 'bg-surface-2 text-muted'}>{n.level}</Pill>
            <span className="text-xs font-bold text-muted">{fmt(n.createdAt)}</span>
          </div>
          <p className="mt-1 font-black">{n.title}</p>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-sm font-semibold text-muted">{n.body}</pre>
        </Card>
      ))}
    </div>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };
  return (
    <Page topLeft={<Link href="/profile" className="flex items-center gap-1 text-xl font-black"><Icon name="chevronLeft" /> Admin</Link>}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Übersicht' },
          { value: 'users', label: 'Nutzer' },
          { value: 'invites', label: 'Einladungen' },
          { value: 'reports', label: 'Meldungen' },
          { value: 'runs', label: 'Läufe' },
          { value: 'notes', label: 'Hinweise' },
        ]}
      />
      <div className="mt-4">
        {tab === 'overview' && <OverviewTab flash={flash} />}
        {tab === 'users' && <UsersTab flash={flash} />}
        {tab === 'invites' && <InvitesTab flash={flash} />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'runs' && <RunsTab />}
        {tab === 'notes' && <NotesTab />}
      </div>
      <Toast message={toast} />
    </Page>
  );
}
