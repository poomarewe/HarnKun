import { useEffect, useState } from 'react';

export const ANALYTICS_CONSENT_COOKIE = 'harn_analytics_consent';
export const ANALYTICS_CONSENT_EVENT = 'harn-analytics-consent-change';

export function readAnalyticsConsent() {
  if (typeof document === 'undefined') return null;
  const value = document.cookie.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${ANALYTICS_CONSENT_COOKIE}=`))?.slice(ANALYTICS_CONSENT_COOKIE.length + 1);
  return value === 'accepted' || value === 'rejected' ? value : null;
}

export function useAnalyticsConsent() {
  const [consent, setConsent] = useState(readAnalyticsConsent);
  useEffect(() => {
    const sync = () => setConsent(readAnalyticsConsent());
    window.addEventListener(ANALYTICS_CONSENT_EVENT, sync);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, sync);
  }, []);
  return consent;
}
