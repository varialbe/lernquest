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
type AdminUser = { id: number; username: string; displayName: string; role: string; disabled: boolean; unlockAll: boolean; xp: number; coins: number; streak: number; lastActiveDay: string | null };
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
  const patch = useMutation({
    mutationFn: (v: { id: number; body: Record<string, unknown> }) => api(`/api/admin/users/${v.id}`, { method: 'PATCH', body: v.body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
    onError: (e) => flash((e as Error).message),
  });
  const reset = useMutation({
    mutationFn: (u: AdminUser) => api<{ temporaryPassword: string }>(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' }).then((r) => ({ user: u.username, pw: r.temporaryPassword })),
    onSuccess: setTemp,
    onError: (e) => flash((e as Error).message),
  });
  if (!data) return <Spinner />;
  return (
    <div className="space-y-3">
      {data.map((u) => (
        <Card key={u.id} className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-black">
                {u.displayName} <span className="font-bold text-muted">@{u.username}</span>
              </p>
              <p className="text-xs font-bold text-muted">
                {u.xp} XP · {u.coins} Coins · 🔥 {u.streak} · zuletzt {u.lastActiveDay ?? '–'}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              {u.role === 'admin' && <Pill className="bg-primary-soft text-primary">Admin</Pill>}
              {u.disabled && <Pill className="bg-error-soft text-error">Gesperrt</Pill>}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <button className="rounded-xl border-2 border-line px-2.5 py-1 font-black" onClick={() => patch.mutate({ id: u.id, body: { disabled: !u.disabled } })}>
              {u.disabled ? 'Entsperren' : 'Sperren'}
            </button>
            <button className="rounded-xl border-2 border-line px-2.5 py-1 font-black" onClick={() => reset.mutate(u)}>
              Passwort zurücksetzen
            </button>
            <button className={`rounded-xl border-2 px-2.5 py-1 font-black ${u.unlockAll ? 'border-primary text-primary' : 'border-line'}`} onClick={() => patch.mutate({ id: u.id, body: { unlockAll: !u.unlockAll } })}>
              {u.unlockAll ? 'Alles frei ✓' : 'Alles freischalten'}
            </button>
          </div>
        </Card>
      ))}
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
