// Fix tournament: N agents fix the bug in parallel worktrees; Kane judges every candidate.
// Pass = locked repro now passes + Kane regression suite green + unit tests green + no tampering.
// Winner = smallest passing diff. Failed candidates get Kane's verdict back for one more round.
// Then the revert check: un-apply the winning patch and Kane must fail the same way again.

import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { AGENTS, type AgentId, fixPrompt, runAgent } from './agents.ts';
import { assertLocked, type Lock, lockRepro, tamperedCopy } from './lock.ts';
import { runRegression } from './regression.ts';
import { type Review, reviewPatch } from './review.ts';
import { emit, incidentDir, writeJson } from './store.ts';
import { diffAgainst, git, isProtected, loadConfig, type ProofConfig, sh, startApp } from './target.ts';
import type { Incident, Repro, RunRecord } from './types.ts';
import { incidentSignature, verify } from './verify.ts';

export type RegressionResult = {
  test: string;
  status: string;
  durationS: number;
  shareUrl?: string;
  attempts?: number;
};

export type Entry = {
  agent: AgentId;
  label: string;
  model: string;
  branch: string;
  worktree: string;
  round: number;
  agentSummary: string;
  agentDurationS: number;
  files: { path: string; status: string; added: number; removed: number }[];
  added: number;
  removed: number;
  patchFile: string;
  tampered: string[];
  unit?: { ok: boolean; tail: string };
  judgeRunId?: string;
  judgeStatus?: string;
  judgeVideo?: string;
  judgeAttempts?: number;
  /** Kane hit the user's own failure while judging. */
  hitBug?: boolean;
  review?: Review;
  regressions: RegressionResult[];
  passed: boolean;
  reason: string;
};

export type TournamentResult = {
  base: string;
  baseSha: string;
  lock: Lock;
  entries: Entry[];
  winner?: Entry;
  revert?: { runId: string; status: string; matched: boolean; why: string; video?: string };
};

export const sizeOf = (e: Entry) => e.added + e.removed;

/** How the winner won, in words that stay true when diffs tie. */
export function winReason(entries: Entry[], w: Entry): string {
  const tied = entries.filter((e) => e.passed && e.agent !== w.agent && sizeOf(e) === sizeOf(w));
  return tied.length
    ? `tied on diff size with ${tied.map((e) => e.label).join(' and ')}, faster to fix`
    : 'smallest passing diff';
}

async function prepareWorktree(repo: string, dir: string, branch: string, base: string) {
  if (existsSync(dir)) await git(repo, 'worktree', 'remove', '--force', dir).catch(() => {});
  await git(repo, 'worktree', 'add', '-f', '-B', branch, dir, base);
  // Share dependencies; keep the symlink out of diffs.
  const common = resolve(repo, (await git(repo, 'rev-parse', '--git-common-dir')).trim());
  const exclude = join(common, 'info', 'exclude');
  mkdirSync(join(common, 'info'), { recursive: true });
  const cur = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!/^node_modules$/m.test(cur)) appendFileSync(exclude, `${cur.endsWith('\n') || !cur ? '' : '\n'}node_modules\n`);
  const nm = join(repo, 'node_modules');
  if (existsSync(nm) && !existsSync(join(dir, 'node_modules'))) symlinkSync(nm, join(dir, 'node_modules'));
}

/** Copy the trusted regression suite (+ cached recordings) and the locked repro to a scratch dir. */
function stageSuite(repo: string, cfg: ProofConfig, lock: Lock, into: string): string[] {
  mkdirSync(into, { recursive: true });
  const src = join(repo, cfg.regressions);
  if (existsSync(src)) cpSync(src, into, { recursive: true });
  return readdirSync(into)
    .filter((f) => f.endsWith('_test.md') && f !== lock.repoPath.split('/').pop())
    .map((f) => join(into, f));
}

