import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const ONLINE_WINDOW_MINUTES = 2;
const VISITOR_RETENTION_DAYS = 30;
let sqlClient;

export class AnalyticsSetupError extends Error {}

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new AnalyticsSetupError('Analytics database is not configured. Set DATABASE_URL.');
  }
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

export function parseDeviceDetails(userAgent = '') {
  const agent = String(userAgent);
  const deviceType = /iPad|Tablet|PlayBook|Silk/i.test(agent) || (/Android/i.test(agent) && !/Mobile/i.test(agent))
    ? 'tablet'
    : /Mobile|iPhone|iPod|Android/i.test(agent) ? 'mobile' : 'desktop';
  const browser = /Edg\//i.test(agent) ? 'Edge'
    : /OPR\//i.test(agent) ? 'Opera'
      : /SamsungBrowser\//i.test(agent) ? 'Samsung Internet'
        : /Firefox\//i.test(agent) ? 'Firefox'
          : /Chrome\//i.test(agent) && !/Edg\//i.test(agent) ? 'Chrome'
            : /Safari\//i.test(agent) && !/Chrome\//i.test(agent) ? 'Safari' : 'Other';
  return { deviceType, browser };
}

export function createAnalyticsRepository(getSqlClient = getSql) {
  let schemaPromise;

  async function ensureAnalyticsSchema() {
    if (!schemaPromise) {
      const sql = getSqlClient();
      schemaPromise = (async () => {
        await sql`
          CREATE TABLE IF NOT EXISTS harn_analytics_daily (
            visit_date DATE PRIMARY KEY,
            unique_visitors BIGINT NOT NULL DEFAULT 0,
            completed_bills BIGINT NOT NULL DEFAULT 0,
            spend_satang BIGINT NOT NULL DEFAULT 0,
            last_activity TIMESTAMPTZ
          )
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS harn_analytics_visitors (
            visitor_id UUID PRIMARY KEY,
            device_type TEXT NOT NULL CHECK (device_type IN ('mobile', 'tablet', 'desktop')),
            browser TEXT NOT NULL CHECK (browser IN ('Chrome', 'Safari', 'Firefox', 'Edge', 'Opera', 'Samsung Internet', 'Other')),
            first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `;
        await sql`
          CREATE INDEX IF NOT EXISTS harn_analytics_visitors_last_seen_idx
          ON harn_analytics_visitors (last_seen DESC)
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS harn_analytics_visitor_days (
            visitor_id UUID NOT NULL REFERENCES harn_analytics_visitors(visitor_id) ON DELETE CASCADE,
            visit_date DATE NOT NULL,
            PRIMARY KEY (visitor_id, visit_date)
          )
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS harn_analytics_bills (
            visitor_id UUID NOT NULL REFERENCES harn_analytics_visitors(visitor_id) ON DELETE CASCADE,
            history_id TEXT NOT NULL,
            total_satang BIGINT NOT NULL CHECK (total_satang >= 0),
            participant_count SMALLINT NOT NULL CHECK (participant_count BETWEEN 2 AND 100),
            items JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (visitor_id, history_id)
          )
        `;
        await sql`
          CREATE INDEX IF NOT EXISTS harn_analytics_bills_updated_idx
          ON harn_analytics_bills (updated_at DESC, visitor_id DESC, history_id DESC)
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS harn_admin_login_attempts (
            client_key TEXT PRIMARY KEY,
            attempts INTEGER NOT NULL DEFAULT 0,
            window_started TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            blocked_until TIMESTAMPTZ
          )
        `;
        await sql`
          CREATE OR REPLACE FUNCTION harn_track_analytics_bill() RETURNS TRIGGER AS $$
          DECLARE
            old_day DATE;
            new_day DATE;
          BEGIN
            new_day := (NEW.updated_at AT TIME ZONE 'Asia/Bangkok')::date;
            IF TG_OP = 'INSERT' THEN
              INSERT INTO harn_analytics_daily (visit_date, completed_bills, spend_satang, last_activity)
              VALUES (new_day, 1, NEW.total_satang, NEW.updated_at)
              ON CONFLICT (visit_date) DO UPDATE SET
                completed_bills = harn_analytics_daily.completed_bills + 1,
                spend_satang = harn_analytics_daily.spend_satang + NEW.total_satang,
                last_activity = GREATEST(harn_analytics_daily.last_activity, NEW.updated_at);
            ELSE
              old_day := (OLD.updated_at AT TIME ZONE 'Asia/Bangkok')::date;
              IF old_day = new_day THEN
                UPDATE harn_analytics_daily
                SET spend_satang = GREATEST(0, spend_satang + NEW.total_satang - OLD.total_satang),
                    last_activity = GREATEST(last_activity, NEW.updated_at)
                WHERE visit_date = new_day;
              ELSE
                UPDATE harn_analytics_daily
                SET completed_bills = GREATEST(0, completed_bills - 1),
                    spend_satang = GREATEST(0, spend_satang - OLD.total_satang)
                WHERE visit_date = old_day;
                INSERT INTO harn_analytics_daily (visit_date, completed_bills, spend_satang, last_activity)
                VALUES (new_day, 1, NEW.total_satang, NEW.updated_at)
                ON CONFLICT (visit_date) DO UPDATE SET
                  completed_bills = harn_analytics_daily.completed_bills + 1,
                  spend_satang = harn_analytics_daily.spend_satang + NEW.total_satang,
                  last_activity = GREATEST(harn_analytics_daily.last_activity, NEW.updated_at);
              END IF;
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql
        `;
        await sql`
          DO $trigger$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'harn_analytics_bill_after_change') THEN
              EXECUTE 'CREATE TRIGGER harn_analytics_bill_after_change
              AFTER INSERT OR UPDATE ON harn_analytics_bills
              FOR EACH ROW EXECUTE FUNCTION harn_track_analytics_bill()';
            END IF;
          END;
          $trigger$
        `;

        // Preserve historical daily counts as anonymous totals, then discard legacy visitor IDs.
        await sql`
          DO $migration$
          BEGIN
            PERFORM pg_advisory_xact_lock(186425101);
            IF to_regclass('public.harn_daily_visitors') IS NOT NULL THEN
              EXECUTE 'INSERT INTO harn_analytics_daily (visit_date, unique_visitors, last_activity)
                SELECT visit_date, COUNT(*)::bigint, MAX(last_seen)
                FROM harn_daily_visitors GROUP BY visit_date
                ON CONFLICT (visit_date) DO UPDATE SET
                  unique_visitors = GREATEST(harn_analytics_daily.unique_visitors, EXCLUDED.unique_visitors),
                  last_activity = GREATEST(harn_analytics_daily.last_activity, EXCLUDED.last_activity)';
            END IF;
            DROP TABLE IF EXISTS harn_daily_visitors;
            DROP TABLE IF EXISTS harn_visitors;
          END;
          $migration$
        `;
      })().catch((error) => {
        schemaPromise = undefined;
        throw error;
      });
    }
    return schemaPromise;
  }

  async function recordVisitorHeartbeat(visitorId, { deviceType, browser }) {
    await ensureAnalyticsSchema();
    const sql = getSqlClient();
    await sql`
      WITH visitor AS (
        INSERT INTO harn_analytics_visitors (visitor_id, device_type, browser)
        VALUES (${visitorId}::uuid, ${deviceType}, ${browser})
        ON CONFLICT (visitor_id) DO UPDATE SET
          device_type = EXCLUDED.device_type,
          browser = EXCLUDED.browser,
          last_seen = NOW()
        RETURNING visitor_id
      ), first_daily_visit AS (
        INSERT INTO harn_analytics_visitor_days (visitor_id, visit_date)
        SELECT visitor_id, (NOW() AT TIME ZONE 'Asia/Bangkok')::date FROM visitor
        ON CONFLICT DO NOTHING
        RETURNING visitor_id
      )
      INSERT INTO harn_analytics_daily (visit_date, unique_visitors, completed_bills, spend_satang, last_activity)
      SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date, COUNT(*)::bigint, 0, 0, NOW()
      FROM first_daily_visit
      ON CONFLICT (visit_date) DO UPDATE SET
        unique_visitors = harn_analytics_daily.unique_visitors + EXCLUDED.unique_visitors,
        last_activity = GREATEST(harn_analytics_daily.last_activity, EXCLUDED.last_activity)
    `;
  }

  async function recordCompletedBill(visitorId, { historyId, totalSatang, participantCount, items }) {
    await ensureAnalyticsSchema();
    const sql = getSqlClient();
    await sql`
      INSERT INTO harn_analytics_bills
        (visitor_id, history_id, total_satang, participant_count, items, created_at, updated_at)
      VALUES
        (${visitorId}::uuid, ${historyId}, ${totalSatang}, ${participantCount}, ${JSON.stringify(items)}::jsonb, NOW(), NOW())
      ON CONFLICT (visitor_id, history_id) DO UPDATE SET
        total_satang = EXCLUDED.total_satang,
        participant_count = EXCLUDED.participant_count,
        items = EXCLUDED.items,
        updated_at = NOW()
    `;
  }

  async function revokeVisitorAnalytics(visitorId) {
    await ensureAnalyticsSchema();
    if (!visitorId) return;
    const sql = getSqlClient();
    await sql`DELETE FROM harn_analytics_visitors WHERE visitor_id = ${visitorId}::uuid`;
  }

  async function cleanupAnalyticsData() {
    await ensureAnalyticsSchema();
    const sql = getSqlClient();
    await sql.transaction([
      sql`DELETE FROM harn_analytics_bills WHERE updated_at < NOW() - (${VISITOR_RETENTION_DAYS}::int * INTERVAL '1 day')`,
      sql`DELETE FROM harn_analytics_visitor_days WHERE visit_date < (NOW() AT TIME ZONE 'Asia/Bangkok')::date - ${VISITOR_RETENTION_DAYS}::int`,
      sql`DELETE FROM harn_analytics_visitors WHERE last_seen < NOW() - (${VISITOR_RETENTION_DAYS}::int * INTERVAL '1 day')`,
    ]);
  }

  async function getAnalyticsDashboard() {
    await ensureAnalyticsSchema();
    const sql = getSqlClient();
    const [summaryRows, historyRows] = await Promise.all([
      sql`
        SELECT
          COALESCE((SELECT unique_visitors FROM harn_analytics_daily WHERE visit_date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date), 0)::bigint AS visitors_today,
          COALESCE((SELECT SUM(unique_visitors) FROM harn_analytics_daily), 0)::bigint AS visit_days,
          (SELECT COUNT(*)::int FROM harn_analytics_visitors WHERE last_seen >= NOW() - (${ONLINE_WINDOW_MINUTES}::int * INTERVAL '1 minute')) AS online_now,
          (SELECT MAX(last_activity) FROM harn_analytics_daily) AS last_activity,
          COALESCE((SELECT SUM(completed_bills) FROM harn_analytics_daily), 0)::bigint AS completed_bills,
          COALESCE((SELECT SUM(spend_satang) FROM harn_analytics_daily), 0)::bigint AS spend_satang
      `,
      sql`
        SELECT days.day::date::text AS day,
          COALESCE(daily.unique_visitors, 0)::bigint AS visitors,
          COALESCE(daily.completed_bills, 0)::bigint AS bills,
          COALESCE(daily.spend_satang, 0)::bigint AS spend_satang
        FROM generate_series(
          (NOW() AT TIME ZONE 'Asia/Bangkok')::date - INTERVAL '29 days',
          (NOW() AT TIME ZONE 'Asia/Bangkok')::date,
          INTERVAL '1 day'
        ) AS days(day)
        LEFT JOIN harn_analytics_daily AS daily ON daily.visit_date = days.day::date
        ORDER BY days.day
      `,
    ]);
    const summary = summaryRows[0] || {};
    return {
      onlineNow: Number(summary.online_now ?? 0),
      visitorsToday: Number(summary.visitors_today ?? 0),
      visitDays: Number(summary.visit_days ?? 0),
      completedBills: Number(summary.completed_bills ?? 0),
      totalSpend: Number(summary.spend_satang ?? 0) / 100,
      lastActivity: summary.last_activity || null,
      onlineWindowMinutes: ONLINE_WINDOW_MINUTES,
      history: historyRows.map((row) => ({
        day: row.day,
        visitors: Number(row.visitors),
        bills: Number(row.bills),
        spend: Number(row.spend_satang) / 100,
      })),
    };
  }

  async function getAnalyticsBills(cursor) {
    await ensureAnalyticsSchema();
    const sql = getSqlClient();
    const rows = await sql`
      SELECT b.history_id, b.updated_at, b.total_satang, b.participant_count, b.items,
        v.device_type, v.browser, v.visitor_id
      FROM harn_analytics_bills AS b
      JOIN harn_analytics_visitors AS v USING (visitor_id)
      WHERE b.updated_at >= NOW() - (${VISITOR_RETENTION_DAYS}::int * INTERVAL '1 day')
        AND (${cursor?.updatedAt ?? null}::timestamptz IS NULL OR
          (b.updated_at, b.visitor_id, b.history_id) <
          (${cursor?.updatedAt ?? null}::timestamptz, ${cursor?.visitorId ?? null}::uuid, ${cursor?.historyId ?? null}::text)
        )
      ORDER BY b.updated_at DESC, b.visitor_id DESC, b.history_id DESC
      LIMIT 51
    `;
    return rows.map((row) => ({
      historyId: row.history_id,
      updatedAt: row.updated_at,
      total: Number(row.total_satang) / 100,
      participantCount: Number(row.participant_count),
      items: Array.isArray(row.items) ? row.items : JSON.parse(row.items),
      deviceType: row.device_type,
      browser: row.browser,
      visitorId: row.visitor_id,
    }));
  }

  async function getLoginBlock(clientAddress) {
    await ensureAnalyticsSchema();
    const sql = getSqlClient();
    const rows = await sql`SELECT blocked_until FROM harn_admin_login_attempts WHERE client_key = ${getClientKey(clientAddress)}`;
    const blockedUntil = rows[0]?.blocked_until ? new Date(rows[0].blocked_until) : null;
    return blockedUntil && blockedUntil > new Date() ? blockedUntil : null;
  }

  async function recordFailedLogin(clientAddress) {
    await ensureAnalyticsSchema();
    const sql = getSqlClient();
    const rows = await sql`
      INSERT INTO harn_admin_login_attempts (client_key, attempts)
      VALUES (${getClientKey(clientAddress)}, 1)
      ON CONFLICT (client_key) DO UPDATE SET
        attempts = CASE WHEN harn_admin_login_attempts.window_started < NOW() - INTERVAL '15 minutes' THEN 1 ELSE harn_admin_login_attempts.attempts + 1 END,
        window_started = CASE WHEN harn_admin_login_attempts.window_started < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE harn_admin_login_attempts.window_started END,
        blocked_until = CASE WHEN (CASE WHEN harn_admin_login_attempts.window_started < NOW() - INTERVAL '15 minutes' THEN 1 ELSE harn_admin_login_attempts.attempts + 1 END) >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END
      RETURNING blocked_until
    `;
    return rows[0]?.blocked_until ? new Date(rows[0].blocked_until) : null;
  }

  async function clearFailedLogins(clientAddress) {
    await ensureAnalyticsSchema();
    const sql = getSqlClient();
    await sql`DELETE FROM harn_admin_login_attempts WHERE client_key = ${getClientKey(clientAddress)}`;
  }

  return {
    ensureAnalyticsSchema,
    recordVisitorHeartbeat,
    recordCompletedBill,
    revokeVisitorAnalytics,
    cleanupAnalyticsData,
    getAnalyticsDashboard,
    getAnalyticsBills,
    getLoginBlock,
    recordFailedLogin,
    clearFailedLogins,
  };
}

function getClientKey(clientAddress) {
  const secret = process.env.ADMIN_SESSION_SECRET || 'unconfigured';
  return createHmac('sha256', secret).update(clientAddress || 'anonymous').digest('hex');
}

const repository = createAnalyticsRepository();
export const ensureAnalyticsSchema = (...args) => repository.ensureAnalyticsSchema(...args);
export const recordVisitorHeartbeat = (...args) => repository.recordVisitorHeartbeat(...args);
export const recordCompletedBill = (...args) => repository.recordCompletedBill(...args);
export const revokeVisitorAnalytics = (...args) => repository.revokeVisitorAnalytics(...args);
export const cleanupAnalyticsData = (...args) => repository.cleanupAnalyticsData(...args);
export const getAnalyticsDashboard = (...args) => repository.getAnalyticsDashboard(...args);
export const getAnalyticsBills = (...args) => repository.getAnalyticsBills(...args);
export const getLoginBlock = (...args) => repository.getLoginBlock(...args);
export const recordFailedLogin = (...args) => repository.recordFailedLogin(...args);
export const clearFailedLogins = (...args) => repository.clearFailedLogins(...args);
