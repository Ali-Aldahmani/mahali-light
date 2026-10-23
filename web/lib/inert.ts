import { version } from 'react';

const legacy = Number(version.split('.')[0]) < 19;

/**
 * Spread onto an element to make it inert: `<div {...inert(closing)} />`.
 * React 18 only forwards `inert` as a string attribute (a boolean is dropped
 * with a warning); React 19 takes a boolean. This works on both.
 */
export function inert(on: boolean | undefined): { inert?: any } {
  return on ? { inert: legacy ? '' : true } : {};
}
