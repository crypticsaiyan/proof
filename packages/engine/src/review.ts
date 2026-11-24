// Green in the browser is not enough: deleting a validation also makes an error go away. Every
// candidate Kane passes is read by a model that sees the bug and the diff, not the agent's
// explanation, and is asked a narrow question. Unavailable model = not reviewed, and shown as such.

import { askJson, llmEnabled } from './llm.ts';
import type { Incident } from './types.ts';

export type Review = { verdict: 'root-cause' | 'masks-symptom' | 'unreviewed'; why: string };

/** One vote is noisy (it has failed a correct clamp): three independent reads, majority decides. */
export async function reviewPatch(inc: Incident, patch: string, rca?: string): Promise<Review> {
  if (!llmEnabled()) return { verdict: 'unreviewed', why: 'model off' };
  return tally(await Promise.all([0, 1, 2].map(() => vote(inc, patch, rca))));
}

export function tally(votes: Review[]): Review {
  const of = (v: Review['verdict']) => votes.filter((x) => x.verdict === v);
  for (const v of ['masks-symptom', 'root-cause'] as const) {
    const n = of(v);
    if (n.length >= 2) return { verdict: v, why: `${n[0].why} (${n.length}/${votes.length} reviews)` };
  }
  return { verdict: 'unreviewed', why: 'reviews did not agree' };
}

async function vote(inc: Incident, patch: string, rca?: string): Promise<Review> {
  try {
    const r = await askJson<{ verdict: Review['verdict']; why: string }>(
      `You review a bug fix. Judge only the diff.

Bug: ${inc.title ?? inc.id}
User report: ${inc.report ?? '(none)'}
Failing request: ${inc.failedRequests.map((f) => `${f.method} ${f.url} -> ${f.status}`).join(', ') || 'none'}
Root cause found in the browser: ${rca ?? '(unknown)'}

Diff:
${patch.slice(0, 12_000)}

Answer "masks-symptom" if the diff makes the error disappear while the wrong state that caused it
still exists for users. Examples: it removes or loosens a validation, guard or error check; it
swallows an exception; it hides or fakes a value only at the last step (so what is shown, stored
and charged can disagree); it special-cases the reported input.
Answer "root-cause" if the wrong state can no longer be produced.
why: one plain sentence naming what the diff does.`,
      {
        type: 'object',
        properties: {
          verdict: { type: 'string', enum: ['root-cause', 'masks-symptom'] },
          why: { type: 'string' },
        },
        required: ['verdict', 'why'],
      },
    );
    return r;
  } catch (e) {
    return { verdict: 'unreviewed', why: e instanceof Error ? e.message.slice(0, 120) : 'review failed' };
  }
}
