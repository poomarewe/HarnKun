export const VISITOR_COOKIE_NAME = 'harn_visitor';
const VISITOR_COOKIE_SECONDS = 365 * 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(String(cookieHeader || '').split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [part.trim(), ''];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1))];
  }).filter(([name]) => name));
}

export function readVisitorId(request) {
  const visitorId = parseCookies(request.headers.get('cookie'))[VISITOR_COOKIE_NAME];
  return UUID_PATTERN.test(visitorId || '') ? visitorId : null;
}

export function visitorCookie(request, visitorId) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${VISITOR_COOKIE_NAME}=${visitorId}; Path=/; Max-Age=${VISITOR_COOKIE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}