async function judge(
  inc: Incident,
  e: Entry,
  ctx: { repo: string; base: string; cfg: ProofConfig; lock: Lock; rca?: string },
): Promise<Entry> {
  e.review = undefined;
  e.hitBug = undefined;
  const d = await diffAgainst(e.worktree, ctx.base);
  e.files = d.files;
  e.added = d.added;
  e.removed = d.removed;
  writeFileSync(e.patchFile, d.patch);
  e.tampered = d.files.filter((f) => isProtected(f.path, ctx.cfg.protected)).map((f) => f.path);
  if (tamperedCopy(e.worktree, ctx.lock)) e.tampered.push(ctx.lock.repoPath);
  if (e.tampered.length) return fail(e, `DISQUALIFIED: modified locked paths ${e.tampered.join(', ')}`);
  if (!d.files.length) return fail(e, 'no code change');

  if (ctx.cfg.unit) {
    const u = await sh(ctx.cfg.unit, e.worktree);
    e.unit = { ok: u.ok, tail: u.out.slice(-1200) };
  }

  const objective = assertLocked(ctx.lock);
  const app = await startApp(e.worktree, ctx.cfg);
  try {
    const suite = stageSuite(ctx.repo, ctx.cfg, ctx.lock, join(incidentDir(inc.id), 'suite', `${e.agent}-r${e.round}`));
    const [run, regressions] = await Promise.all([
      judgeRepro(inc, e, objective, app.url),
      Promise.all(
        suite.map(async (file): Promise<RegressionResult> => {
          const r = await runRegression(file, app.url);
          return {
            test: file.split('/').pop() ?? file,
            status: r.status,
            durationS: r.durationS,
            shareUrl: r.shareUrl,
            attempts: r.attempts,
          };
        }),
      ),
    ]);
    e.judgeRunId = run.id;
    e.judgeStatus = run.status;
    e.judgeVideo = run.captioned ?? run.video;
    e.regressions = regressions;
    const redSuite = regressions.filter((r) => r.status !== 'passed');
    e.judgeAttempts = run.attempts;
    e.hitBug = run.matched;
    if (run.matched) return fail(e, `Kane still hits the bug: ${run.why}`);
    if (run.status !== 'passed') return fail(e, `Kane repro still fails: ${run.oneLiner || run.summary.slice(0, 200)}`);
    if (redSuite.length)
      return fail(e, `regression suite red: ${redSuite.map((r) => `${r.test} ${r.status}`).join(', ')}`);
    if (e.unit && !e.unit.ok) return fail(e, `unit tests fail: ${e.unit.tail.slice(-300)}`);
    e.review = await reviewPatch(inc, d.patch, ctx.rca);
    if (e.review.verdict === 'masks-symptom') return fail(e, `masks the symptom: ${e.review.why}`);
    e.passed = true;
    e.reason = `repro green${run.attempts > 1 ? ` on attempt ${run.attempts}` : ''}, ${regressions.length} regression test(s) green${e.unit ? ', unit green' : ''}${e.review.verdict === 'root-cause' ? ', review: root cause' : ', not reviewed'}`;
    return e;
  } finally {
    await app.stop();
  }
}

/**
 * A red run that does NOT show the user's failure is not a verdict on the fix (Kane skipped a field,
 * timed out, or the script itself is wrong): run it once more. Hitting the user's bug is final.
 */
async function judgeRepro(inc: Incident, e: Entry, objective: string, url: string) {
  for (let attempt = 1; ; attempt++) {
    const run = await verify({
      incident: inc,
      kind: 'judge',
      label: `${e.label} round ${e.round}${attempt > 1 ? ' (retry)' : ''}`,
      objective,
      url,
      expected: incidentSignature(inc),
    });
    if (run.matched || run.status === 'passed' || attempt === 2) return { ...run, attempts: attempt };
    emit(inc.id, {
      stage: 'info',
      message: `Kane could not finish the script judging ${e.label}, and the user's failure did not appear; judging once more`,
      data: { runId: run.id },
    });
  }
}

function fail(e: Entry, reason: string): Entry {
  e.passed = false;
  e.reason = reason;
  return e;
}

