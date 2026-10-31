import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { Spinner } from './components/ui.tsx';
import { getToken, setToken, setUnauthorizedHandler } from './lib/api.ts';
import { flushPending } from './lib/offline.ts';
import { useMe } from './lib/queries.ts';
import { setMuted } from './lib/sound.ts';
import { ChangePassword, Login, Register } from './pages/Auth.tsx';
import { Home } from './pages/Home.tsx';
import { Quiz } from './pages/Quiz.tsx';

const League = lazy(() => import('./pages/League.tsx'));
const Pets = lazy(() => import('./pages/Pets.tsx'));
const Praxis = lazy(() => import('./pages/Praxis.tsx'));
const Shop = lazy(() => import('./pages/Shop.tsx'));
const Profile = lazy(() => import('./pages/Profile.tsx'));
const Admin = lazy(() => import('./pages/Admin.tsx'));

export function App() {
  const [token, setTok] = useState(getToken());
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const login = (t: string) => {
    setToken(t);
    setTok(t);
    qc.clear();
    navigate('/');
  };
  const logout = () => {
    setToken(null);
    setTok(null);
    qc.clear();
    navigate('/login');
  };

  useEffect(() => setUnauthorizedHandler(logout), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Offline-Abschlüsse nachreichen
  useEffect(() => {
    const flush = () =>
      void flushPending().then((n) => {
        if (n) void qc.invalidateQueries();
      });
    flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [qc]);

  if (!token) {
    return (
      <Switch>
        <Route path="/register">
          <Register onLogin={login} />
        </Route>
        <Route>
          <Login onLogin={login} />
        </Route>
      </Switch>
    );
  }
  return <Authed onLogin={login} onLogout={logout} />;
}

function Authed({ onLogin, onLogout }: { onLogin: (t: string) => void; onLogout: () => void }) {
  const { data: me, isLoading, error } = useMe();

  useEffect(() => {
    if (!me) return;
    document.documentElement.dataset.theme = me.settings.theme;
    setMuted(!me.settings.soundOn);
  }, [me]);

  if (isLoading) return <Spinner label="Lade …" />;
  if (error && !me) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-bold text-muted">{(error as Error).message}</p>
        <button className="font-black text-primary" onClick={() => location.reload()}>
          Erneut versuchen
        </button>
      </div>
    );
  }
  if (me?.user.mustChangePassword) return <ChangePassword forced onDone={onLogin} />;

  return (
    <Suspense fallback={<Spinner />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/level/:id">{(p) => <Quiz key={p.id} levelId={p.id} />}</Route>
        <Route path="/practice">
          <Quiz key="practice" practice />
        </Route>
        <Route path="/praxis" component={Praxis} />
        <Route path="/league" component={League} />
        <Route path="/pets" component={Pets} />
        <Route path="/shop" component={Shop} />
        <Route path="/profile">
          <Profile onLogout={onLogout} onLogin={onLogin} />
        </Route>
        <Route path="/u/:username">{(p) => <Profile username={p.username} onLogout={onLogout} onLogin={onLogin} />}</Route>
        <Route path="/admin">{me?.user.role === 'admin' ? <Admin /> : <Redirect to="/" />}</Route>
        <Route path="/login">
          <Redirect to="/" />
        </Route>
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </Suspense>
  );
}
