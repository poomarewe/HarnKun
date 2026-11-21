import { neon } from '@neondatabase/serverless';
import { AnalyticsSetupError } from './analytics-db.js';

let sqlClient;
let schemaPromise;

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new AnalyticsSetupError('Message database is not configured. Set DATABASE_URL.');
  }
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

function ensureMessageSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS harn_admin_messages (
          id BIGSERIAL PRIMARY KEY,
          message TEXT NOT NULL,
          contact TEXT,
          visitor_id UUID,
          device_type TEXT,
          browser TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE harn_admin_messages ADD COLUMN IF NOT EXISTS visitor_id UUID`;
      await sql`ALTER TABLE harn_admin_messages ADD COLUMN IF NOT EXISTS device_type TEXT`;
      await sql`ALTER TABLE harn_admin_messages ADD COLUMN IF NOT EXISTS browser TEXT`;
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

export async function insertAdminMessage({ message, contact, visitorId, deviceType, browser }) {
  await ensureMessageSchema();
  const sql = getSql();
  await sql`
    INSERT INTO harn_admin_messages (message, contact, visitor_id, device_type, browser, created_at)
    VALUES (${message}, ${contact}, ${visitorId}::uuid, ${deviceType}, ${browser}, NOW())
  `;
}

export async function listAdminMessages(limit = 100) {
  await ensureMessageSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, message, contact, visitor_id, device_type, browser, created_at
    FROM harn_admin_messages
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    message: row.message,
    contact: row.contact,
    visitorId: row.visitor_id,
    deviceType: row.device_type,
    browser: row.browser,
    createdAt: row.created_at,
  }));
}
