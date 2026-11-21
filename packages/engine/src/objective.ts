// Session -> Kane objective, and the feedback loop that revises it from Kane's own trace.

import { askJson, llmEnabled } from './llm.ts';
import type { Incident, Repro, RunRecord, Step } from './types.ts';

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

/** Deterministic translation of breadcrumbs into Kane steps. Used as fallback and as LLM input. */
export function breadcrumbSteps(inc: Incident): string[] {
  const out: string[] = [];
  let lastPath = '/';
  let first = true;
  let prev: Incident['breadcrumbs'][number] | undefined;
  const crumbs = inc.breadcrumbs;
  for (const [i, b] of crumbs.entries()) {
    const causedByClick = prev && (prev.kind === 'click' || prev.kind === 'submit') && b.t - prev.t < 5000;
    prev = b;
    if (b.kind === 'nav' && b.url) {
      const p = pathOf(b.url);
      // Navigations caused by a click are implied by the click; only typed/back navigations count.
      if (!first && p !== lastPath && !causedByClick) out.push(`Go to ${inc.origin}${p}`);
      lastPath = p;
      first = false;
    } else if (b.kind === 'click' && b.text) {
      // Say where a navigating click lands, so the agent cannot pick a different element.
      const next = crumbs[i + 1];
      const lands = next?.kind === 'nav' && next.url && next.t - b.t < 5000 ? pathOf(next.url) : undefined;
      const goesElsewhere = lands && lands !== lastPath;
      out.push(`Click "${b.text}"${b.context ? ` for "${b.context}"` : ''}${goesElsewhere ? ` (opens ${lands})` : ''}`);
    } else if (b.kind === 'input' && b.value !== undefined) {
      out.push(`Type "${b.value}" into the "${b.label ?? 'text'}" field`);
    }
  }
  return out;
}

/** Kane is an agent: without this it improvises (adds items, retries after errors). */
export const STRICT =
  'Follow these steps exactly, in order. Do not add, remove or change anything that is not in a step. If an error appears, do not retry or work around it.';

export function toObjective(r: Repro): string {
  const lines = [STRICT, ...r.steps.map((s, i) => `${i + 1}. ${s.text}`)];
  lines.push(`${r.steps.length + 1}. ${r.expectation}`);
  return lines.join('\n');
}

const asSteps = (texts: string[]): Step[] => texts.map((text, i) => ({ id: i + 1, text }));

export const GENERIC_EXPECTATION = 'Verify the last step completes successfully and no error message is shown';

/**
 * The expectation must name an outcome only. If it mentions a value the steps type or act on
 * ("...with the WELCOME20 code applied"), Kane performs that action itself, and the minimizer
 * then happily deletes the real steps. Such expectations are replaced with a neutral one.
 */
export function cleanExpectation(expectation: string, steps: Step[]): string {
  const values = new Set<string>();
  for (const s of steps) {
    for (const m of s.text.matchAll(/Type "([^"]+)"|for "([^"]+)"/g)) {
      const v = (m[1] ?? m[2]).trim().toLowerCase();
      if (v.length >= 3) values.add(v);
    }
  }
  const e = expectation.toLowerCase();
  for (const v of values) if (e.includes(v)) return GENERIC_EXPECTATION;
  return expectation;
}

const SCHEMA = {
  type: 'object',
  properties: {
    steps: { type: 'array', items: { type: 'string' } },
    expectation: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['steps', 'expectation', 'title'],
};

const RULES = `Rules for steps:
- Each step is one short imperative browser action a test agent can do alone ("Click \\"Add to cart\\" for \\"Tea Tin\\"").
- Keep every action that could change app state (cart, form values, codes, quantities). Drop pure scrolling/hover noise.
- Keep the user's order. Use exact visible texts and typed values from the session.
- Keep "(opens /path)" hints on clicks: they tell the agent which element was clicked (a link, not a button).
- Do not include the start URL as a step; the run starts on it.
The expectation is ONE "Verify ..." sentence describing what SHOULD happen if the app worked
(so it fails while the bug exists). Name the user-visible outcome, e.g. "Verify the order confirmation page appears".
The expectation must NOT mention any item, code, typed value or action: those belong in the steps only,
otherwise the test agent performs them itself.
title: a short bug title (max 8 words).`;

export async function draftRepro(inc: Incident): Promise<Repro & { title: string }> {
  const crumbs = breadcrumbSteps(inc);
  const fallback = {
    steps: asSteps(crumbs),
    expectation: 'Verify the last action completes successfully with no error message shown',
    title: inc.report?.slice(0, 60) ?? 'User hit an error',
  };
  if (!llmEnabled()) return fallback;
  const prompt = `Turn this captured user session into a reproduction script for a browser test agent.

App origin: ${inc.origin}
User report: ${inc.report ?? '(none)'}
Session actions (in order):
${crumbs.map((c, i) => `${i + 1}. ${c}`).join('\n')}
Errors the user hit:
${inc.failedRequests.map((r) => `- ${r.method} ${pathOf(r.url)} -> ${r.status}`).join('\n') || '- none'}
${inc.consoleErrors.map((c) => `- console: ${c.text}`).join('\n')}

${RULES}`;
  try {
    const r = await askJson<{ steps: string[]; expectation: string; title: string }>(prompt, SCHEMA);
    if (!r.steps?.length) return fallback;
    const steps = asSteps(r.steps);
    return { steps, expectation: cleanExpectation(r.expectation, steps), title: r.title };
  } catch {
    return fallback;
  }
}

/** Closed loop: Kane's trace and verdict go back to the model to fix the script. */
export async function reviseRepro(inc: Incident, prev: Repro, run: RunRecord): Promise<Repro> {
  if (!llmEnabled()) return prev;
  const prompt = `A browser test agent (Kane) ran this reproduction script but did NOT hit the user's bug.

Script:
${toObjective(prev)}

Kane result: ${run.status}. ${run.why}
Kane summary: ${run.summary.slice(0, 1200)}
Kane steps:
${run.steps.map((s) => `- [${s.status}] ${s.remark}`).join('\n')}

The user's bug signature (what must happen for a match):
${inc.failedRequests.map((r) => `- ${r.method} ${pathOf(r.url)} -> ${r.status}`).join('\n') || '- none'}
${inc.consoleErrors.map((c) => `- console: ${c.text}`).join('\n')}
User report: ${inc.report ?? '(none)'}
Original session actions:
${breadcrumbSteps(inc)
  .map((c, i) => `${i + 1}. ${c}`)
  .join('\n')}

Revise the script so the agent follows the user's path exactly and reaches the failing action.
${RULES}`;
  try {
    const r = await askJson<{ steps: string[]; expectation: string }>(prompt, SCHEMA);
    if (!r.steps?.length) return prev;
    const steps = asSteps(r.steps);
    return { steps, expectation: cleanExpectation(r.expectation, steps) };
  } catch {
    return prev;
  }
}
