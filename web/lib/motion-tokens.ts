/**
 * Shared motion values, so animated components move the same way.
 * Durations are in seconds (motion/react's unit).
 */
export const motionTokens = {
  ease: {
    /** Elements arriving: fast start, long soft landing. */
    enter: [0.16, 1, 0.3, 1],
    /** Elements leaving or changing state. */
    standard: [0.4, 0, 0.2, 1],
    /** Slow at both ends, like a pen stroke (charts drawing in). */
    inOut: [0.65, 0, 0.35, 1],
  },
  duration: {
    instant: 0.1,
    fast: 0.16,
    standard: 0.24,
    /** Larger moves that should read as deliberate (a chart line drawing). */
    considered: 0.4,
  },
  /** Delay between items when a list animates one after another (s). */
  stagger: {
    item: 0.035,
  },
  /** Blur radii in px, for text and icons cross-fading. */
  blur: {
    subtle: 2,
    soft: 4,
  },
  /** Springs are defined by how long they look (visualDuration, s) and how much they overshoot (bounce, 0-1). */
  spring: {
    /** Small elements popping in (icons, checks, digits). */
    snappy: { type: 'spring', visualDuration: 0.28, bounce: 0.18 },
    /** Size changes (a button widening to show its label). */
    morph: { type: 'spring', visualDuration: 0.36, bounce: 0.08 },
    /** Things closing or settling, with no overshoot. */
    smooth: { type: 'spring', visualDuration: 0.42, bounce: 0 },
  },
} as const;

export type MotionTokens = typeof motionTokens;
