(() => {
  if (window.location.pathname === '/admin') return;

  const COOKIE = 'harn_analytics_consent';
  const EVENT = 'harn-analytics-consent-change';
  const MAX_AGE = 60 * 60 * 24 * 183;
  const isThai = document.documentElement.lang.toLowerCase().startsWith('th');
  const copy = isThai ? {
    title: 'คุณเลือกการวิเคราะห์ข้อมูลได้',
    detail: 'หากยอมรับ เราจะบันทึกเวลาเข้าชม ประเภทอุปกรณ์และเบราว์เซอร์โดยประมาณ และเมื่อบันทึกบิล เราจะเก็บยอดรวม ชื่อรายการ ราคา และจำนวนผู้ร่วมบิล โดยเชื่อมกับรหัสเบราว์เซอร์สุ่มเป็นเวลา 30 วัน เราไม่เก็บชื่อผู้ร่วมบิลหรือยอดที่แต่ละคนต้องจ่าย ยอดรวมแบบไม่ระบุตัวตนจะเก็บต่อไป',
    accept: 'ยอมรับการวิเคราะห์',
    reject: 'ปฏิเสธ',
    settings: 'ตั้งค่าคุกกี้',
  } : {
    title: 'Choose optional analytics',
    detail: 'If you accept, we record visit times and broad device/browser type. For bills you complete and save, we store the total, item names and prices, and participant count linked to a random browser ID for 30 days. We do not store participant names or individual shares. Anonymous daily counts and spend totals remain.',
    accept: 'Accept analytics',
    reject: 'Reject analytics',
    settings: 'Cookie settings',
  };

  const readChoice = () => {
    const entry = document.cookie.split(';').map(part => part.trim())
      .find(part => part.startsWith(`${COOKIE}=`));
    const value = entry?.slice(COOKIE.length + 1);
    return value === 'accepted' || value === 'rejected' ? value : null;
  };
  const writeChoice = value => {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
    window.dispatchEvent(new window.CustomEvent(EVENT, { detail: value }));
  };
  const clearLegacyCookie = async () => {
    try {
      const response = await fetch('/api/analytics-revoke', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('revoke failed');
    } catch {
      const status = document.querySelector('.cookie-consent-status');
      if (status) status.textContent = isThai
        ? 'ปิดการวิเคราะห์แล้ว แต่ลบข้อมูลเดิมไม่สำเร็จ กรุณาลองอีกครั้งในการตั้งค่าคุกกี้'
        : 'Analytics is off, but saved details could not be cleared. Please retry in Cookie settings.';
      banner.hidden = false;
      settings.hidden = true;
      reject.focus();
    }
  };

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/cookie-consent.css';
  document.head.append(style);

  const wrapper = document.createElement('div');
  wrapper.className = 'cookie-consent-root';
  wrapper.innerHTML = `
    <button class="cookie-settings-trigger" type="button" hidden>${copy.settings}</button>
    <section class="cookie-consent-banner" role="region" aria-label="${copy.title}" hidden>
      <div class="cookie-consent-copy"><strong>${copy.title}</strong><p>${copy.detail}</p><p class="cookie-consent-status" role="status" aria-live="polite"></p></div>
      <div class="cookie-consent-actions">
        <button class="cookie-reject" type="button">${copy.reject}</button>
        <button class="cookie-accept" type="button">${copy.accept}</button>
      </div>
    </section>`;
  document.body.prepend(wrapper);

  const banner = wrapper.querySelector('.cookie-consent-banner');
  const settings = wrapper.querySelector('.cookie-settings-trigger');
  const accept = wrapper.querySelector('.cookie-accept');
  const reject = wrapper.querySelector('.cookie-reject');
  const open = () => {
    banner.hidden = false;
    settings.hidden = true;
    window.requestAnimationFrame(() => reject.focus());
  };
  const close = () => {
    banner.hidden = true;
    settings.hidden = false;
    settings.focus();
  };
  const choose = value => {
    const previous = readChoice();
    writeChoice(value);
    close();
    if (value === 'rejected') clearLegacyCookie();
  };

  settings.addEventListener('click', open);
  accept.addEventListener('click', () => choose('accepted'));
  reject.addEventListener('click', () => choose('rejected'));
  if (readChoice() === null) open();
  else settings.hidden = false;

  if (window.location.pathname.startsWith('/th/')) {
    const heartbeat = () => {
      if (readChoice() === 'accepted' && document.visibilityState === 'visible') {
        fetch('/api/analytics', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
      }
    };
    let intervalId;
    const updateHeartbeat = () => {
      window.clearInterval(intervalId);
      if (readChoice() === 'accepted') {
        heartbeat();
        intervalId = window.setInterval(heartbeat, 45_000);
      }
    };
    window.addEventListener(EVENT, updateHeartbeat);
    document.addEventListener('visibilitychange', updateHeartbeat);
    updateHeartbeat();
  }
})();
