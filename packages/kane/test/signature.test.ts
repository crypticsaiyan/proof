import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fromEvidenceLines, fromPackLogs, httpKey, matchSignature, merge } from '../src/signature.ts';

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const runEnd = fx('bug-a.ndjson')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .find((e) => e.type === 'run_end');

test('httpKey drops host and query', () => {
  assert.equal(httpKey('post', 'https://shop.example/api/checkout?x=1', 500), 'POST /api/checkout 500');
});

test('parses Kane bug-detection evidence lines from a real run_end', () => {
  const sig = fromEvidenceLines(runEnd.summary);
  assert.deepEqual(sig.http, ['POST /api/checkout 500']);
  assert.ok(sig.console.some((c) => c.includes('[checkout] failed: Internal error')));
});

test('parses HAR + console from a real evidence pack', () => {
  const sig = fromPackLogs(JSON.parse(fx('bug-a.har')), fx('bug-a.console.ndjson'));
  assert.ok(sig.http.includes('POST /api/checkout 500'));
  assert.ok(!sig.console.some((c) => c.includes('favicon')));
  assert.ok(sig.console.some((c) => c.includes('[checkout] failed')));
});

test('matches user session signature against Kane failure', () => {
  const kane = merge({ reasonCode: runEnd.reason_code, http: [], console: [] }, fromEvidenceLines(runEnd.summary));
  const user = { http: ['POST /api/checkout 500'], console: [] };
  assert.equal(matchSignature(user, kane).matched, true);
  const consoleOnly = { http: [], console: ['[checkout] failed: Internal error'] };
  assert.equal(matchSignature(consoleOnly, kane).matched, true);
  const other = { http: ['GET /api/cart 404'], console: ['TypeError: x is undefined'] };
  assert.equal(matchSignature(other, kane).matched, false);
});

test('parses network_failure evidence lines (Kane 0.10.6 variant)', () => {
  const sig = fromEvidenceLines(
    'x\nevidence: network_failure: POST http://localhost:3100/api/checkout -> 500 body: {"error":"x"}',
  );
  assert.deepEqual(sig.http, ['POST /api/checkout 500']);
});
