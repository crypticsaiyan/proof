// Blast radius: run variants of the minimal repro (other products, quantities, codes) through
// Kane and map who else is affected. Variants come from the cheap model, grounded in the live
// page text so it only proposes things that exist.

import { askJson, llmEnabled } from './llm.ts';
import { toObjective } from './objective.ts';
import { emit, writeJson } from './store.ts';
import type { Incident, Repro } from './types.ts';
import { incidentSignature, PARALLEL, pool, verify } from './verify.ts';

export type Variant = { label: string; dimension: string; steps: string[] };
export type BlastRow = Variant & { affected: boolean; status: string; why: string; runId: string };

async function pageText(url: string): Promise<string> {
  try {
    const html = await (await fetch(url)).text();
    return html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 4000);
  } catch {
    return '';
  }
}

export async function proposeVariants(inc: Incident, minimal: Repro, url: string, max = 5): Promise<Variant[]> {
  if (!llmEnabled()) return [];
  const text = await pageText(url);
  const r = await askJson<{ variants: Variant[] }>(
    `A bug reproduces with these steps:
${minimal.steps.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}
Then: ${minimal.expectation}
Bug: ${inc.title ?? ''}. ${inc.report ?? ''}

The app's start page text (use only items that exist here):
${text}

Never invent products, codes or values: use only names from the page text above and codes or values
that already appear in the steps.
Propose up to ${max} variants to map the blast radius. Each variant changes exactly ONE thing
(a different product, quantity, or code) and keeps the rest identical. Include variants you expect
to be affected AND variants you expect to be safe, so the map has a boundary.
label: short (e.g. "Matcha Whisk instead of Tea Tin"). dimension: product|quantity|code|other.
steps: the full modified step list (same style as above, without the final verify).`,
    {
      type: 'object',
      properties: {
        variants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              dimension: { type: 'string' },
              steps: { type: 'array', items: { type: 'string' } },
            },
            required: ['label', 'dimension', 'steps'],
          },
        },
      },
      required: ['variants'],
    },
  );
  return (r.variants ?? []).filter((v) => v.steps?.length).slice(0, max);
}

export async function blastRadius(inc: Incident, minimal: Repro, opts: { url: string; max?: number }) {
  emit(inc.id, { stage: 'blast', message: 'Mapping blast radius: proposing variants of the minimal repro' });
  const variants = await proposeVariants(inc, minimal, opts.url, opts.max);
  const expected = incidentSignature(inc);
  const rows = await pool(variants, PARALLEL, async (v): Promise<BlastRow> => {
    const run = await verify({
      incident: inc,
      kind: 'blast',
      label: v.label,
      objective: toObjective({
        steps: v.steps.map((text, i) => ({ id: i + 1, text })),
        expectation: minimal.expectation,
      }),
      url: opts.url,
      expected,
      record: false,
    });
    return { ...v, affected: run.matched, status: run.status, why: run.why, runId: run.id };
  });
  const hit = rows.filter((r) => r.affected).length;
  writeJson(inc.id, 'blast.json', { rows, at: new Date().toISOString() });
  emit(inc.id, {
    stage: 'blast',
    message: `Blast radius: ${hit}/${rows.length} variants hit the same bug (${rows
      .filter((r) => r.affected)
      .map((r) => r.label)
      .join('; ')})`,
  });
  return rows;
}
