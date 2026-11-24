// Claude Code Stop hook: the agent cannot finish while the Kane regression suite (which holds
// every repro Proof ever locked) or the unit tests are red. Failures go back to the agent.
//
// .claude/settings.json in the target repo:
//   { "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "proof hook-stop", "timeout": 900 } ] } ] } }

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { runRegression } from './regression.ts';
import { git, loadConfig, sh, startApp } from './target.ts';
import { pool } from './verify.ts';

export type StopInput = { session_id?: string; cwd?: string; stop_hook_active?: boolean };
export type StopDecision = { block: boolean; reason: string };

const MAX_BLOCKS = Number(process.env.PROOF_HOOK_MAX_BLOCKS ?? 3);

const exec = promisify(execFile);

/**
 * Content id of the whole working tree (untracked files included, .gitignore respected). What
 * Kane writes while running the suite (`output-<test>/`, `.testmuai/`) is skipped.
 */
export async function workTree(cwd: string, gitDir: string, regressions: string): Promise<string> {
  const index = join(gitDir, `proof-hook-index-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    await exec('git', ['add', '-A', '--', '.', `:(exclude)${regressions}/output-*`, ':(exclude).testmuai'], {
      cwd,
      env,
    });
    return (await exec('git', ['write-tree'], { cwd, env })).stdout.trim();
  } finally {
    rmSync(index, { force: true });
  }
}

export async function stopHook(input: StopInput): Promise<StopDecision> {
  const cwd = input.cwd ?? process.cwd();
  if (!existsSync(join(cwd, 'proof.config.json'))) return { block: false, reason: 'no proof.config.json' };
  const cfg = loadConfig(cwd);
  // State lives in the git dir: a file in the work tree would itself change the tree.
  const gitDir = resolve(cwd, (await git(cwd, 'rev-parse', '--git-dir')).trim());
  const stateFile = join(gitDir, 'proof-hook.json');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};

  // Skip when nothing changed since the last green run.
  const tree = await workTree(cwd, gitDir, cfg.regressions);
  if (state.greenTree === tree) return { block: false, reason: 'unchanged since last green run' };

  const sessionBlocks = state.session === input.session_id ? (state.blocks ?? 0) : 0;
  if (sessionBlocks >= MAX_BLOCKS) {
    return {
      block: false,
      reason: `Proof: still red after ${MAX_BLOCKS} attempts; letting you stop. Run \`proof hook-stop\` manually.`,
    };
  }

  const failures: string[] = [];
  if (cfg.unit) {
    const u = await sh(cfg.unit, cwd, 300_000);
    if (!u.ok) failures.push(`Unit tests failed (\`${cfg.unit}\`):\n${u.out.slice(-1500)}`);
  }
  const dir = join(cwd, cfg.regressions);
  const tests = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('_test.md')) : [];
  if (tests.length) {
    const app = await startApp(cwd, cfg);
    try {
      const results = await pool(tests, 3, async (f) => ({ f, r: await runRegression(join(dir, f), app.url) }));
      for (const { f, r } of results) {
        if (r.status === 'passed') continue;
        const failed = r.steps.filter((s) => s.status === 'failed').map((s) => s.remark);
        failures.push(
          `Kane regression \`${cfg.regressions}/${f}\` ${r.status}${failed.length ? `: ${failed.join('; ')}` : ''}${r.shareUrl ? ` (${r.shareUrl})` : ''}`,
        );
      }
    } finally {
      await app.stop();
    }
  }

  if (!failures.length) {
    writeFileSync(stateFile, JSON.stringify({ greenTree: tree, at: new Date().toISOString() }));
    return { block: false, reason: `Proof: ${tests.length} Kane regression test(s) and unit tests green.` };
  }
  writeFileSync(stateFile, JSON.stringify({ ...state, session: input.session_id, blocks: sessionBlocks + 1 }));
  return {
    block: true,
    reason: `Proof blocked stop: the change breaks verified behavior.\n\n${failures.join('\n\n')}\n\nFix the application code. Do not edit ${cfg.protected.join(', ')}: they are locked repros of real user bugs.`,
  };
}
