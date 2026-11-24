import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { workTree } from '../src/hook.ts';
import { milestonesOf } from '../src/milestones.ts';
import { redactPack, redactText } from '../src/redact.ts';
import { type Entry, winReason } from '../src/tournament.ts';
import type { TimelineEvent } from '../src/types.ts';

const ev = (t: string, stage: TimelineEvent['stage']): TimelineEvent => ({ t, stage, message: '' });

test('milestones come from the last cycle, never mixed with an earlier tournament', () => {
  const m = milestonesOf([
    ev('01', 'captured'),
    ev('02', 'reproduced'),
    ev('03', 'minimized'),
    ev('04', 'locked'),
    ev('05', 'fixed'),
    ev('06', 'verified'),
    ev('07', 'shipped'),
    ev('08', 'error'),
    ev('09', 'minimizing'),
    ev('10', 'minimized'),
    ev('11', 'locked'),
    ev('12', 'fixed'),
    ev('13', 'verified'),
    ev('14', 'shipped'),
    ev('15', 'shipped'),
    ev('16', 'prod_verified'),
    ev('17', 'reopened'),
  ]);
  assert.deepEqual(m, {
    captured: '01',
    reproduced: '02',
    minimized: '10',
    fixed: '12',
    verified: '13',
    shipped: '14',
    prodVerified: '16',
    reopened: '17',
  });
});

test('restarting a stage clears everything after it', () => {
  const m = milestonesOf([ev('1', 'reproduced'), ev('2', 'minimized'), ev('3', 'fixed'), ev('4', 'minimizing')]);
  assert.deepEqual(m, { reproduced: '1' });
});

test('redaction removes home paths and real emails, keeps fictional ones', () => {
  assert.equal(
    redactText('/home/alice/x "/Users/bob/y" alice@corp.io maya@example.com', '/home/alice'),
    '/home/user/x "/home/user/y" redacted@example.com maya@example.com',
  );
});

test('redactPack rewrites text entries inside the zip', async () => {
  const d = mkdtempSync(join(tmpdir(), 'proof-t-'));
  mkdirSync(join(d, 'p/logs'), { recursive: true });
  writeFileSync(join(d, 'p/logs/tui.log'), 'path /home/alice/.kane user alice@corp.io');
  writeFileSync(join(d, 'p/ok.txt'), 'fine');
  execFileSync('zip', ['-q', '-r', '../a.evidence', '.'], { cwd: join(d, 'p') });
  assert.equal(await redactPack(join(d, 'a.evidence'), join(d, 'b.evidence')), 1);
  const out = execFileSync('unzip', ['-p', join(d, 'b.evidence'), 'logs/tui.log']).toString();
  assert.equal(out, 'path /home/user/.kane user redacted@example.com');
  rmSync(d, { recursive: true });
});

test('a tie is reported as a tie', () => {
  const e = (agent: string, added: number, removed: number) =>
    ({ agent, label: agent, added, removed, passed: true }) as unknown as Entry;
  const w = e('claude', 2, 0);
  assert.equal(winReason([w, e('codex', 1, 1)], w), 'tied on diff size with codex, faster to fix');
  assert.equal(winReason([w, e('haiku', 3, 0)], w), 'smallest passing diff');
});

test('stop hook tree id sees untracked edits, ignores Kane recordings', async () => {
  const d = mkdtempSync(join(tmpdir(), 'proof-t-'));
  execFileSync('git', ['init', '-q'], { cwd: d });
  writeFileSync(join(d, 'a.js'), '1');
  const id = () => workTree(d, join(d, '.git'), 'tests/regressions');
  const one = await id();
  mkdirSync(join(d, 'tests/regressions/output-x'), { recursive: true });
  writeFileSync(join(d, 'tests/regressions/output-x/rec.json'), '{}');
  mkdirSync(join(d, '.testmuai'));
  writeFileSync(join(d, '.testmuai/x.evidence'), 'z');
  assert.equal(await id(), one);
  writeFileSync(join(d, 'a.js'), '2');
  assert.notEqual(await id(), one);
  rmSync(d, { recursive: true });
});
