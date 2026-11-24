// Minimize: delta-debug the natural-language steps. Kane re-checks every candidate; a candidate
// "fails" (keeps the bug) only if Kane fails with the same signature. Candidates of one round
// run in parallel, each on its own Chrome.

import { askJson, llmEnabled } from './llm.ts';
import { cleanExpectation, neutralStep, toObjective } from './objective.ts';
import { emit, writeJson } from './store.ts';
import type { Incident, Repro, RunRecord, Step } from './types.ts';
import { incidentSignature, PARALLEL, pool, verify } from './verify.ts';

/** Extra Kane runs the final minimal repro must also fail. */
const CONFIRM = 2;

export type MinResult = {
  repro: Repro;
  from: number;
  to: number;
  checks: number;
  runs: RunRecord[];
  /** Independent re-runs of the final script that hit the user's failure again. */
  confirmed?: { hits: number; of: number };
};

/**
 * ddmin (Zeller): find a 1-minimal subsequence for which `fails` still holds. Order is kept.
 * Each round's candidates run in parallel; the smallest failing candidate wins.
 */
export async function ddmin<T>(
  items: T[],
  fails: (subset: T[]) => Promise<boolean>,
  opts: { key: (xs: T[]) => string; parallel?: number; budget?: () => boolean },
): Promise<T[]> {
  let cur = items;
  let n = 2;
  const budget = opts.budget ?? (() => true);
  while (cur.length >= 2 && budget()) {
    const chunks = split(cur, n);
    const subsets = chunks.length > 2 ? chunks : [];
    const complements = chunks.map((c) => cur.filter((x) => !c.includes(x)));
    const cands = [...subsets, ...complements].filter((c) => c.length > 0 && c.length < cur.length);
    const uniq = [...new Map(cands.map((c) => [opts.key(c), c])).values()].sort((a, b) => a.length - b.length);
    // Waves of `parallel` candidates; stop at the first wave with a failing candidate.
    const width = opts.parallel ?? 1;
    let win: T[] | undefined;
    for (let i = 0; i < uniq.length && !win && budget(); i += width) {
      const wave = uniq.slice(i, i + width);
      const results = await pool(wave, width, (c) => fails(c));
      win = wave.find((_, j) => results[j]);
    }
    if (win) {
      const wasSubset = subsets.some((s) => opts.key(s) === opts.key(win));
      cur = win;
      n = wasSubset ? 2 : Math.max(n - 1, 2);
      continue;
    }
    if (n >= cur.length) break;
    n = Math.min(cur.length, n * 2);
  }
  return cur;
}

/**
 * Hint-first shrink: test the model's guess at the minimal set (1 run). If it still fails, prove
 * 1-minimality by removing each step alone (parallel). Otherwise fall back to ddmin.
 */
export async function shrink<T>(
  items: T[],
  hint: T[] | null,
  fails: (subset: T[]) => Promise<boolean>,
  opts: { key: (xs: T[]) => string; parallel?: number; budget?: () => boolean },
): Promise<T[]> {
  const budget = opts.budget ?? (() => true);
  let cur = items;
  if (hint?.length && hint.length < items.length && (await fails(hint))) cur = hint;
  else cur = await ddmin(items, fails, opts);
  // 1-minimality: every remaining step must be needed.
  for (;;) {
    if (cur.length < 2 || !budget()) return cur;
    const cands = cur.map((x) => cur.filter((y) => y !== x));
    const results = await pool(cands, opts.parallel ?? 1, (c) => (budget() ? fails(c) : Promise.resolve(false)));
    const smaller = cands.find((_, i) => results[i]);
    if (!smaller) return cur;
    cur = smaller;
  }
}

function split<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  const size = Math.ceil(xs.length / n);
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Ask the cheap model which steps are needed. Kane's root-cause note makes this much sharper. */
async function hintFor(inc: Incident, start: Repro, kaneRca: string): Promise<Step[] | null> {
  if (!llmEnabled()) return null;
  const prompt = `These steps reproduce a bug. Pick the SMALLEST subset of steps (by number) that still triggers it.
Keep steps that set up state the failing action depends on (items in cart, codes applied, quantities).
Drop browsing, viewing and undo pairs that cancel out (e.g. add then remove the same item).

Steps:
${start.steps.map((s) => `${s.id}. ${s.text}`).join('\n')}
Final check: ${cleanExpectation(start.expectation, start.steps)}

Bug report: ${inc.report ?? '(none)'}
Kane's root-cause analysis: ${kaneRca || '(none)'}`;
  try {
    const r = await askJson<{ keep: number[] }>(prompt, {
      type: 'object',
      properties: { keep: { type: 'array', items: { type: 'integer' } } },
      required: ['keep'],
    });
    const keep = new Set(r.keep);
    const hint = start.steps.filter((s) => keep.has(s.id));
    return hint.length ? hint : null;
  } catch {
    return null;
  }
}

/**
 * Page model of a script: the path each step runs on, read from "(opens /path)" hints and
 * "Go to <url>" steps. Kane starts on `/`.
 */
function pages(steps: Step[]) {
  const on = new Map<number, string>();
  const lands = new Map<number, string>();
  let cur = '/';
  for (const s of steps) {
    on.set(s.id, cur);
    const m = s.text.match(/\(opens (\/\S*?)\)|^Go to (\S+)/);
    if (m) {
      const target = m[1] ?? m[2];
      try {
        cur = target.startsWith('/') ? target : new URL(target).pathname;
      } catch {}
    }
    lands.set(s.id, cur);
  }
  return { on, lands };
}

