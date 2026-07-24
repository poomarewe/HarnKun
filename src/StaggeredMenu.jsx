import { useEffect, useRef, useState } from 'react';

export default function StaggeredMenu({ children, onOpen, onClose }) {
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef(null);
  const panelRef = useRef(null);

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
    onOpen?.();
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

  return (
    <div className={`staggered-menu${isOpen ? ' is-open' : ''}`}>
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

        <a
          className="staggered-menu-instagram"
          href="https://www.instagram.com/https.sanin/"
          target="_blank"
          rel="noreferrer"
          tabIndex={isOpen ? 0 : -1}
        >
          Instagram · @https.sanin
        </a>
      </aside>
    </div>
  );
}
