// One verified Kane run: our Chrome + screencast video + Kane verdict + signature match.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { emptySignature, type KaneRun, matchSignature, runKane, type Signature } from '@proof/kane';
import { launchChrome, recordRun } from '@proof/recorder';
import { runDir, saveRun } from './store.ts';
import type { Incident, RunKind, RunRecord } from './types.ts';

let seq = 0;
export const newRunId = (kind: RunKind) =>
  `${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}-${kind}-${(++seq).toString(36)}`;

export function incidentSignature(inc: Incident): Signature {
  const sig = emptySignature();
  for (const r of inc.failedRequests) {
    let path = r.url;
    try {
      path = new URL(r.url, inc.origin).pathname;
    } catch {}
    sig.http.push(`${r.method.toUpperCase()} ${path} ${r.status}`);
  }
  sig.console = inc.consoleErrors.map((c) => c.text);
  return sig;
}

export type VerifyOpts = {
  incident: Incident;
  kind: RunKind;
  label: string;
  objective: string;
  url: string;
  /** Signature a failure must match. Omit for pass/fail-only checks (regression suite). */
  expected?: Signature;
  maxSteps?: number;
  record?: boolean;
};

export async function verify(o: VerifyOpts): Promise<RunRecord> {
  const id = newRunId(o.kind);
  const dir = runDir(o.incident.id, id);
  const startedAt = new Date().toISOString();
  mkdirSync(dir, { recursive: true });
  const kaneOpts = {
    objective: o.objective,
    url: o.url,
    // Kane counts its own actions; give long objectives room (17 user steps needs ~50).
    maxSteps: o.maxSteps ?? Math.max(30, o.objective.split('\n').length * 3 + 10),
    timeoutS: 420,
    bugDetection: 'stop' as const,
    logFile: join(dir, 'kane.ndjson'),
  };
  let kane: KaneRun;
  let video: string | undefined;
  let captioned: string | undefined;
  if (o.record === false) {
    // Still our own throwaway Chrome: Kane's default profile persists cookies (cart!) across
    // runs and collides when runs go in parallel.
    const chrome = await launchChrome();
    try {
      kane = await runKane({ ...kaneOpts, cdpEndpoint: chrome.endpoint });
    } finally {
      await chrome.close();
    }
  } else {
    const rec = await recordRun(dir, async (chrome) => {
      const r = await runKane({ ...kaneOpts, cdpEndpoint: chrome.endpoint });
      return { result: r, captions: r.captions };
    });
    kane = rec.result;
    video = rec.video ?? undefined;
    captioned = rec.captioned ?? undefined;
  }
  // "Same bug" = the user's failure signature showed up on the scripted path. Kane's verdict
  // alone is not enough: an agent can hit the error and then work around it.
  let m: { matched: boolean; why: string };
  if (o.expected) {
    const sm = matchSignature(o.expected, kane.signature);
    m =
      sm.matched && kane.status === 'passed'
        ? { matched: true, why: `${sm.why} (Kane then worked around it)` }
        : sm.matched
          ? sm
          : {
              matched: false,
              why: kane.status === 'passed' ? 'Kane passed: flow worked, no error' : `Kane ${kane.status}: ${sm.why}`,
            };
  } else {
    m =
      kane.status === 'failed'
        ? { matched: true, why: kane.oneLiner || kane.reason }
        : { matched: false, why: kane.status === 'passed' ? 'Kane passed' : `Kane ${kane.status}: ${kane.reason}` };
  }
  const run: RunRecord = {
    id,
    kind: o.kind,
    label: o.label,
    objective: o.objective,
    url: o.url,
    status: kane.status,
    matched: m.matched,
    why: m.why,
    signature: kane.signature,
    summary: kane.summary,
    oneLiner: kane.oneLiner,
    reasonCode: kane.reasonCode,
    steps: kane.steps,
    testUrl: kane.testUrl,
    evidencePack: kane.evidencePack,
    video,
    captioned,
    credits: kane.credits,
    durationS: kane.durationS,
    startedAt,
  };
  saveRun(o.incident.id, run);
  appendFileSync(join(dir, '..', '..', 'credits.log'), `${run.id}\t${run.credits}\n`);
  return run;
}

/** Run tasks with bounded parallelism (each Kane run gets its own Chrome). */
export async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export const PARALLEL = Number(process.env.PROOF_PARALLEL ?? 3);
