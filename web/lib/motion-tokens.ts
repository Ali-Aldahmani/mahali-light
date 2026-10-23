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
  },
  duration: {
    instant: 0.1,
    fast: 0.16,
    standard: 0.24,
  },
  /** Blur radii in px, for text and icons cross-fading. */
  blur: {
    subtle: 2,
    soft: 4,
  },
  spring: {
    /** Small elements popping in (icons, checks). */
    snappy: { type: 'spring', stiffness: 560, damping: 34, mass: 0.6 },
    /** Size changes (a button widening to show its label). */
    morph: { type: 'spring', stiffness: 420, damping: 38, mass: 0.8 },
  },
} as const;

export type MotionTokens = typeof motionTokens;
