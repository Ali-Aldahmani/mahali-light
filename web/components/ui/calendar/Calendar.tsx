"use client";

import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion, useTransform, type Variants } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import { useToday } from "@/lib/use-today";
import { inert } from "@/lib/inert";
import styles from "./calendar.module.css";

/** Days that can't be picked: a list of dates, or a test. */
export type CalendarDateMatcher = Date[] | ((date: Date) => boolean);

export interface CalendarProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  /** The month on screen (any day in it). */
  month: Date;
  onMonthChange: (month: Date) => void;
  minDate?: Date;
  maxDate?: Date;
  disabledDates?: CalendarDateMatcher;
  locale?: string;
  /** Adds a Today button to the header. */
  showToday?: boolean;
  /** 0 is Sunday, 1 is Monday. */
  weekStartsOn?: 0 | 1;
}

const DAY = 864e5;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const shiftMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()));
const dayDiff = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);
const monthDiff = (a: Date, b: Date) => (a.getFullYear() - b.getFullYear()) * 12 + a.getMonth() - b.getMonth();
const sameDay = (a?: Date | null, b?: Date | null) => Boolean(a && b && dayDiff(a, b) === 0);
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const enterEase = [...motionTokens.ease.enter] as [number, number, number, number];
const standardEase = [...motionTokens.ease.standard] as [number, number, number, number];

/** Months slide in the direction you travel; the title rolls the same way. */
const slide: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 40 }),
  center: { opacity: 1, x: 0, transition: { x: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: enterEase } } },
  exit: (direction: number) => ({ opacity: 0, x: direction * -30, transition: { x: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: standardEase } } }),
};
const roll: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: `${direction * 0.45}em`, filter: `blur(${motionTokens.blur.subtle}px)` }),
  center: { opacity: 1, y: "0em", filter: "blur(0px)", transition: { duration: motionTokens.duration.standard, ease: enterEase } },
  exit: (direction: number) => ({ opacity: 0, y: `${direction * -0.45}em`, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: standardEase } }),
};
const fade: Variants = { enter: { opacity: 0 }, center: { opacity: 1, x: 0, y: "0em", filter: "blur(0px)", transition: { duration: motionTokens.duration.instant } }, exit: { opacity: 0, transition: { duration: motionTokens.duration.instant } } };

/** The selected day's disc. It glides between days of the same month and fades when the pick leaves the month. */
function Selection({ cell, reduced }: { cell: { row: number; col: number } | null; reduced: boolean }) {
  const x = useMotionValue(cell?.col ?? 0), y = useMotionValue(cell?.row ?? 0), opacity = useMotionValue(cell ? 1 : 0), scale = useMotionValue(cell ? 1 : 0.7);
  const transform = useTransform(() => `translate(${x.get() * 100}%, ${y.get() * 100}%) scale(${scale.get()})`);
  const hidden = useRef(!cell);
  useLayoutEffect(() => {
    if (!cell) { hidden.current = true; animate(opacity, 0, { duration: reduced ? 0 : 0.12 }); animate(scale, 0.7, { duration: reduced ? 0 : 0.12 }); return; }
    if (hidden.current || reduced) { x.jump(cell.col); y.jump(cell.row); }
    else { animate(x, cell.col, motionTokens.spring.snappy); animate(y, cell.row, motionTokens.spring.snappy); }
    hidden.current = false;
    animate(opacity, 1, { duration: reduced ? 0 : 0.14 });
    animate(scale, 1, reduced ? { duration: 0 } : motionTokens.spring.snappy);
  }, [cell, opacity, reduced, scale, x, y]);
  return <motion.span className={styles.selection} style={{ transform, opacity }} aria-hidden="true" />;
}

/** A leaving month turns inert, so focus and the date picker's queries only find the current one (`data-present`). */
function MonthFrame({ children, direction, reduced }: { children: React.ReactNode; direction: number; reduced: boolean }) {
  const present = useIsPresent();
  return <motion.div className={styles.month} data-present={present || undefined} {...inert(!present)} custom={direction}
    variants={reduced ? fade : slide} initial="enter" animate="center" exit="exit">{children}</motion.div>;
}

/**
 * A month grid for picking one day. The pick glides between days, months slide the way you travel, arrow keys move by
 * day and week, PageUp / PageDown by month (Shift for a year), Home / End to the week's ends.
 */
