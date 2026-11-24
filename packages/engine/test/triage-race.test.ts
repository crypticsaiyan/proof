import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.PROOF_HOME = mkdtempSync(join(tmpdir(), 'proof-race-'));
process.env.PROOF_LLM = 'off';
process.env.PROOF_QUIET = '1';
const { triage } = await import('../src/triage.ts');
const { loadIncident, patchIncident, timeline } = await import('../src/store.ts');

const raw = (o: object) => ({
  source: 'sdk' as const,
  project: 'p',
  origin: 'http://x',
  breadcrumbs: [],
  consoleErrors: [],
  failedRequests: [{ method: 'POST', url: 'http://x/api/checkout', status: 500 }],
  replay: 's1',
  ...o,
});

test('a late title does not wipe the report that arrived meanwhile, and one session is one user', async () => {
  const a = await triage(raw({}));
  const b = await triage(raw({ source: 'widget', report: 'cannot order', reporter: { email: 'm@example.com' } }));
  assert.equal(b.duplicateOf, a.incident.id);
  assert.equal(b.count, 1);
  patchIncident(a.incident.id, { title: 'late title' });
  const now = loadIncident(a.incident.id);
  assert.equal(now.report, 'cannot order');
  assert.equal(now.title, 'late title');
  const c = await triage(raw({ replay: 's2' }));
  assert.equal(c.count, 2);
  assert.ok(timeline(a.incident.id).some((e) => e.message.includes('same user')));
});

test('the same failure after a verified fix opens a new incident', async () => {
  const { emit } = await import('../src/store.ts');
  const a = await triage(raw({ project: 'q' }));
  emit(a.incident.id, { stage: 'prod_verified', message: '' });
  const b = await triage(raw({ project: 'q', replay: 's9' }));
  assert.equal(b.duplicateOf, undefined);
});
