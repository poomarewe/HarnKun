import { parseCookies } from './cookies.js';

export const VISITOR_COOKIE_NAME = 'harn_analytics_visitor';
export const LEGACY_VISITOR_COOKIE_NAME = 'harn_visitor';
export const ANALYTICS_CONSENT_COOKIE_NAME = 'harn_analytics_consent';
export const VISITOR_COOKIE_SECONDS = 30 * 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readVisitorId(request) {
  const visitorId = parseCookies(request.headers.get('cookie'))[VISITOR_COOKIE_NAME];
  return UUID_PATTERN.test(visitorId || '') ? visitorId : null;
}

export function hasAnalyticsConsent(request) {
  return parseCookies(request.headers.get('cookie'))[ANALYTICS_CONSENT_COOKIE_NAME] === 'accepted';
}

function cookieSecurity(request) {
  return new URL(request.url).protocol === 'https:' ? '; Secure' : '';
}

export function visitorCookie(request, visitorId) {
  return `${VISITOR_COOKIE_NAME}=${visitorId}; Path=/; Max-Age=${VISITOR_COOKIE_SECONDS}; HttpOnly; SameSite=Lax${cookieSecurity(request)}`;
}

export function clearVisitorCookies(request) {
  const expired = `Path=/; Max-Age=0; HttpOnly; SameSite=Lax${cookieSecurity(request)}`;
  return [
    `${VISITOR_COOKIE_NAME}=; ${expired}`,
    `${LEGACY_VISITOR_COOKIE_NAME}=; ${expired}`,
  ];
}
