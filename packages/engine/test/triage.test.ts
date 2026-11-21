import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.PROOF_HOME = mkdtempSync(join(tmpdir(), 'proof-triage-'));
process.env.PROOF_LLM = 'off';
process.env.PROOF_QUIET = '1';
const { clusterKey, severityOf, triage } = await import('../src/triage.ts');

const base = {
  source: 'sdk' as const,
  project: 'shop',
  origin: 'https://shop.example',
  breadcrumbs: [{ t: 1, kind: 'nav' as const, url: 'https://shop.example/checkout' }],
  consoleErrors: [{ text: '[checkout] failed: Internal error' }],
  failedRequests: [{ method: 'POST', url: 'https://shop.example/api/checkout', status: 500 }],
};

test('cluster key ignores host and numeric ids', () => {
  const a = clusterKey({
    ...base,
    failedRequests: [{ method: 'post', url: 'https://a.example/api/order/123', status: 500 }],
  });
  const b = clusterKey({
    ...base,
    failedRequests: [{ method: 'POST', url: 'http://localhost:3100/api/order/9', status: 500 }],
  });
  assert.equal(a, b);
});

test('5xx on a money path is critical', () => {
  assert.equal(severityOf({ ...base, id: 'x', createdAt: '' }), 'critical');
  assert.equal(severityOf({ ...base, id: 'x', createdAt: '', failedRequests: [], consoleErrors: [] }), 'minor');
});

test('duplicates fold into the open incident', async () => {
  const first = await triage({ ...base, report: 'cannot pay' });
  const second = await triage({ ...base, reporter: { email: 'b@example.com' } });
  assert.equal(second.duplicateOf, first.incident.id);
  assert.equal(second.count, 2);
});

test('expectation that names a step value is neutralized', async () => {
  const { cleanExpectation, GENERIC_EXPECTATION } = await import('../src/objective.ts');
  const steps = [
    { id: 1, text: 'Click "Add to cart" for "Tea Tin" (opens /cart)' },
    { id: 2, text: 'Type "WELCOME20" into the "Promo code" field' },
  ];
  assert.equal(
    cleanExpectation('Verify the order confirmation page appears with the WELCOME20 code applied', steps),
    GENERIC_EXPECTATION,
  );
  assert.equal(
    cleanExpectation('Verify the order confirmation page appears', steps),
    'Verify the order confirmation page appears',
  );
});
