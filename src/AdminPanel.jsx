import { useCallback, useEffect, useMemo, useState } from 'react';
import DoodleField from './DecorativeDoodles';
import './admin.css';

function formatDate(day) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
    .format(new Date(`${day}T00:00:00`));
}

function formatTimestamp(value) {
  if (!value) return 'No activity yet';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'Something went wrong.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export default function AdminPanel() {
  const [view, setView] = useState('loading');
  const [password, setPassword] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const loadDashboard = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setError('');
    try {
      const response = await fetch('/api/admin-dashboard', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const data = await readJson(response);
      setDashboard(data);
      setLastRefreshed(new Date());
      setView('dashboard');
    } catch (loadError) {
      if (loadError.status === 401) {
        setDashboard(null);
        setView('login');
      } else {
        setError(loadError.message);
        if (!quiet) setView((current) => (current === 'loading' ? 'login' : current));
      }
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (view !== 'dashboard') return undefined;
    const intervalId = window.setInterval(() => loadDashboard({ quiet: true }), 30_000);
    return () => window.clearInterval(intervalId);
  }, [loadDashboard, view]);

  const maxHistoryUsers = useMemo(
    () => Math.max(1, ...(dashboard?.history || []).map((entry) => entry.users)),
    [dashboard],
  );

  const handleLogin = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin-login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      await readJson(response);
      setPassword('');
      await loadDashboard();
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/admin-logout', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => {});
    setDashboard(null);
    setView('login');
  };

  if (view === 'loading') {
    return (
      <main className="admin-shell admin-centered">
        <DoodleField variant="admin" className="admin-doodles" />
        <div className="admin-loader" aria-label="Loading admin dashboard" />
      </main>
    );
  }

  if (view === 'login') {
    return (
      <main className="admin-shell admin-centered">
        <DoodleField variant="admin" className="admin-doodles" />
        <section className="admin-login-card" aria-labelledby="admin-login-title">
          <a className="admin-brand" href="/" aria-label="Back to Harn Kun">
            <img src="/icon.png" alt="" />
            <span>Harn Kun</span>
          </a>
          <p className="admin-eyebrow">Private analytics</p>
          <h1 id="admin-login-title">Admin sign in</h1>
          <p className="admin-intro">Something not Spacial.</p>
          <form onSubmit={handleLogin}>
            <label htmlFor="admin-password">Admin password</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
            {error && <p className="admin-error" role="alert">{error}</p>}
            <button type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <a className="admin-back-link" href="/">← Back to the app</a>
        </section>
      </main>
    );
  }

  const history = dashboard?.history || [];
  return (
    <main className="admin-shell">
      <DoodleField variant="admin" className="admin-doodles" />
      <header className="admin-header">
        <div>
          <a className="admin-brand" href="/">
            <img src="/icon.png" alt="" />
            <span>Harn Kun</span>
          </a>
          <p className="admin-eyebrow">Private analytics</p>
          <h1>Usage dashboard</h1>
        </div>
        <div className="admin-actions">
          <button className="admin-secondary-button" type="button" onClick={() => loadDashboard()}>
            Refresh
          </button>
          <button className="admin-secondary-button" type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      {error && <p className="admin-page-error" role="alert">{error}</p>}

      <section className="admin-metrics" aria-label="Usage summary">
        <article className="admin-metric admin-online">
          <span><i /> Online now</span>
          <strong>{dashboard.onlineNow.toLocaleString()}</strong>
          <small>Active in the last {dashboard.onlineWindowMinutes} minutes</small>
        </article>
        <article className="admin-metric">
          <span>Users today</span>
          <strong>{dashboard.usersToday.toLocaleString()}</strong>
          <small>Unique browsers today</small>
        </article>
        <article className="admin-metric">
          <span>All-time users</span>
          <strong>{dashboard.totalUsers.toLocaleString()}</strong>
          <small>Unique browsers recorded</small>
        </article>
      </section>

      <section className="admin-history-card" aria-labelledby="usage-history-title">
        <div className="admin-section-heading">
          <div>
            <p className="admin-eyebrow">Last 30 days</p>
            <h2 id="usage-history-title">Daily users</h2>
          </div>
          <span>Last activity: {formatTimestamp(dashboard.lastActivity)}</span>
        </div>

        <div className="admin-chart" role="img" aria-label="Daily unique browser chart for the last 30 days">
          {history.map((entry) => (
            <div className="admin-chart-column" key={entry.day} title={`${formatDate(entry.day)}: ${entry.users} users`}>
              <strong>{entry.users || ''}</strong>
              <div className="admin-chart-track">
                <i style={{ height: `${Math.max(entry.users ? 8 : 2, (entry.users / maxHistoryUsers) * 100)}%` }} />
              </div>
              <span>{formatDate(entry.day)}</span>
            </div>
          ))}
        </div>

        <div className="admin-history-table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Unique browsers</th></tr></thead>
            <tbody>
              {[...history].reverse().map((entry) => (
                <tr key={entry.day}>
                  <td>{formatDate(entry.day)}</td>
                  <td>{entry.users.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="admin-footer">
        <span>Counts are anonymous browser estimates.</span>
        <span>{lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString()}` : ''}</span>
      </footer>
    </main>
  );
}