export function Calendar({ value, onChange, month, onMonthChange, minDate, maxDate, disabledDates, locale = "en-US", showToday = false, weekStartsOn = 0 }: CalendarProps) {
  const reduced = !!useReducedMotion();
  const today = useToday();
  const view = monthStart(month);
  const [direction, setDirection] = useState(0);
  const [focusKey, setFocusKey] = useState(() => keyOf(value ?? today ?? view));
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);

  const formatters = useMemo(() => ({
    title: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    day: new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short" }),
    weekdayLong: new Intl.DateTimeFormat(locale, { weekday: "long" }),
  }), [locale]);

  const first = addDays(view, -((view.getDay() - weekStartsOn + 7) % 7));
  const rows = Array.from({ length: 6 }, (_, row) => Array.from({ length: 7 }, (_, col) => addDays(first, row * 7 + col)));
  const isDisabled = (date: Date) =>
    Boolean((minDate && dayDiff(date, minDate) < 0) || (maxDate && dayDiff(date, maxDate) > 0) ||
      (Array.isArray(disabledDates) ? disabledDates.some((d) => sameDay(d, date)) : disabledDates?.(date)));

  // The tab stop: the focused day if it's in this month, else the pick, else today, else the 1st.
  const inView = (date: Date) => monthDiff(date, view) === 0;
  const focusDate = (() => { const [y, m, d] = focusKey.split("-").map(Number); return new Date(y!, m! - 1, d!); })();
  const tabbable = inView(focusDate) ? focusKey : value && inView(value) ? keyOf(value) : today && inView(today) ? keyOf(today) : keyOf(view);
  const selectedCell = value && inView(value) ? (() => { const i = dayDiff(value, first); return { row: Math.floor(i / 7), col: i % 7 }; })() : null;

  const go = (next: Date) => {
    const delta = monthDiff(next, view);
    if (!delta) return;
    setDirection(Math.sign(delta));
    onMonthChange(monthStart(next));
  };

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const node = rootRef.current?.querySelector<HTMLButtonElement>(`[data-present] [data-date="${focusKey}"]`);
    if (node) { pendingFocus.current = false; node.focus({ preventScroll: true }); }
  });

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    const weekday = (date.getDay() - weekStartsOn + 7) % 7;
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(date, -1), ArrowRight: () => addDays(date, 1), ArrowUp: () => addDays(date, -7), ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, -weekday), End: () => addDays(date, 6 - weekday),
      PageUp: () => shiftMonths(date, event.shiftKey ? -12 : -1), PageDown: () => shiftMonths(date, event.shiftKey ? 12 : 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    let next = move();
    if (minDate && dayDiff(next, minDate) < 0) next = startOfDay(minDate);
    if (maxDate && dayDiff(next, maxDate) > 0) next = startOfDay(maxDate);
    setFocusKey(keyOf(next));
    pendingFocus.current = true;
    if (!inView(next)) go(next);
  };

  const canPrev = !minDate || monthDiff(view, minDate) > 0;
  const canNext = !maxDate || monthDiff(view, maxDate) < 0;
  const titleKey = keyOf(view);

  return <div ref={rootRef} className={styles.calendar}>
    <div className={styles.header}>
      <button type="button" className={styles.nav} aria-label="Previous month" disabled={!canPrev} onClick={() => go(addMonths(view, -1))}><ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" /></button>
      <span className={styles.title} aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.span key={titleKey} className={styles.titleText} custom={direction} variants={reduced ? fade : roll} initial="enter" animate="center" exit="exit">{formatters.title.format(view)}</motion.span>
        </AnimatePresence>
      </span>
      {showToday && today && <button type="button" className={styles.today} disabled={isDisabled(today)} onClick={() => { setFocusKey(keyOf(today)); go(today); onChange?.(today); }}>Today</button>}
      <button type="button" className={styles.nav} aria-label="Next month" disabled={!canNext} onClick={() => go(addMonths(view, 1))}><ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" /></button>
    </div>

    <div className={styles.weekdays} aria-hidden="true">
      {rows[0]!.map((date) => <span key={date.getDay()}>{formatters.weekday.format(date).slice(0, 2)}</span>)}
    </div>

    {/* Leaving and arriving months share one cell, so the calendar never changes size mid-slide. */}
    <div className={styles.viewport}>
      <AnimatePresence initial={false} custom={direction}>
        <MonthFrame key={titleKey} direction={direction} reduced={reduced}>
          <div role="grid" aria-label={formatters.title.format(view)} className={styles.grid}>
            <Selection cell={selectedCell} reduced={reduced} />
            {rows.map((row, index) => <div key={index} role="row" className={styles.week}>
              {row.map((date) => {
                if (!inView(date)) return <span key={keyOf(date)} role="gridcell" className={styles.blank} />;
                const key = keyOf(date);
                const selected = sameDay(date, value);
                const disabled = isDisabled(date);
                return <span key={key} role="gridcell" aria-selected={selected}>
                  <button type="button" className={styles.day} data-date={key} data-selected={selected || undefined} data-today={sameDay(date, today) || undefined}
                    tabIndex={key === tabbable ? 0 : -1} disabled={disabled} aria-current={sameDay(date, today) ? "date" : undefined} aria-label={formatters.day.format(date)}
                    onFocus={() => setFocusKey(key)} onKeyDown={(event) => onKey(event, date)} onClick={() => { setFocusKey(key); onChange?.(date); }}>
                    {date.getDate()}
                  </button>
                </span>;
              })}
            </div>)}
          </div>
        </MonthFrame>
      </AnimatePresence>
    </div>
  </div>;
}

export default Calendar;
