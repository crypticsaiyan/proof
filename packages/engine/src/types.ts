import type { Signature } from '@proof/kane';

/** One user action captured by the browser SDK. */
export type Breadcrumb = {
  t: number; // ms epoch
  kind: 'nav' | 'click' | 'input' | 'submit' | 'rage';
  url?: string;
  /** Visible text or accessible name of the element. */
  text?: string;
  /** Field label / placeholder / name for inputs. */
  label?: string;
  value?: string;
  selector?: string;
  /** Nearby heading, e.g. the product card the button sits in. */
  context?: string;
};

export type FailedRequest = { t?: number; method: string; url: string; status: number };

/** What Capture hands to Triage/Reproduce: a broken user session. */
export type Incident = {
  id: string;
  createdAt: string;
  source: 'sdk' | 'widget' | 'sentry' | 'fixture';
  project: string;
  /** Origin the user was on, e.g. https://shop.example */
  origin: string;
  /** Plain-English report from the widget, if any. */
  report?: string;
  reporter?: { email?: string; name?: string };
  breadcrumbs: Breadcrumb[];
  consoleErrors: { t?: number; text: string }[];
  failedRequests: FailedRequest[];
  viewport?: { w: number; h: number };
  userAgent?: string;
  /** rrweb events file, relative to the incident dir. */
  replay?: string;
  /** Set by triage. */
  title?: string;
  severity?: 'critical' | 'major' | 'minor';
  clusterKey?: string;
};

/** A natural-language step Kane can execute. Minimize removes these. */
export type Step = { id: number; text: string };

export type Repro = {
  steps: Step[];
  /** Final check that must fail while the bug exists. */
  expectation: string;
};

export type RunKind = 'reproduce' | 'confirm' | 'minimize' | 'blast' | 'judge' | 'revert' | 'regression' | 'prod';

export type RunRecord = {
  id: string;
  kind: RunKind;
  label: string;
  objective: string;
  url: string;
  status: 'passed' | 'failed' | 'error' | 'timeout';
  matched: boolean;
  why: string;
  signature: Signature;
  summary: string;
  oneLiner: string;
  reasonCode?: string;
  steps: { step: number; status: string; remark: string }[];
  testUrl?: string;
  evidencePack?: string;
  video?: string;
  captioned?: string;
  credits: number;
  durationS: number;
  startedAt: string;
};

export type TimelineEvent = {
  t: string;
  stage:
    | 'captured'
    | 'triaged'
    | 'reproducing'
    | 'reproduced'
    | 'not_reproduced'
    | 'flaky'
    | 'minimizing'
    | 'minimized'
    | 'blast'
    | 'fixing'
    | 'fixed'
    | 'locked'
    | 'verified'
    | 'shipped'
    | 'prod_verified'
    | 'notified'
    | 'reopened'
    | 'error'
    | 'info';
  message: string;
  data?: unknown;
};
