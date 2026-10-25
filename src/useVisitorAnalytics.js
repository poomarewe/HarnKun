import { useEffect } from 'react';
import { sendVisitorHeartbeat } from './visitor-analytics.js';

const HEARTBEAT_INTERVAL_MS = 45_000;

export default function useVisitorAnalytics() {
  useEffect(() => {
    let intervalId;

    const heartbeat = () => {
      if (document.visibilityState !== 'visible') return;
      sendVisitorHeartbeat();
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
