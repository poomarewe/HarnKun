import { useEffect } from 'react';

export default function useDialogKeyboard() {
  useEffect(() => {
    const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    const activeDialog = () => [...document.querySelectorAll('[aria-modal="true"]')].filter(visible).at(-1);
    const controls = dialog => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled):not([type="file"]), a[href], select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(visible);
    let previousDialog;
    const returnFocus = new WeakMap();
    const sync = () => {
      const dialog = activeDialog();
      if (dialog === previousDialog) return;
      const previous = previousDialog;
      previousDialog = dialog;
      if (previous && !previous.isConnected) returnFocus.get(previous)?.focus?.();
      if (dialog && !dialog.contains(document.activeElement)) {
        returnFocus.set(dialog, document.activeElement);
        (controls(dialog)[0] || dialog).focus();
      }
    };
    const handleKey = event => {
      const dialog = activeDialog();
      if (!dialog) return;
      if (event.key === 'Escape') {
        const close = dialog.querySelector('[aria-label="Close"], [aria-label^="Close "], .guided-crop-back, .home-confirm-actions button');
        if (close && !close.disabled) { event.preventDefault(); event.stopPropagation(); close.click(); }
      }
      if (event.key !== 'Tab') return;
      const focusable = controls(dialog);
      if (!focusable.length) { event.preventDefault(); return; }
      const index = focusable.indexOf(document.activeElement);
      if (index < 0 || (!event.shiftKey && index === focusable.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault();
        focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', handleKey, true);
    sync();
    return () => { observer.disconnect(); document.removeEventListener('keydown', handleKey, true); };
  }, []);
}
