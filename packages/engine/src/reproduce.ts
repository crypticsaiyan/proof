// Reproduce: session -> Kane objective -> run until Kane fails the SAME way -> confirm 3x.

import { draftRepro, reviseRepro, toObjective } from './objective.ts';
import { emit, patchIncident, writeJson } from './store.ts';
import type { Incident, Repro, RunRecord } from './types.ts';
import { incidentSignature, PARALLEL, pool, verify } from './verify.ts';

export type ReproResult = {
  verdict: 'confirmed' | 'flaky' | 'not_reproduced';
  repro: Repro;
  hits: number;
  of: number;
  runs: RunRecord[];
};

export async function reproduce(
  inc: Incident,
  opts: { url: string; maxAttempts?: number; confirmations?: number },
): Promise<ReproResult> {
  const expected = incidentSignature(inc);
  const runs: RunRecord[] = [];
  emit(inc.id, {
    stage: 'reproducing',
    message: `Drafting Kane objective from ${inc.breadcrumbs.length} session events`,
  });
  const draft = await draftRepro(inc);
  if (!inc.title) {
    inc.title = draft.title;
    patchIncident(inc.id, { title: draft.title });
  }
  let repro: Repro = { steps: draft.steps, expectation: draft.expectation };
  emit(inc.id, {
    stage: 'info',
    message: `Objective: ${repro.steps.length} steps + check`,
    data: { objective: toObjective(repro) },
  });

  const maxAttempts = opts.maxAttempts ?? 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const run = await verify({
      incident: inc,
      kind: 'reproduce',
      label: `Attempt ${attempt}`,
      objective: toObjective(repro),
      url: opts.url,
      expected,
    });
    runs.push(run);
    emit(inc.id, {
      stage: 'info',
      message: `Attempt ${attempt}: Kane ${run.status}, ${run.matched ? 'MATCH' : 'no match'} (${run.why})`,
      data: { runId: run.id },
    });
    if (run.matched) {
      const n = (opts.confirmations ?? 3) - 1;
      emit(inc.id, { stage: 'info', message: `Signature matched. Confirming with ${n} more independent Kane runs` });
      const confirms = await pool(Array.from({ length: n }), PARALLEL, (_, i) =>
        verify({
          incident: inc,
          kind: 'confirm',
          label: `Confirm ${i + 2}/${n + 1}`,
          objective: toObjective(repro),
          url: opts.url,
          expected,
          record: false,
        }),
      );
      runs.push(...confirms);
      const hits = 1 + confirms.filter((r) => r.matched).length;
      const of = n + 1;
      const verdict = hits === of ? 'confirmed' : 'flaky';
      const result: ReproResult = { verdict, repro, hits, of, runs };
      writeJson(inc.id, 'repro.json', { ...result, runs: runs.map((r) => r.id) });
      emit(inc.id, {
        stage: verdict === 'confirmed' ? 'reproduced' : 'flaky',
        message: `${verdict === 'confirmed' ? 'Reproduced' : 'FLAKY'}: Kane failed the same way ${hits}/${of} runs`,
        data: { hits, of, runId: run.id },
      });
      return result;
    }
    if (attempt < maxAttempts) {
      repro = await reviseRepro(inc, repro, run);
      emit(inc.id, {
        stage: 'info',
        message: 'Fed Kane trace back to the model; objective revised',
        data: { objective: toObjective(repro) },
      });
    }
  }
  const result: ReproResult = { verdict: 'not_reproduced', repro, hits: 0, of: runs.length, runs };
  writeJson(inc.id, 'repro.json', { ...result, runs: runs.map((r) => r.id) });
  emit(inc.id, {
    stage: 'not_reproduced',
    message: `Could not reproduce in ${runs.length} Kane attempts. Evidence kept for each attempt`,
  });
  return result;
}
