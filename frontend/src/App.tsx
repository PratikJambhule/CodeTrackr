import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useMe } from './hooks/queries';
import { AppShell } from './components/layout/AppShell';
import { PublicLayout } from './components/layout/PublicLayout';
import { Button, Logo } from './components/ui';
import { readSession, writeSession } from './lib/storage';

// Each page is its own chunk, so the landing page does not download the dashboard.
const Landing = lazy(() => import('./pages/public/Landing'));
const Guide = lazy(() => import('./pages/public/Guide'));
const Privacy = lazy(() => import('./pages/public/Privacy'));
const Login = lazy(() => import('./pages/public/Login'));
const NotFound = lazy(() => import('./pages/public/NotFound'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Groups = lazy(() => import('./pages/Groups'));
const GroupBoard = lazy(() => import('./pages/GroupBoard'));
const JoinGroup = lazy(() => import('./pages/JoinGroup'));
const Goals = lazy(() => import('./pages/Goals'));
const Insights = lazy(() => import('./pages/Insights'));
const Profile = lazy(() => import('./pages/Profile'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Device = lazy(() => import('./pages/Device'));

/** Pages that need a signed-in user. Visiting one signed out goes to sign-in and comes back. */
const PROTECTED = ['/dashboard', '/leaderboard', '/groups', '/groups/:groupId', '/goals', '/insights', '/profile', '/onboarding', '/device', '/join/:groupId'];

const AFTER_LOGIN = 'codetrackr.afterLogin';

function RememberThenLogin() {
  const location = useLocation();
  writeSession(AFTER_LOGIN, location.pathname + location.search);
  return <Navigate to="/login" replace />;
}

/** After Google sign-in the API lands on /dashboard; resume an invite link or device code instead. */
function ResumeAfterLogin() {
  const navigate = useNavigate();
  useEffect(() => {
    const target = readSession(AFTER_LOGIN);
    writeSession(AFTER_LOGIN, null);
    if (target && target.startsWith('/') && !target.startsWith('//')) navigate(target, { replace: true });
  }, [navigate]);
  return null;
}

/** True once `pending` has lasted longer than `ms`: the free server is probably waking up. */
function useSlow(pending: boolean, ms = 2500) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(t);
  }, [pending, ms]);
  return slow;
}

function Splash({ slow, failed, onRetry }: { slow: boolean; failed?: boolean; onRetry?: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-bg px-6 text-center">
      <Logo size={44} />
      {failed ? (
        <>
          <p role="alert" className="max-w-sm text-muted">
            Could not reach the server. It may be waking up after being idle, which takes about 20 seconds.
          </p>
          <Button onClick={onRetry}>Try again</Button>
        </>
      ) : (
        <p aria-live="polite" className="max-w-sm text-muted">
          {slow ? 'Waking up the server. The free hosting sleeps when idle; this takes about 20 seconds the first time.' : 'Loading…'}
        </p>
      )}
    </div>
  );
}

export default function App() {
  const me = useMe();
  const user = me.data ?? null;
  const slow = useSlow(me.isPending);

  return (
    <>
      {user && <ResumeAfterLogin />}
      <Suspense fallback={<Splash slow={false} />}>
        <Routes>
          <Route element={<PublicLayout user={user} />}>
            <Route path="/" element={<Landing />} />
            <Route path="/guide" element={<Guide />} />
            <Route path="/privacy" element={<Privacy />} />
          </Route>
          <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />

          {user ? (
            <Route element={<AppShell user={user} />}>
              <Route path="/dashboard" element={<Dashboard user={user} />} />
              <Route path="/leaderboard" element={<Leaderboard user={user} />} />
              <Route path="/groups" element={<Groups />} />
              <Route path="/groups/:groupId" element={<GroupBoard user={user} />} />
              <Route path="/join/:groupId" element={<JoinGroup />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/profile" element={<Profile user={user} />} />
              <Route path="/onboarding" element={<Onboarding user={user} />} />
              <Route path="/device" element={<Device />} />
            </Route>
          ) : (
            PROTECTED.map((path) => (
              <Route
                key={path}
                path={path}
                element={me.isPending ? <Splash slow={slow} /> : me.isError ? <Splash slow={false} failed onRetry={() => me.refetch()} /> : <RememberThenLogin />}
              />
            ))
          )}

          <Route element={<PublicLayout user={user} />}>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
