import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const ONLINE_WINDOW_MINUTES = 2;
let sqlClient;
let schemaPromise;

export class AnalyticsSetupError extends Error {}

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new AnalyticsSetupError('Analytics database is not configured. Set DATABASE_URL.');
  }

  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

export function ensureAnalyticsSchema() {
  if (!schemaPromise) {
    const sql = getSql();
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS harn_visitors (
          visitor_id UUID PRIMARY KEY,
          first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS harn_visitors_last_seen_idx
        ON harn_visitors (last_seen DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS harn_daily_visitors (
          visitor_id UUID NOT NULL,
          visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
          last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (visitor_id, visit_date)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS harn_admin_login_attempts (
          client_key TEXT PRIMARY KEY,
          attempts INTEGER NOT NULL DEFAULT 0,
          window_started TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          blocked_until TIMESTAMPTZ
        )
      `;
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }

  return schemaPromise;
}

export async function recordVisitorHeartbeat(visitorId) {
  await ensureAnalyticsSchema();
  const sql = getSql();
  await sql`
    INSERT INTO harn_visitors (visitor_id)
    VALUES (${visitorId}::uuid)
    ON CONFLICT (visitor_id)
    DO UPDATE SET last_seen = NOW()
  `;
  await sql`
    INSERT INTO harn_daily_visitors (visitor_id, visit_date)
    VALUES (${visitorId}::uuid, (NOW() AT TIME ZONE 'Asia/Bangkok')::date)
    ON CONFLICT (visitor_id, visit_date)
    DO UPDATE SET last_seen = NOW()
  `;
}

export async function getAnalyticsDashboard() {
  await ensureAnalyticsSchema();
  const sql = getSql();
  const [summaryRows, historyRows] = await Promise.all([
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM harn_visitors) AS total_users,
        (
          SELECT COUNT(*)::int
          FROM harn_daily_visitors
          WHERE visit_date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
        ) AS users_today,
        (
          SELECT COUNT(*)::int
          FROM harn_visitors
          WHERE last_seen >= NOW() - (${ONLINE_WINDOW_MINUTES}::int * INTERVAL '1 minute')
        ) AS online_now,
        (SELECT MAX(last_seen) FROM harn_visitors) AS last_activity
    `,
    sql`
      SELECT
        days.day::date::text AS day,
        COUNT(daily.visitor_id)::int AS users
      FROM generate_series(
        (NOW() AT TIME ZONE 'Asia/Bangkok')::date - INTERVAL '29 days',
        (NOW() AT TIME ZONE 'Asia/Bangkok')::date,
        INTERVAL '1 day'
      ) AS days(day)
      LEFT JOIN harn_daily_visitors AS daily
        ON daily.visit_date = days.day::date
      GROUP BY days.day
      ORDER BY days.day
    `,
  ]);

  const summary = summaryRows[0] || {};
  return {
    onlineNow: Number(summary.online_users ?? summary.online_now ?? 0),
    usersToday: Number(summary.users_today ?? 0),
    totalUsers: Number(summary.total_users ?? 0),
    lastActivity: summary.last_activity || null,
    onlineWindowMinutes: ONLINE_WINDOW_MINUTES,
    history: historyRows.map((row) => ({ day: row.day, users: Number(row.users) })),
  };
}

function getClientKey(clientAddress) {
  const secret = process.env.ADMIN_SESSION_SECRET || 'unconfigured';
  return createHmac('sha256', secret).update(clientAddress || 'anonymous').digest('hex');
}

export async function getLoginBlock(clientAddress) {
  await ensureAnalyticsSchema();
  const sql = getSql();
  const clientKey = getClientKey(clientAddress);
  const rows = await sql`
    SELECT blocked_until
    FROM harn_admin_login_attempts
    WHERE client_key = ${clientKey}
  `;
  const blockedUntil = rows[0]?.blocked_until ? new Date(rows[0].blocked_until) : null;
  return blockedUntil && blockedUntil > new Date() ? blockedUntil : null;
}

export async function recordFailedLogin(clientAddress) {
  await ensureAnalyticsSchema();
  const sql = getSql();
  const clientKey = getClientKey(clientAddress);
  const rows = await sql`
    INSERT INTO harn_admin_login_attempts (client_key, attempts)
    VALUES (${clientKey}, 1)
    ON CONFLICT (client_key)
    DO UPDATE SET
      attempts = CASE
        WHEN harn_admin_login_attempts.window_started < NOW() - INTERVAL '15 minutes' THEN 1
        ELSE harn_admin_login_attempts.attempts + 1
      END,
      window_started = CASE
        WHEN harn_admin_login_attempts.window_started < NOW() - INTERVAL '15 minutes' THEN NOW()
        ELSE harn_admin_login_attempts.window_started
      END,
      blocked_until = CASE
        WHEN (
          CASE
            WHEN harn_admin_login_attempts.window_started < NOW() - INTERVAL '15 minutes' THEN 1
            ELSE harn_admin_login_attempts.attempts + 1
          END
        ) >= 5 THEN NOW() + INTERVAL '15 minutes'
        ELSE NULL
      END
    RETURNING blocked_until
  `;
  return rows[0]?.blocked_until ? new Date(rows[0].blocked_until) : null;
}

export async function clearFailedLogins(clientAddress) {
  await ensureAnalyticsSchema();
  const sql = getSql();
  await sql`DELETE FROM harn_admin_login_attempts WHERE client_key = ${getClientKey(clientAddress)}`;
}
