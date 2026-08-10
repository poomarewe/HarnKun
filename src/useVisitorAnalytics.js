import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 45_000;

export default function useVisitorAnalytics() {
  useEffect(() => {
    let intervalId;

    const heartbeat = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/analytics', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => {});
    };

    const startHeartbeat = () => {
      window.clearInterval(intervalId);
      heartbeat();
      intervalId = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') startHeartbeat();
      else window.clearInterval(intervalId);
    };

    startHeartbeat();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
}
