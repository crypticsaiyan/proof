// The timeline is append-only and a stage can run more than once (re-minimize, new tournament).
// These are the times of the cycle that counts: restarting a stage clears everything after it.

import type { TimelineEvent } from './types.ts';

export type Milestones = {
  captured?: string;
  reproduced?: string;
  minimized?: string;
  fixed?: string;
  verified?: string;
  shipped?: string;
  prodVerified?: string;
  notified?: string;
  /** Set when a fix that was green in production was later taken out again. */
  reopened?: string;
};

const ORDER = [
  'captured',
  'reproduced',
  'minimized',
  'fixed',
  'verified',
  'shipped',
  'prodVerified',
  'notified',
  'reopened',
] as const;

export function milestonesOf(tl: TimelineEvent[]): Milestones {
  const m: Milestones = {};
  const clearFrom = (k: (typeof ORDER)[number]) => {
    for (const x of ORDER.slice(ORDER.indexOf(k))) delete m[x];
  };
  for (const e of tl) {
    switch (e.stage) {
      case 'captured':
        m.captured ??= e.t;
        break;
      case 'reproducing':
        clearFrom('reproduced');
        break;
      case 'reproduced':
      case 'flaky':
        m.reproduced = e.t;
        break;
      case 'minimizing':
        clearFrom('minimized');
        break;
      case 'minimized':
        m.minimized = e.t;
        break;
      case 'locked':
        clearFrom('fixed');
        break;
      case 'fixed':
        m.fixed = e.t;
        break;
      case 'verified':
        m.verified = e.t;
        break;
      case 'shipped':
        m.shipped ??= e.t; // re-running ship only updates the same PR
        break;
      case 'prod_verified':
        m.prodVerified = e.t;
        delete m.reopened;
        break;
      case 'notified':
        m.notified = e.t;
        break;
      case 'reopened':
        m.reopened = e.t;
        break;
    }
  }
  return m;
}
