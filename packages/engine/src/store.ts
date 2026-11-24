// File-based store under .proof/ so the CLI, the server and the Stop hook share state with no DB.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Incident, RunRecord, TimelineEvent } from './types.ts';

export const PROOF_DIR = resolve(process.env.PROOF_HOME ?? '.proof');

export const incidentDir = (id: string) => join(PROOF_DIR, 'incidents', id);
export const runDir = (incidentId: string, runId: string) => join(incidentDir(incidentId), 'runs', runId);

export function saveIncident(inc: Incident): void {
  mkdirSync(incidentDir(inc.id), { recursive: true });
  writeFileSync(join(incidentDir(inc.id), 'incident.json'), JSON.stringify(inc, null, 2));
}

export function loadIncident(id: string): Incident {
  return JSON.parse(readFileSync(join(incidentDir(id), 'incident.json'), 'utf8'));
}

/** Change some fields of a stored incident. Re-reads first: the server and the CLI both write. */
export function patchIncident(id: string, patch: Partial<Incident>): Incident {
  const next = { ...loadIncident(id), ...patch };
  saveIncident(next);
  return next;
}

export function listIncidents(): Incident[] {
  const root = join(PROOF_DIR, 'incidents');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((id) => existsSync(join(root, id, 'incident.json')))
    .map((id) => loadIncident(id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function emit(incidentId: string, ev: Omit<TimelineEvent, 't'> & { t?: string }): TimelineEvent {
  const full = { ...ev, t: ev.t ?? new Date().toISOString() } as TimelineEvent;
  mkdirSync(incidentDir(incidentId), { recursive: true });
  appendFileSync(join(incidentDir(incidentId), 'timeline.ndjson'), `${JSON.stringify(full)}\n`);
  if (process.env.PROOF_QUIET !== '1') {
    console.error(`[${full.t.slice(11, 19)}] ${full.stage.padEnd(14)} ${full.message}`);
  }
  return full;
}

export function timeline(incidentId: string): TimelineEvent[] {
  const f = join(incidentDir(incidentId), 'timeline.ndjson');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function saveRun(incidentId: string, run: RunRecord): void {
  const d = runDir(incidentId, run.id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'run.json'), JSON.stringify(run, null, 2));
}

export function listRuns(incidentId: string): RunRecord[] {
  const root = join(incidentDir(incidentId), 'runs');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((r) => existsSync(join(root, r, 'run.json')))
    .map((r) => JSON.parse(readFileSync(join(root, r, 'run.json'), 'utf8')) as RunRecord)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function writeJson(incidentId: string, name: string, data: unknown): void {
  mkdirSync(incidentDir(incidentId), { recursive: true });
  writeFileSync(join(incidentDir(incidentId), name), JSON.stringify(data, null, 2));
}

export function readJson<T>(incidentId: string, name: string): T | null {
  const f = join(incidentDir(incidentId), name);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
}
