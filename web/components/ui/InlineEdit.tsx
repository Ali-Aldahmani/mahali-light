'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, CircleAlert, Pencil, X } from 'lucide-react';
import { motionTokens } from '@/lib/motion-tokens';
import styles from './inline-edit.module.css';

export interface InlineEditProps {
  value: string;
  onSave: (next: string) => void | Promise<unknown>;
  label: string;
  validate?: (next: string) => string | null | undefined;
  placeholder?: string;
  multiline?: boolean;
  variant?: 'title' | 'body';
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3';
  className?: string;
}

type Phase = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * Supplied click-to-edit control. It owns draft state so typing does not
 * rebuild the surrounding category tree, restores the confirmed value after
 * failed saves, and keeps keyboard/focus behavior inside the control.
 */
export function InlineEdit({
  value,
  onSave,
  label,
  validate,
  placeholder = '',
  multiline = false,
  variant = 'title',
  as: Tag = 'span',
  className,
}: InlineEditProps) {
  const reduced = useReducedMotion() ?? false;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const display = useRef<HTMLButtonElement>(null);
  const control = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const saveRun = useRef(0);
  const lastProp = useRef(value);
  const [committed, setCommitted] = useState(value);
  const [shown, setShown] = useState(value);
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [selection, setSelection] = useState<number | 'all' | null>(null);

  useEffect(() => {
    if (value === lastProp.current) return;
    lastProp.current = value;
    if (editing || phase === 'saving') return;
    setCommitted(value);
    setShown(value);
    setDraft(value);
  }, [value, editing, phase]);

  useLayoutEffect(() => {
    if (!editing || selection === null || !control.current) return;
    const field = control.current;
    field.focus({ preventScroll: true });
    if (selection === 'all') field.select();
    else field.setSelectionRange(selection, selection);
    setSelection(null);
  }, [editing, selection]);

  function startEdit(at: number | 'all', text = shown) {
    if (editing || phase === 'saving') return;
    setDraft(text);
    setError(null);
    setFailedDraft(null);
    setFailureMessage(null);
    setPhase('idle');
    setSelection(at);
    setEditing(true);
  }

  function caretAt(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) return 'all' as const;
    const text = event.currentTarget.querySelector('[data-inline-text]')?.firstChild;
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
    if (position?.offsetNode === text) return Math.min(position.offset, shown.length);
    const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
    return range?.startContainer === text ? Math.min(range.startOffset, shown.length) : shown.length;
  }

  const clean = (text: string) => multiline ? text.trim() : text.replace(/\s+/g, ' ').trim();

  function submit(source: 'key' | 'button' | 'blur') {
    const next = clean(draft);
    const problem = validate?.(next) || null;
    if (problem) {
      setError(problem);
      if (source !== 'blur') control.current?.focus();
      return;
    }
    setEditing(false);
    setError(null);
    if (next === shown) {
      if (source !== 'blur') display.current?.focus({ preventScroll: true });
      return;
    }

    const previous = committed;
    const run = ++saveRun.current;
    setShown(next);
    setPhase('saving');
    Promise.resolve()
      .then(() => onSave(next))
      .then(() => {
        if (run !== saveRun.current) return;
        setCommitted(next);
        setPhase('saved');
        if (source !== 'blur') display.current?.focus({ preventScroll: true });
        window.setTimeout(() => setPhase((current) => current === 'saved' ? 'idle' : current), 1800);
      })
      .catch((reason: unknown) => {
        if (run !== saveRun.current) return;
        const message = reason && typeof reason === 'object' && 'message' in reason
          ? String((reason as { message?: unknown }).message || '')
          : '';
        setShown(previous);
        setPhase('failed');
        setFailedDraft(next);
        setFailureMessage(message || `Couldn’t save “${next}”, so the last saved value is back.`);
        if (source !== 'blur') display.current?.focus({ preventScroll: true });
      });
  }

  function cancel() {
    setEditing(false);
    setDraft(shown);
    setError(null);
    display.current?.focus({ preventScroll: true });
  }

  function onChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setDraft(event.target.value);
    if (error) setError(validate?.(clean(event.target.value)) || null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && !(multiline && event.shiftKey)) {
      event.preventDefault();
      submit('key');
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!editing) return;
    const next = event.relatedTarget as Node | null;
    if (next && root.current?.contains(next)) return;
    if (!next && !document.hasFocus()) return;
    submit('blur');
  }

  const message = error || (phase === 'failed' ? failureMessage : null);
  const fieldProps = {
    className: styles.control,
    value: draft,
    onChange,
    onKeyDown,
    placeholder,
    'aria-label': label,
    'aria-invalid': error ? true as const : undefined,
    'aria-describedby': message ? `${id}-message` : `${id}-hint`,
    autoComplete: 'off',
  };

  return (
    <div
      ref={root}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-editing={editing || undefined}
      data-phase={phase}
      onBlur={onBlur}
    >
      <Tag className={styles.line}>
        <span className={styles.box}>
          <button
            ref={display}
            type="button"
            className={styles.display}
            onClick={(event) => startEdit(caretAt(event))}
            tabIndex={editing ? -1 : undefined}
            aria-label={`${label}: ${shown || placeholder}`}
            aria-describedby={`${id}-hint`}
            aria-disabled={phase === 'saving' || undefined}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={shown}
                data-inline-text
                className={styles.text}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduced ? 0 : -3 }}
                transition={{ duration: reduced ? 0 : motionTokens.duration.fast }}
              >
                {editing ? draft || '\u200b' : shown || placeholder || '\u200b'}
              </motion.span>
            </AnimatePresence>
          </button>
          {editing && (multiline
            ? <textarea ref={(node) => { control.current = node; }} {...fieldProps} rows={1} />
            : <input ref={(node) => { control.current = node; }} {...fieldProps} type="text" />)}
          <span className={styles.slot} aria-hidden={editing || phase === 'saving' ? undefined : true}>
            {editing ? (
              <span className={styles.actions}>
                <button type="button" className={styles.save} aria-label={`Save ${label.toLowerCase()}`} onPointerDown={(e) => e.preventDefault()} onClick={() => submit('button')}><Check size={15} /></button>
                <button type="button" className={styles.cancel} aria-label="Cancel editing" onPointerDown={(e) => e.preventDefault()} onClick={cancel}><X size={15} /></button>
              </span>
            ) : phase === 'saving' ? <span className={styles.spinner} role="status"><span className={styles.srOnly}>Saving {label.toLowerCase()}</span></span>
              : phase === 'saved' ? <Check className={styles.saved} size={16} />
                : phase === 'failed' ? <CircleAlert className={styles.failed} size={16} />
                  : <Pencil className={styles.pencil} size={14} />}
          </span>
        </span>
      </Tag>
      {message && <span id={`${id}-message`} className={styles.message} role="alert"><CircleAlert size={13} />{message}{phase === 'failed' && failedDraft && <button type="button" onClick={() => startEdit(failedDraft.length, failedDraft)}>Try again</button>}</span>}
      <span id={`${id}-hint`} className={styles.srOnly}>{editing ? 'Enter saves, Escape cancels.' : 'Activate to edit.'}</span>
    </div>
  );
}

export default InlineEdit;