export async function tournament(
  inc: Incident,
  minimal: Repro,
  opts: { repo: string; base?: string; agents?: AgentId[]; rounds?: number; rca?: string; observed?: string },
): Promise<TournamentResult> {
  const repo = resolve(opts.repo);
  const base = opts.base ?? 'main';
  const cfg = loadConfig(repo);
  const baseSha = (await git(repo, 'rev-parse', base)).trim();
  const lock = lockRepro(inc, minimal, cfg.regressions);
  emit(inc.id, { stage: 'locked', message: `Repro locked: ${lock.repoPath} sha256 ${lock.sha256.slice(0, 12)}` });

  const ids = opts.agents ?? (['claude', 'codex', 'haiku'] as AgentId[]);
  const wtRoot = join(incidentDir(inc.id), 'worktrees');
  mkdirSync(wtRoot, { recursive: true });
  const sig = incidentSignature(inc);
  const promptBase = {
    title: inc.title ?? inc.id,
    report: inc.report,
    steps: minimal.steps.map((s) => s.text),
    expectation: minimal.expectation,
    observed: opts.observed ?? 'the flow fails',
    failedRequests: sig.http,
    consoleErrors: sig.console,
    rca: opts.rca,
    protectedPaths: cfg.protected,
    unit: cfg.unit,
  };
  const ctx = { repo, base, cfg, lock, rca: opts.rca };

  emit(inc.id, {
    stage: 'fixing',
    message: `Tournament: ${ids.map((i) => AGENTS[i].label).join(' vs ')} (worktrees off ${base}@${baseSha.slice(0, 7)})`,
  });
  let entries: Entry[] = await Promise.all(
    ids.map(async (id) => {
      const spec = AGENTS[id];
      const branch = `proof/${inc.id}/${id}`;
      const worktree = join(wtRoot, id);
      await prepareWorktree(repo, worktree, branch, base);
      const a = await runAgent(spec, worktree, fixPrompt(promptBase));
      writeFileSync(join(wtRoot, `${id}.r1.log`), a.log);
      emit(inc.id, { stage: 'info', message: `${spec.label} finished in ${a.durationS}s; Kane judging` });
      const e: Entry = {
        agent: id,
        label: spec.label,
        model: spec.model,
        branch,
        worktree,
        round: 1,
        agentSummary: a.summary,
        agentDurationS: a.durationS,
        files: [],
        added: 0,
        removed: 0,
        patchFile: join(wtRoot, `${id}.patch`),
        tampered: [],
        regressions: [],
        passed: false,
        reason: a.ok ? '' : `agent error: ${a.summary.slice(0, 200)}`,
      };
      const j = await judge(inc, e, ctx);
      emit(inc.id, {
        stage: 'info',
        message: `Kane verdict for ${spec.label}: ${j.passed ? 'PASS' : 'FAIL'} (${j.reason}), diff +${j.added}/-${j.removed}`,
      });
      return j;
    }),
  );

  // Independent fixes that all remove the user's failure yet cannot finish the script point at the
  // script, not the fixes. Feeding that back would train agents to satisfy a wrong test.
  const tried = entries.filter((e) => e.judgeRunId && !e.tampered.length);
  if (tried.length >= 2 && tried.every((e) => e.hitBug === false && e.judgeStatus !== 'passed')) {
    const result: TournamentResult = { base, baseSha, lock, entries };
    writeJson(inc.id, 'tournament.json', result);
    emit(inc.id, {
      stage: 'error',
      message: `Locked repro is suspect: ${tried.length} independent fixes removed the user's failure but none could finish the script. Not pushing agents to satisfy it (${tried[0].reason})`,
    });
    return result;
  }

  // Closed loop: Kane's verdict goes back to agents that lost, once.
  for (let round = 2; round <= (opts.rounds ?? 2) && !entries.some((e) => e.passed); round++) {
    emit(inc.id, { stage: 'info', message: `No passing fix. Round ${round}: feeding Kane verdicts back to agents` });
    entries = await Promise.all(
      entries.map(async (e) => {
        if (e.tampered.length) return e;
        const feedback = `${e.reason}\nKane judge run: ${e.judgeRunId ?? 'n/a'}`;
        const a = await runAgent(AGENTS[e.agent], e.worktree, fixPrompt({ ...promptBase, feedback }));
        writeFileSync(join(wtRoot, `${e.agent}.r${round}.log`), a.log);
        e.round = round;
        e.agentSummary = a.summary;
        e.agentDurationS += a.durationS;
        const j = await judge(inc, e, ctx);
        emit(inc.id, {
          stage: 'info',
          message: `Round ${round} Kane verdict for ${e.label}: ${j.passed ? 'PASS' : 'FAIL'} (${j.reason})`,
        });
        return j;
      }),
    );
  }

  const winner = entries
    .filter((e) => e.passed)
    .sort((a, b) => sizeOf(a) - sizeOf(b) || a.agentDurationS - b.agentDurationS)[0];
  const result: TournamentResult = { base, baseSha, lock, entries, winner };
  if (!winner) {
    writeJson(inc.id, 'tournament.json', result);
    emit(inc.id, { stage: 'error', message: 'No agent produced a fix Kane accepts' });
    return result;
  }
  emit(inc.id, {
    stage: 'fixed',
    message: `Winner: ${winner.label}, +${winner.added}/-${winner.removed} lines across ${winner.files.length} file(s)`,
  });

  result.revert = await revertCheck(inc, winner, ctx);
  writeJson(inc.id, 'tournament.json', result);
  const proof = result.revert.matched;
  emit(inc.id, {
    stage: proof ? 'verified' : 'error',
    message: proof
      ? 'Triple proof: red before, green after, red again on revert (same failure signature)'
      : `Revert check inconclusive: ${result.revert.why}`,
  });
  return result;
}

/** Un-apply the winning patch; Kane must fail the same way, proving the fix is what fixed it. */
async function revertCheck(inc: Incident, w: Entry, ctx: { cfg: ProofConfig; lock: Lock }) {
  await git(w.worktree, 'apply', '-R', '--index', w.patchFile);
  const app = await startApp(w.worktree, ctx.cfg);
  let run: RunRecord | undefined;
  try {
    // One red run is the proof; a second attempt only guards against Kane missing it by luck.
    for (let i = 1; i <= 2 && !run?.matched; i++) {
      run = await verify({
        incident: inc,
        kind: 'revert',
        label: `Revert ${w.label} fix${i > 1 ? ` (attempt ${i})` : ''}`,
        objective: assertLocked(ctx.lock),
        url: app.url,
        expected: incidentSignature(inc),
      });
    }
  } finally {
    await app.stop();
    await git(w.worktree, 'apply', '--index', w.patchFile);
  }
  if (!run) throw new Error('revert check did not run');
  return { runId: run.id, status: run.status, matched: run.matched, why: run.why, video: run.captioned ?? run.video };
}
