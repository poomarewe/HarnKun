(() => {
  if (window.location.pathname === '/admin') return;

  const heartbeat = () => {
    if (document.visibilityState !== 'visible') return;
    fetch('/api/analytics', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {});
  };

  heartbeat();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') heartbeat();
  });
  window.setInterval(heartbeat, 45_000);
})();
