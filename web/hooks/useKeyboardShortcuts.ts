import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUiErrorStore } from '@/store/uiErrorStore';

export function useKeyboardShortcuts({ onToggleHelp }: { onToggleHelp?: () => void }) {
  const router = useRouter();
  const openBug = useUiErrorStore((s) => s.openBugReport);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onToggleHelp?.();
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        router.push('/pos');
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        router.push('/pos');
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        openBug();
      }
      if (e.key === 'F11') {
        e.preventDefault();
        (window as any).electron?.toggleFullscreen?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, onToggleHelp, openBug]);
}
