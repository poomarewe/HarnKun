import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE_NAME = 'harn_admin_session';
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

function digest(value) {
  return createHmac('sha256', process.env.ADMIN_SESSION_SECRET || 'unconfigured')
    .update(value)
    .digest();
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(String(cookieHeader || '').split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [part.trim(), ''];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1))];
  }).filter(([name]) => name));
}

export function isAdminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET?.length >= 32);
}

export function verifyAdminPassword(password) {
  if (!isAdminConfigured() || typeof password !== 'string') return false;
  return timingSafeEqual(digest(password), digest(process.env.ADMIN_PASSWORD));
}

export function createAdminSession() {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + ADMIN_SESSION_SECONDS * 1000,
    nonce: randomBytes(16).toString('base64url'),
  })).toString('base64url');
  const signature = digest(payload).toString('base64url');
  return `${payload}.${signature}`;
}

export function hasValidAdminSession(request) {
  if (!isAdminConfigured()) return false;
  const token = parseCookies(request.headers.get('cookie'))[ADMIN_COOKIE_NAME];
  if (!token) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;

  const expected = digest(payload);
  let received;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(session.exp) && session.exp > Date.now();
  } catch {
    return false;
  }
}

export function adminSessionCookie(request, token) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${ADMIN_SESSION_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

export function clearAdminSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${ADMIN_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}

export function isSameOriginRequest(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export function getClientAddress(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'anonymous';
}
