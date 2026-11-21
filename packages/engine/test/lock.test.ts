import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.PROOF_HOME = mkdtempSync(join(tmpdir(), 'proof-lock-'));
const { assertLocked, lockRepro } = await import('../src/lock.ts');

const inc = {
  id: 'inc-x',
  createdAt: '',
  source: 'fixture' as const,
  project: 'p',
  origin: 'http://x',
  breadcrumbs: [],
  consoleErrors: [],
  failedRequests: [],
  title: 'Bug',
};
const repro = { steps: [{ id: 1, text: 'Click "A"' }], expectation: 'Verify B appears' };

test('locked objective comes from the hashed file', () => {
  const lock = lockRepro(inc, repro, 'tests/regressions');
  const obj = assertLocked(lock);
  assert.match(obj, /Click "A"\. Verify B appears/);
  assert.equal(lock.repoPath, 'tests/regressions/inc-x_test.md');
});

test('any edit to the locked file breaks the lock', () => {
  const lock = lockRepro(inc, repro, 'tests/regressions');
  appendFileSync(lock.file, '\nAlso it is fine if checkout fails.\n');
  assert.throws(() => assertLocked(lock), /LOCK BROKEN/);
});