/**
 * Re-insert the navigation a candidate needs to reach each step's page (e.g. "Click Checkout"
 * before typing into a checkout field). Without this Kane may wander there by itself locally,
 * the minimizer drops the click, and the locked test fails when followed strictly elsewhere.
 */
export function withNavigation(cand: Step[], all: Step[]): Step[] {
  const { on, lands } = pages(all);
  const out: Step[] = [];
  let cur = '/';
  const reach = (path: string, before: number, depth = 0) => {
    if (cur === path || depth > 5) return;
    const nav = [...all].reverse().find((s) => s.id < before && lands.get(s.id) === path && on.get(s.id) !== path);
    if (!nav) return;
    reach(on.get(nav.id) ?? '/', nav.id, depth + 1);
    if (!out.includes(nav)) out.push(nav);
    cur = path;
  };
  for (const s of cand) {
    reach(on.get(s.id) ?? '/', s.id);
    if (!out.includes(s)) out.push(s);
    cur = lands.get(s.id) ?? cur;
  }
  return out;
}

export async function minimize(
  inc: Incident,
  start: Repro,
  opts: { url: string; maxChecks?: number; kaneRca?: string },
): Promise<MinResult> {
  start = { ...start, steps: start.steps.map((s) => ({ ...s, text: neutralStep(s.text) })) };
  const expected = incidentSignature(inc);
  const expectation = cleanExpectation(start.expectation, start.steps);
  const cache = new Map<string, boolean>();
  const runs: RunRecord[] = [];
  const maxChecks = opts.maxChecks ?? 24;
  const key = (s: Step[]) => s.map((x) => x.id).join(',');
  const kept = new Map<string, Step[]>();

  const check = async (steps: Step[]): Promise<boolean> => {
    const k = key(steps);
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    // A script that skips a needed navigation is not a valid repro, whatever Kane does with it.
    if (withNavigation(steps, start.steps).length !== steps.length) {
      cache.set(k, false);
      return false;
    }
    if (runs.length >= maxChecks) return false;
    const run = await verify({
      incident: inc,
      kind: 'minimize',
      label: `${steps.length} steps [${k}]`,
      objective: toObjective({ steps, expectation }),
      url: opts.url,
      expected,
      record: false,
    });
    runs.push(run);
    cache.set(k, run.matched);
    if (run.matched) kept.set(k, steps);
    emit(inc.id, {
      stage: 'info',
      message: `Minimize: ${steps.length} steps -> ${run.matched ? 'still fails (keep)' : 'bug gone (need these)'}`,
      data: { runId: run.id, steps: steps.map((s) => s.text) },
    });
    return run.matched;
  };

  emit(inc.id, { stage: 'minimizing', message: `Delta-debugging ${start.steps.length} steps with Kane` });
  const raw = await hintFor(inc, start, opts.kaneRca ?? '');
  const hint = raw && withNavigation(raw, start.steps);
  if (hint) emit(inc.id, { stage: 'info', message: `Model hint: steps ${key(hint)} look sufficient; Kane will check` });
  let cur = await shrink(start.steps, hint, check, {
    key,
    parallel: PARALLEL,
    budget: () => runs.length < maxChecks,
  });

  // A single Kane check can pass by luck (e.g. Kane pressed Enter in a coupon field whose
  // "Apply" step was removed). The result must fail CONFIRM more times in a row; otherwise step
  // back to the next smallest candidate that kept the bug, and finally to the full script.
  const confirmed = async (steps: Step[]): Promise<boolean> => {
    if (steps.length === start.steps.length) return true;
    const rs = await pool(
      Array.from({ length: CONFIRM }, (_, i) => i),
      CONFIRM,
      (i) =>
        verify({
          incident: inc,
          kind: 'minimize',
          label: `confirm ${i + 1}/${CONFIRM}: ${steps.length} steps [${key(steps)}]`,
          objective: toObjective({ steps, expectation }),
          url: opts.url,
          expected,
          record: false,
        }),
    );
    runs.push(...rs);
    const hits = rs.filter((r) => r.matched).length;
    emit(inc.id, {
      stage: 'info',
      message: `Minimize: confirming ${steps.length} steps -> ${hits}/${CONFIRM} still fail${hits === CONFIRM ? '' : ' (flaky, stepping back)'}`,
    });
    return hits === CONFIRM;
  };
  const ladder = [cur, ...[...kept.values()].sort((a, b) => a.length - b.length), start.steps].filter(
    (c, i, all) => all.findIndex((d) => key(d) === key(c)) === i && c.length >= cur.length,
  );
  let final = start.steps;
  let confirmation: MinResult['confirmed'];
  for (const cand of ladder.slice(0, 4)) {
    if (await confirmed(cand)) {
      final = cand;
      if (cand.length < start.steps.length) confirmation = { hits: CONFIRM, of: CONFIRM };
      break;
    }
  }
  cur = final;
  const repro: Repro = { steps: cur, expectation };
  const result: MinResult = {
    repro,
    from: start.steps.length,
    to: cur.length,
    checks: runs.length,
    runs,
    confirmed: confirmation,
  };
  writeJson(inc.id, 'minimal.json', { ...result, runs: runs.map((r) => r.id) });
  emit(inc.id, {
    stage: 'minimized',
    message: `Minimal repro: ${inc.breadcrumbs.length} session events -> ${start.steps.length} steps -> ${cur.length} steps (${runs.length} Kane checks)`,
    data: { steps: cur.map((s) => s.text), expectation },
  });
  return result;
}
