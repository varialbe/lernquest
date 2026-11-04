import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ACHIEVEMENTS, ECONOMY, MODULE_INFO, SHOP_ITEMS, THEMES, petStage, type MeResponse } from '@lernquest/shared';
import { Icon } from '../components/icons.tsx';
import { Avatar } from '../components/Pet.tsx';
import { Page } from '../components/Shell.tsx';
import { Button, Card, Modal, ProgressBar, SectionTitle, Spinner, Toast } from '../components/ui.tsx';
import { api, assetUrl } from '../lib/api.ts';
import { APP_VERSION, isNative, localRemindersOn, rescheduleReminders, scheduleRecap, setLocalReminders } from '../lib/native.ts';
import { pushSupported, currentSubscription, enablePush, disablePush } from '../lib/push.ts';
import { useConfig, useMe, useMeMutation, useProfile } from '../lib/queries.ts';
import { ChangePassword } from './Auth.tsx';
import { moduleColor } from '../lib/theme.ts';
import { PasskeySettings } from '../components/PasskeySettings.tsx';
import { StudyBlocks } from '../components/StudyBlocks.tsx';
import { Copyright } from './Legal.tsx';
import { GOOGLE_G, startGoogle } from '../lib/google.ts';
import { formatDate, formatNumber, useLocale, useT, type LocalePreference } from '../i18n/index.tsx';
import { localizedAchievement, localizedShopItem, moduleName, themeName, translateGameText } from '../i18n/catalog.ts';

function StatBox({ img, value, label }: { img: string; value: React.ReactNode; label: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border-2 border-line bg-surface p-3">
      <img src={assetUrl(img)} alt="" className="h-8 w-8 shrink-0" />
      <div className="min-w-0">
        <p className="text-lg font-black leading-tight">{value}</p>
        <p className="text-xs font-bold leading-tight text-muted">{label}</p>
      </div>
    </div>
  );
}

function Calendar({ days }: { days: { day: string; xp: number }[] }) {
  const t = useT();
  // auf Montag ausrichten
  const first = new Date(`${days[0]!.day}T12:00:00Z`).getUTCDay();
  const pad = (first + 6) % 7;
  const cells = [...Array(pad).fill(null), ...days];
  const level = (xp: number) => (xp === 0 ? 0 : xp < 20 ? 1 : xp < 50 ? 2 : 3);
  const colors = ['var(--c-locked)', 'color-mix(in oklab, var(--c-flame) 35%, var(--c-surface))', 'color-mix(in oklab, var(--c-flame) 65%, var(--c-surface))', 'var(--c-flame)'];
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[11px] font-black text-muted">
        {(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const).map((key) => (
          <span key={key}>{t(key)}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((c, i) =>
          c ? (
            <div key={c.day} title={`${c.day}: ${c.xp} XP`} className="aspect-square rounded-lg" style={{ background: colors[level(c.xp)] }}>
              {i === cells.length - 1 && <div className="h-full w-full rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-surface" />}
            </div>
          ) : (
            <div key={`p${i}`} />
          ),
        )}
      </div>
    </div>
  );
}

/** E-Mail, Google und Newsletter im Profil */
function AccountRows({ me, row, save, flash }: { me: MeResponse; row: string; save: (b: Record<string, unknown>) => Promise<unknown>; flash: (m: string) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const s = me.settings;
  const [editMail, setEditMail] = useState(false);
  const [email, setEmail] = useState(s.email ?? '');
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['me'] });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      flash(ok);
      refresh();
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Rückkehr von Google (Verknüpfen)
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get('google') === 'linked') flash(t('Google linked ✅'));
    if (p.get('oauthError')) flash(locale === 'de' ? p.get('oauthError')! : 'Google sign-in failed. Please try again.');
    if (p.has('google') || p.has('oauthError')) history.replaceState(null, '', location.pathname);
  }, [flash]);
  const linkGoogle = () =>
    run(async () => {
      const r = await startGoogle('link');
      if (r?.status === 'error') throw new Error(locale === 'de' ? r.message : 'Google sign-in failed. Please try again.');
    }, t('Google linked ✅'));
  const toggle = 'relative h-8 w-14 shrink-0 rounded-full transition-colors';
  const knob = (on: boolean) => <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-7' : 'left-1'}`} />;
  return (
    <>
      <div className="py-3">
        <div className={`${row} py-0`}>
          <span className="font-bold">{t('Email')}</span>
          <button onClick={() => setEditMail(!editMail)} className="min-w-0 truncate text-right text-sm font-bold text-muted">
            {s.email ?? t('Add')} {s.email && (s.emailVerified ? <span className="text-success">✓</span> : <span className="text-gold-dark">({t('unverified')})</span>)}
          </button>
        </div>
        {s.email && !s.emailVerified && !editMail && (
          <button disabled={busy} onClick={() => void run(() => api('/api/auth/verify/resend', { method: 'POST' }), t('Verification email sent 📬'))} className="mt-1 text-xs font-black text-primary">
            {t('Resend verification email')}
          </button>
        )}
        {editMail && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => save({ email }).then(() => setEditMail(false)), t('Saved. Please confirm the new address by email.'));
            }}
          >
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-0 flex-1 rounded-xl border-2 border-line bg-surface-2 px-3 py-1.5 font-bold outline-none focus:border-primary" />
            <button disabled={busy} className="rounded-xl bg-primary px-3 font-black text-white">
              OK
            </button>
          </form>
        )}
      </div>

      {(cfg?.googleLogin || s.google) && (
        <div className={row}>
          <span className="flex items-center gap-2 font-bold">
            <span dangerouslySetInnerHTML={{ __html: GOOGLE_G }} /> Google
          </span>
          {s.google ? (
            <button disabled={busy} onClick={() => confirm(t('Disconnect Google account?')) && void run(() => api('/api/me/google', { method: 'DELETE' }), t('Google disconnected'))} className="text-sm font-black text-muted hover:text-error">
              {t('Linked · disconnect')}
            </button>
          ) : (
            <button disabled={busy} onClick={() => void linkGoogle()} className="rounded-xl border-2 border-primary px-2.5 py-1 text-sm font-black text-primary">
              {t('Connect')}
            </button>
          )}
        </div>
      )}

      <div className="py-3">
        <div className={`${row} py-0`}>
          <span className="font-bold">{t('Newsletter')}</span>
          <button
            role="switch"
            aria-checked={s.newsletter !== 'none'}
            disabled={busy}
            onClick={() =>
              s.newsletter !== 'none'
                ? void run(() => save({ newsletter: false }), t('Unsubscribe from newsletter'))
                : s.email
                  ? void run(() => save({ newsletter: true }), t('Almost done — confirm the email in your inbox 📬'))
                  : (setEditMail(true), flash(t('Add an email address first')))
            }
            className={`${toggle} ${s.newsletter !== 'none' ? 'bg-primary' : 'bg-line-strong'}`}
          >
            {knob(s.newsletter !== 'none')}
          </button>
        </div>
        {s.newsletter === 'pending' && <p className="mt-1 text-xs font-semibold text-gold-dark">{t('Waiting for confirmation — check your inbox.')}</p>}
        {s.newsletter === 'confirmed' && <p className="mt-1 text-xs font-semibold text-muted">{t('Confirmed · sent to {email}', { email: s.email ?? '' })}</p>}
      </div>
    </>
  );
}

