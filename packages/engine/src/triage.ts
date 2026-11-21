// Triage: dedupe incoming sessions into clusters, rank severity, title them cheaply.

import { randomBytes } from 'node:crypto';
import { askJson, llmEnabled } from './llm.ts';
import { emit, listIncidents, saveIncident, writeJson } from './store.ts';
import type { Incident } from './types.ts';

const pathOf = (url: string, origin: string) => {
  try {
    return new URL(url, origin).pathname;
  } catch {
    return url;
  }
};

/** Same failing request (or same first console error) on the same project = same bug. */
export function clusterKey(
  inc: Pick<Incident, 'project' | 'origin' | 'failedRequests' | 'consoleErrors' | 'report'>,
): string {
  const req = inc.failedRequests
    .filter((r) => r.status >= 500 || r.status === 0)
    .map((r) => `${r.method.toUpperCase()} ${pathOf(r.url, inc.origin).replace(/\/\d+(?=\/|$)/g, '/:n')} ${r.status}`)
    .sort();
  if (req.length) return `${inc.project}|${req[0]}`;
  const con = inc.consoleErrors[0]?.text
    .replace(/\d+/g, 'N')
    .replace(/https?:\/\/\S+/g, '')
    .slice(0, 80);
  if (con) return `${inc.project}|console|${con}`;
  return `${inc.project}|report|${randomBytes(3).toString('hex')}`;
}

const MONEY_PATHS = /checkout|payment|order|cart|billing|subscribe/i;

export function severityOf(inc: Incident): 'critical' | 'major' | 'minor' {
  const failed5xx = inc.failedRequests.some((r) => r.status >= 500);
  const onMoneyPath = [...inc.failedRequests.map((r) => r.url), ...inc.breadcrumbs.map((b) => b.url ?? '')].some((u) =>
    MONEY_PATHS.test(u),
  );
  const rage = inc.breadcrumbs.some((b) => b.kind === 'rage');
  if (failed5xx && onMoneyPath) return 'critical';
  if (failed5xx || rage || inc.consoleErrors.length) return 'major';
  return 'minor';
}

export const newIncidentId = () => `inc-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;

export type TriageResult = { incident: Incident; duplicateOf?: string; count: number };

/**
 * Accept a captured session. Duplicates of an open incident are folded into it (count++,
 * extra reporters kept) instead of starting another reproduction.
 */
export async function triage(
  raw: Omit<Incident, 'id' | 'createdAt'> & Partial<Pick<Incident, 'id' | 'createdAt'>>,
): Promise<TriageResult> {
  const inc: Incident = { ...raw, id: raw.id ?? newIncidentId(), createdAt: raw.createdAt ?? new Date().toISOString() };
  inc.clusterKey = clusterKey(inc);
  inc.severity = severityOf(inc);
  const existing = listIncidents().find((i) => i.clusterKey === inc.clusterKey && i.id !== inc.id);
  if (existing) {
    const dupes = ((existing as Incident & { duplicates?: unknown[] }).duplicates ?? []) as unknown[];
    dupes.push({ at: inc.createdAt, report: inc.report, reporter: inc.reporter, replay: inc.replay });
    const updated = { ...existing, duplicates: dupes } as Incident;
    if (!updated.report && inc.report) {
      updated.report = inc.report;
      updated.reporter = inc.reporter;
    }
    saveIncident(updated);
    emit(existing.id, { stage: 'triaged', message: `Duplicate report folded in (${dupes.length + 1} users hit this)` });
    return { incident: updated, duplicateOf: existing.id, count: dupes.length + 1 };
  }
  saveIncident(inc);
  emit(inc.id, {
    t: inc.createdAt,
    stage: 'captured',
    message: `${inc.source}: ${inc.report ?? 'session with errors'} (${inc.breadcrumbs.length} events)`,
  });
  if (llmEnabled() && !inc.title) {
    try {
      const r = await askJson<{ title: string }>(
        `Write a short bug title (max 8 words, no trailing period) for this user session.
Report: ${inc.report ?? '(none)'}
Failed requests: ${inc.failedRequests.map((r) => `${r.method} ${pathOf(r.url, inc.origin)} ${r.status}`).join(', ') || 'none'}
Console errors: ${inc.consoleErrors.map((c) => c.text).join(' | ') || 'none'}
Last actions: ${inc.breadcrumbs
          .slice(-6)
          .map((b) => `${b.kind} ${b.text ?? b.label ?? b.url ?? ''} ${b.value ?? ''}`)
          .join('; ')}`,
        { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        { timeoutMs: 30_000 },
      );
      inc.title = r.title;
      saveIncident(inc);
    } catch {}
  }
  emit(inc.id, {
    stage: 'triaged',
    message: `${inc.severity?.toUpperCase()}: ${inc.title ?? 'untitled'} (new cluster)`,
  });
  writeJson(inc.id, 'triage.json', { clusterKey: inc.clusterKey, severity: inc.severity });
  return { incident: inc, count: 1 };
}
