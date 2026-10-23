'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { SettingsCommand } from '@/components/ui/settings-command';
import type { SettingsValues } from '@/components/ui/settings-command';
import { useQuickActionStore } from '@/store/quickActionStore';
import { motionTokens } from '@/lib/motion-tokens';
import { SETTINGS, SETTINGS_DEFAULTS, SETTINGS_SECTIONS, SETTINGS_SUGGESTED } from './settingsCatalog';

// Front end only: "saved" values live in memory for this session.
let savedThisSession: SettingsValues = SETTINGS_DEFAULTS;

/** The Settings command in a large dialog, opened from the profile menu. */
export default function SettingsDialog() {
  const open = useQuickActionStore((s) => s.settingsOpen);
  const close = useQuickActionStore((s) => s.closeSettings);
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return undefined;
    returnTo.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('nav button')?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      // The search palette handles its own Escape first.
      // An open drop-down inside closes first, on its own Escape.
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      returnTo.current?.focus?.({ preventScroll: true });
    };
  }, [open, close]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="settings"
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : motionTokens.duration.fast }}
        >
          <div className="absolute inset-0 bg-ink/30" aria-hidden="true" onMouseDown={close} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="relative h-[min(760px,calc(100vh-2rem))] w-full max-w-[980px] shadow-pop rounded-[16px]"
            initial={reduced ? false : { scale: 0.97, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={reduced ? undefined : { scale: 0.98, y: 4, transition: { duration: motionTokens.duration.fast } }}
            transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}
          >
            <SettingsCommand
              title="Settings"
              sections={SETTINGS_SECTIONS}
              settings={SETTINGS}
              defaultValues={savedThisSession}
              suggested={SETTINGS_SUGGESTED}
              onSave={async (values) => {
                await new Promise((r) => setTimeout(r, 600));
                savedThisSession = values;
              }}
            />
            <button
              type="button"
              onClick={close}
              aria-label="Close settings"
              className="absolute right-[-12px] top-[-12px] z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-ink-muted shadow-soft hover:text-ink"
            >
              <X size={16} />
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
