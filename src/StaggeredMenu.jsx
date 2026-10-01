import { useEffect, useRef, useState } from 'react';

export default function StaggeredMenu({
  children,
  openRequest = 0,
  closeRequest = 0,
  onClose,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef(null);
  const panelRef = useRef(null);
  const lastOpenRequestRef = useRef(openRequest);
  const lastCloseRequestRef = useRef(closeRequest);

  const closeMenu = () => {
    setIsOpen(false);
    onClose?.();
    toggleRef.current?.focus();
  };

  const toggleMenu = () => {
    if (isOpen) {
      closeMenu();
      return;
    }

    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('keydown', handleKeyDown);
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 360);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (openRequest === lastOpenRequestRef.current) return;
    lastOpenRequestRef.current = openRequest;
    setIsOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (closeRequest === lastCloseRequestRef.current) return;
    lastCloseRequestRef.current = closeRequest;
    setIsOpen(false);
    onClose?.();
    toggleRef.current?.focus();
  }, [closeRequest, onClose]);

  return (
    <div className={`staggered-menu maggie-menu${isOpen ? ' is-open' : ''}`}>
      <button
        ref={toggleRef}
        className="staggered-menu-toggle"
        type="button"
        aria-label={isOpen ? 'Close history menu' : 'Open history menu'}
        aria-expanded={isOpen}
        aria-controls="history-staggered-menu"
        onClick={toggleMenu}
      >
        <i aria-hidden="true"><b /><b /></i>
      </button>

      <button
        className="staggered-menu-backdrop"
        type="button"
        aria-label="Close history menu"
        tabIndex={isOpen ? 0 : -1}
        onClick={closeMenu}
      />
      <div className="staggered-menu-layer staggered-menu-layer-back" aria-hidden="true" />
      <div className="staggered-menu-layer staggered-menu-layer-middle" aria-hidden="true" />

      <aside
        ref={panelRef}
        id="history-staggered-menu"
        className="staggered-menu-panel"
        aria-hidden={!isOpen}
        aria-label="History"
        tabIndex={-1}
      >
        {children}

      </aside>
    </div>
  );
}