function Settings({ me, onLogout, onLogin }: { me: MeResponse; onLogout: () => void; onLogin: (t: string) => void }) {
  const { preference, setPreference, locale } = useLocale();
  const t = useT();
  const save = useMeMutation((body: Record<string, unknown>) => api<MeResponse>('/api/me/settings', { method: 'PATCH', body }));
  const { data: cfg } = useConfig();
  const [push, setPush] = useState<boolean | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (isNative) setPush(localRemindersOn());
    else void currentSubscription().then((s) => setPush(!!s));
  }, []);
  // iOS-App: lokale Mitteilungen (kein Apple-Push nötig); Browser/PWA: Web-Push
  const canRemind = isNative || (pushSupported() && !!cfg?.vapidPublicKey);
  const themes = ['default', ...me.inventory.filter((i) => i.startsWith('theme:')).map((i) => i.slice(6))];
  const frames = me.inventory.filter((i) => i.startsWith('frame:')).map((i) => i.slice(6));
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };
  const row = 'flex items-center justify-between gap-3 py-3';
  return (
    <Card className="divide-y-2 divide-line py-1">
      <div className={row}>
        <span className="font-bold">{t('Daily goal')}</span>
        <div className="flex gap-1.5">
          {ECONOMY.dailyGoalOptions.map((g) => (
            <button key={g} onClick={() => save.mutate({ dailyGoal: g })} className={`rounded-xl border-2 px-2.5 py-1 text-sm font-black ${me.stats.dailyGoal === g ? 'border-primary bg-primary text-white' : 'border-line'}`}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className={row}>
        <label htmlFor="locale-preference" className="font-bold">{t('Language')}</label>
        <select
          id="locale-preference"
          value={preference}
          disabled={save.isPending}
          onChange={async (event) => {
            const next = event.target.value as LocalePreference;
            const previous = preference;
            setPreference(next);
            try {
              await save.mutateAsync({ locale: next === 'auto' ? null : next });
            } catch (error) {
              setPreference(previous);
              flash((error as Error).message);
            }
          }}
          className="rounded-xl border-2 border-line bg-surface px-3 py-1.5 font-bold"
        >
          <option value="auto">{t('Automatic')}</option>
          <option value="de">{t('German')}</option>
          <option value="en">{t('English')}</option>
        </select>
      </div>
      <div className={row}>
        <span className="font-bold">{t('Color theme')}</span>
        <div className="flex gap-2">
          {themes.map((t) => (
            <button key={t} aria-label={themeName(t, locale)} onClick={() => save.mutate({ theme: t })} className={`h-8 w-8 rounded-full border-4 ${me.settings.theme === t ? 'border-ink' : 'border-transparent'}`} style={{ background: THEMES[t]?.primary }} />
          ))}
        </div>
      </div>
      {frames.length > 0 && (
        <div className={row}>
          <span className="font-bold">{t('Profile frame')}</span>
          <div className="flex gap-1.5">
            <button onClick={() => save.mutate({ frame: null })} className={`rounded-xl border-2 px-2 py-1 text-xs font-black ${!me.settings.frame ? 'border-primary' : 'border-line'}`}>
              {t('None')}
            </button>
            {frames.map((f) => (
              <button key={f} onClick={() => save.mutate({ frame: f })} className={`rounded-xl border-2 px-2 py-1 text-xs font-black ${me.settings.frame === f ? 'border-primary' : 'border-line'}`}>
                {localizedShopItem(`frame:${f}`, locale)?.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={row}>
        <span className="font-bold">{t('Sounds')}</span>
        <button role="switch" aria-checked={me.settings.soundOn} onClick={() => save.mutate({ soundOn: !me.settings.soundOn })} className={`relative h-8 w-14 rounded-full transition-colors ${me.settings.soundOn ? 'bg-success' : 'bg-locked'}`}>
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${me.settings.soundOn ? 'left-7' : 'left-1'}`} />
        </button>
      </div>
      <div className={row}>
        <div>
          <span className="font-bold">{t('Notifications')}</span>
          <p className="text-xs font-semibold text-muted">{isNative || pushSupported() ? t('Notifications description') : t('Add to Home Screen on iPhone')}</p>
        </div>
        <button
          role="switch"
          aria-checked={!!push}
          disabled={!canRemind || push === null}
          onClick={async () => {
            try {
              if (isNative) {
                await setLocalReminders(!push);
                if (!push) await rescheduleReminders(me.stats);
                await scheduleRecap(!push && me.settings.weeklyRecap, true);
              } else if (push) await disablePush();
              else await enablePush(cfg!.vapidPublicKey!);
              setPush(!push);
              flash(push ? t('Reminder off') : t('Reminder on 🔔'));
            } catch (e) {
              flash((e as Error).message);
            }
          }}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-40 ${push ? 'bg-success' : 'bg-locked'}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${push ? 'left-7' : 'left-1'}`} />
        </button>
      </div>
      {push && (
        <div className={row}>
          <div>
            <span className="font-bold">{t('Weekly recap')}</span>
            <p className="text-xs font-semibold text-muted">{t('Sunday at 6 pm: XP, accuracy, weak concepts and due reviews')}</p>
          </div>
          <button
            role="switch"
            aria-checked={me.settings.weeklyRecap}
            onClick={async () => {
              const on = !me.settings.weeklyRecap;
              await save.mutateAsync({ weeklyRecap: on });
              if (isNative) await scheduleRecap(on, true).catch(() => {});
              flash(on ? t('Weekly recap on 📊') : t('Weekly recap off'));
            }}
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${me.settings.weeklyRecap ? 'bg-success' : 'bg-locked'}`}
          >
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${me.settings.weeklyRecap ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      )}
      <div className={row}>
        <span className="font-bold">{t('App version')}</span>
        <span className="font-mono text-xs font-bold text-muted">{APP_VERSION}</span>
      </div>
      <AccountRows me={me} row={row} save={(b) => save.mutateAsync(b)} flash={flash} />
      <PasskeySettings row={row} flash={flash} />
      <button className={`${row} w-full font-bold`} onClick={() => setPwOpen(true)}>
        {me.settings.hasPassword ? t('Change password') : t('Set password')} <Icon name="chevronRight" className="text-muted" />
      </button>
      {me.user.role === 'admin' && (
        <Link href="/admin" className={`${row} font-bold text-primary`}>
          {t('Admin area')} <Icon name="chevronRight" />
        </Link>
      )}
      <button className={`${row} w-full font-bold text-error`} onClick={() => void api('/api/auth/logout', { method: 'POST' }).finally(onLogout)}>
        {t('Sign out')} <Icon name="logout" />
      </button>
      <Copyright className="pt-3" />
      <Modal open={pwOpen} onClose={() => setPwOpen(false)}>
        <div className="-mx-5 -mb-6 max-h-[80dvh] overflow-y-auto">
          <ChangePassword
            username={me.user.username}
            forced={!me.settings.hasPassword}
            onDone={(t) => {
              setPwOpen(false);
              onLogin(t);
            }}
          />
        </div>
      </Modal>
      <Toast message={toast} />
    </Card>
  );
}

export default function Profile({ username, onLogout, onLogin }: { username?: string; onLogout: () => void; onLogin: (t: string) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { data: p, isLoading } = useProfile(username ?? 'me');
  const { data: me } = useMe();
  if (isLoading || !p || !me) return <Spinner />;
  const isMe = !username || username === me.user.username;
  const pets = isMe ? me.pets : [];
  const activePet = isMe ? me.settings.activePet : null;
  const stage = activePet ? petStage(pets.find((x) => x.petId === activePet)?.xp ?? 0) : 1;
  const unlocked = p.achievements.filter((a) => a.unlocked).length;

  return (
    <Page topLeft={username ? <Link href="/league" className="flex items-center gap-1 font-black text-muted"><Icon name="chevronLeft" /> {t('Back')}</Link> : <h1 className="text-xl font-black">{t('Profile')}</h1>}>
      <div className="flex items-center gap-4">
        <Avatar pet={activePet} petStage={stage} frame={isMe ? me.settings.frame : null} size={92} name={p.user.displayName} />
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-black">{p.user.displayName}</h2>
          <p className="font-bold text-muted">@{p.user.username}</p>
          <p className="text-sm font-semibold text-muted">{t('Joined {date}', { date: formatDate(p.joinedAt, { month: 'long', year: 'numeric' }, locale) })}</p>
        </div>
      </div>

      <SectionTitle>{t('Statistics')}</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <StatBox img="item-flame" value={p.stats.streak} label={t('day streak · record {days}', { days: p.stats.longestStreak })} />
        <StatBox img="item-xp" value={formatNumber(p.stats.xp, locale)} label={t('Total XP')} />
        <StatBox img="badge-first" value={formatNumber(p.stats.levelsDone, locale)} label={t('levels · {count} perfect', { count: p.stats.perfectLevels })} />
        <StatBox img="badge-perfect" value={`${Math.round(p.stats.accuracy * 100)} %`} label={t('Accuracy · {count} answers', { count: p.stats.questionsAnswered })} />
        <StatBox img="badge-xp" value={translateGameText(p.stats.league, locale)} label={t('League · {xp} XP this week', { xp: p.stats.weekXp })} />
        <StatBox img="item-streak_freeze" value={p.stats.streakFreezes} label={t('Streak freezes')} />
      </div>

      {isMe && <StudyBlocks />}

      <SectionTitle>{t('Streak calendar')}</SectionTitle>
      <Card>
        <Calendar days={p.calendar} />
      </Card>

      <SectionTitle>{t('Modules')}</SectionTitle>
      <Card className="space-y-3">
        {p.moduleProgress.map((m) => (
          <div key={m.module}>
            <div className="mb-1 flex justify-between text-sm font-black">
              <span className="min-w-0 flex-1">{moduleName(m.module, locale)}</span>
              <span className="text-muted">
                {m.done}/{m.total}
              </span>
            </div>
            <ProgressBar value={m.total ? m.done / m.total : 0} color={moduleColor(m.module)} height={12} />
          </div>
        ))}
      </Card>

      <SectionTitle action={<span className="text-sm font-black text-muted">{unlocked}/{p.achievements.length}</span>}>{t('Achievements')}</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        {ACHIEVEMENTS.map((sourceAchievement) => {
          const a = localizedAchievement(sourceAchievement.id, locale) ?? sourceAchievement;
          const ok = p.achievements.find((x) => x.id === a.id)?.unlocked;
          return (
            <div key={a.id} className={`flex flex-col items-center rounded-2xl border-2 bg-surface p-2.5 text-center ${ok ? 'border-gold/60' : 'border-line'}`} title={a.description}>
              <img src={assetUrl(a.icon)} alt="" className={`h-14 w-14 ${ok ? '' : 'opacity-35 grayscale'}`} />
              <p className="mt-1 text-xs font-black leading-tight">{a.name}</p>
            </div>
          );
        })}
      </div>

      {isMe && (
        <>
          <SectionTitle>{t('Profile settings')}</SectionTitle>
          <Settings me={me} onLogout={onLogout} onLogin={onLogin} />
        </>
      )}
      {!isMe && (
        <Button full variant="secondary" className="mt-6" onClick={() => history.back()}>
          {t('Back')}
        </Button>
      )}
    </Page>
  );
}
