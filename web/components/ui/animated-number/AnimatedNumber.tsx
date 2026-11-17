"use client";

import { useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import { formatCurrency } from "@/lib/utils/format";
import styles from "./animated-number.module.css";

export interface AnimatedNumberProps {
  value: number;
  /** Turns the value into the text shown, such as "AED 525.00". Defaults to formatCurrency. */
  format?: (value: number) => string;
  className?: string;
}

type Part = { key: string; char: string };
type Bezier = [number, number, number, number];

const { spring, blur, duration } = motionTokens;
const enterEase = [...motionTokens.ease.enter] as Bezier;
const standardEase = [...motionTokens.ease.standard] as Bezier;

/** Reduced motion is only known in the browser; the server render and the first client render both animate-capable. */
const subscribe = () => () => {};
function useReducedFlag() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

/**
 * Splits formatted text into one slot per character. Digits are keyed by place value (ones, tens, cents…), so
 * 9 → 10 keeps the ones slot the ones slot and only opens a new tens slot. Text around the number ("AED ") is
 * keyed by position and never moves.
 */
function partsOf(text: string): Part[] {
  const match = /\d[\d,]*(?:\.\d+)?/.exec(text);
  if (!match) return [...text].map((char, index) => ({ key: `p${index}`, char }));
  const [whole = "", fraction] = match[0].split(".");
  const parts: Part[] = [...text.slice(0, match.index)].map((char, index) => ({ key: `p${index}`, char }));
  let place = whole.replace(/\D/g, "").length;
  for (const char of whole) parts.push(/\d/.test(char) ? { key: `i${--place}`, char } : { key: `g${place}`, char });
  if (fraction !== undefined) {
    parts.push({ key: "d", char: "." });
    [...fraction].forEach((char, index) => parts.push({ key: `f${index}`, char }));
  }
  [...text.slice(match.index + match[0].length)].forEach((char, index) => parts.push({ key: `s${index}`, char }));
  return parts;
}

/* A slot that appears (100 → 1,000) opens its width on a spring; one that leaves closes without overshoot. */
const column: Variants = {
  enter: { width: 0, opacity: 0 },
  center: { width: "auto", opacity: 1, transition: { width: spring.morph, opacity: { duration: duration.fast } } },
  exit: { width: 0, opacity: 0, transition: { width: spring.smooth, opacity: { duration: duration.instant } } },
};
const columnCut: Variants = { enter: { width: "auto", opacity: 1 }, center: { width: "auto", opacity: 1, transition: { duration: 0 } }, exit: { width: 0, opacity: 0, transition: { duration: 0 } } };

/* Inside a slot the new digit rises from below when the amount grew (from above when it shrank), sharpening from a
   blur, while the old digit leaves the other way. `dir` is +1 for up, -1 for down. */
const glyph: Variants = {
  enter: (dir: number) => ({ y: `${dir * .55}em`, opacity: 0, filter: `blur(${blur.soft}px)` }),
  center: { y: 0, opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" }, transition: { y: spring.snappy, opacity: { duration: duration.fast, ease: enterEase }, filter: { duration: duration.fast, ease: enterEase } } },
  exit: (dir: number) => ({ y: `${dir * -.55}em`, opacity: 0, filter: `blur(${blur.subtle}px)`, transition: { duration: duration.instant, ease: standardEase } }),
};
/* Reduced motion keeps a short fade and no travel. */
const glyphFade: Variants = { enter: { y: 0, opacity: 0, filter: "none" }, center: { y: 0, opacity: 1, filter: "none", transition: { duration: duration.instant } }, exit: { opacity: 0, transition: { duration: 0 } } };

/**
 * A read-only amount whose changed digits roll in the direction of the change; unchanged digits hold still.
 * Nothing animates on first render. Assistive tech reads the plain text.
 */
export function AnimatedNumber({ value, format = formatCurrency, className }: AnimatedNumberProps) {
  const reduced = useReducedFlag();
  const [trail, setTrail] = useState({ value, direction: 1 });
  if (trail.value !== value) setTrail({ value, direction: value > trail.value ? 1 : -1 });
  const direction = trail.value === value ? trail.direction : value > trail.value ? 1 : -1;
  const text = format(value);

  return <span className={[styles.root, className].filter(Boolean).join(" ")}>
    <span className={styles.srOnly}>{text}</span>
    <span aria-hidden="true" style={{ display: "contents" }}>
      <AnimatePresence initial={false} custom={direction}>
        {partsOf(text).map(part => <motion.span key={part.key} className={styles.column} custom={direction} variants={reduced ? columnCut : column} initial="enter" animate="center" exit="exit">
          <span className={styles.sizer}>{part.char}</span>
          <AnimatePresence initial={false} custom={direction}>
            <motion.span key={part.char} className={styles.glyph} custom={direction} variants={reduced ? glyphFade : glyph} initial="enter" animate="center" exit="exit">{part.char}</motion.span>
          </AnimatePresence>
        </motion.span>)}
      </AnimatePresence>
    </span>
  </span>;
}

export default AnimatedNumber;
