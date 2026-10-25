export function parseCookies(cookieHeader = '') {
  const cookies = Object.create(null);
  for (const part of String(cookieHeader || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    try { cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1)); }
    catch { /* Ignore malformed cookie values instead of breaking unrelated requests. */ }
  }
  return cookies;
}
