import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiErrorStore } from '../store/uiErrorStore.js';

export function useKeyboardShortcuts({ onToggleHelp }) {
  const navigate = useNavigate();
  const openBug = useUiErrorStore((s) => s.openBugReport);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onToggleHelp?.();
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        navigate('/pos');
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        navigate('/pos');
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        openBug();
      }
      if (e.key === 'F11') {
        e.preventDefault();
        document.fullscreenElement
          ? document.exitFullscreen?.()
          : document.documentElement.requestFullscreen?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, onToggleHelp, openBug]);
}
