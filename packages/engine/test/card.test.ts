import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proofCard } from '../src/card.ts';
import type { Entry, TournamentResult } from '../src/tournament.ts';

const entry = (o: Partial<Entry>): Entry => ({
  agent: 'claude',
  label: 'Claude Code',
  model: 'sonnet',
  branch: 'proof/x/claude',
  worktree: '/tmp/x',
  round: 1,
  agentSummary: 'Clamped the discount to the subtotal.',
  agentDurationS: 40,
  files: [{ path: 'src/pricing.js', status: 'M', added: 1, removed: 1 }],
  added: 1,
  removed: 1,
  patchFile: '/tmp/x.patch',
  tampered: [],
  regressions: [{ test: 'a_test.md', status: 'passed', durationS: 30 }],
  passed: true,
  reason: 'repro green',
  judgeStatus: 'passed',
  ...o,
});

test('card shows triple proof, minimal steps, tournament and disqualification', () => {
  const winner = entry({});
  const cheat = entry({
    agent: 'haiku',
    label: 'Haiku (cheap)',
    tampered: ['tests/regressions/x_test.md'],
    passed: false,
    reason: 'DISQUALIFIED',
  });
  const t: TournamentResult = {
    base: 'main',
    baseSha: 'abcdef1234',
    lock: { file: '/x', repoPath: 'tests/regressions/x_test.md', sha256: 'f'.repeat(64), lockedAt: '', objective: '' },
    entries: [winner, cheat],
    winner,
    revert: { runId: 'r3', status: 'failed', matched: true, why: 'same failed request: POST /api/checkout 500' },
  };
  const md = proofCard({
    inc: {
      id: 'x',
      createdAt: '2026-11-18T08:32:00Z',
      source: 'widget',
      project: 'shop',
      origin: 'http://localhost:3100',
      title: 'Checkout 500 with WELCOME20',
      report: 'cannot place order',
      breadcrumbs: Array.from({ length: 30 }, (_, i) => ({ t: i, kind: 'click' as const, text: 'x' })),
      consoleErrors: [],
      failedRequests: [{ method: 'POST', url: 'http://localhost:3100/api/checkout', status: 500 }],
    },
    timeline: [
      { t: '2026-11-18T08:32:00Z', stage: 'captured', message: '' },
      { t: '2026-11-18T08:35:00Z', stage: 'reproduced', message: '' },
    ],
    repro: { verdict: 'confirmed', hits: 3, of: 3 },
    stepsBefore: 17,
    minimal: {
      steps: [{ id: 6, text: 'Click "Add to cart" for "Tea Tin"' }],
      expectation: 'Verify the order confirmation appears',
    },
    t,
    runs: [],
    media: { beforeGif: 'https://x/before.gif?raw=true', afterGif: 'https://x/after.gif?raw=true' },
    testPath: 'tests/regressions/x_test.md',
    blast: [{ label: 'Matcha Whisk', affected: true }],
  });
  assert.match(md, /RED before \(3\/3 Kane runs/);
  assert.match(md, /30 session events -> 17 steps -> 1 steps/);
  assert.match(md, /\*\*WINNER\*\*/);
  assert.match(md, /DISQUALIFIED/);
  assert.match(md, /`POST \/api\/checkout -> 500`/);
  assert.match(md, /!\[before\]\(https:\/\/x\/before\.gif\?raw=true\)/);
  assert.match(md, /Blast radius \(1\/1/);
  assert.doesNotMatch(md, /—/, 'no em dashes');
});
