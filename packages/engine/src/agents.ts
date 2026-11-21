// Fix agents for the tournament. Each runs headless in its own git worktree.
// Uses the developer's existing CLI logins (Claude Code, Codex): no API keys needed.

import { spawn } from 'node:child_process';

export type AgentId = 'claude' | 'codex' | 'haiku';

export type AgentSpec = {
  id: AgentId;
  label: string;
  model: string;
  argv: (prompt: string, cwd: string) => [string, string[]];
};

const claudeArgs =
  (model: string) =>
  (prompt: string): [string, string[]] => [
    'claude',
    [
      '-p',
      prompt,
      '--model',
      model,
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Read,Edit,Write,Grep,Glob,Bash(npm test:*),Bash(node --test:*),Bash(git diff:*),Bash(git status:*)',
      '--setting-sources',
      'project,local',
      '--no-session-persistence',
      '--output-format',
      'json',
    ],
  ];

export const AGENTS: Record<AgentId, AgentSpec> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    model: process.env.PROOF_CLAUDE_MODEL ?? 'sonnet',
    argv: (p) => claudeArgs(process.env.PROOF_CLAUDE_MODEL ?? 'sonnet')(p),
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    model: process.env.PROOF_CODEX_MODEL ?? 'default',
    argv: (p, cwd) => {
      const args = ['exec', '-s', 'workspace-write', '--skip-git-repo-check', '-C', cwd];
      if (process.env.PROOF_CODEX_MODEL) args.push('-m', process.env.PROOF_CODEX_MODEL);
      return ['codex', [...args, p]];
    },
  },
  haiku: {
    id: 'haiku',
    label: 'Haiku (cheap)',
    model: 'haiku',
    argv: (p) => claudeArgs('haiku')(p),
  },
};

export type AgentResult = { ok: boolean; summary: string; durationS: number; log: string };

export function runAgent(spec: AgentSpec, cwd: string, prompt: string, timeoutMs = 600_000): Promise<AgentResult> {
  const t0 = Date.now();
  const [bin, args] = spec.argv(prompt, cwd);
  return new Promise((res) => {
    const p = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => {
      out += d;
    });
    p.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
    });
    const t = setTimeout(() => p.kill('SIGTERM'), timeoutMs);
    p.on('error', (e) => {
      clearTimeout(t);
      res({ ok: false, summary: `failed to start ${bin}: ${e.message}`, durationS: 0, log: '' });
    });
    p.on('close', (code) => {
      clearTimeout(t);
      let summary = out.trim().split('\n').slice(-12).join('\n');
      try {
        const j = JSON.parse(out);
        summary = String(j.result ?? summary);
      } catch {}
      res({
        ok: code === 0,
        summary: summary.slice(-1500) || err.slice(-800),
        durationS: +((Date.now() - t0) / 1000).toFixed(1),
        log: `${out.slice(-20000)}\n--- stderr ---\n${err}`,
      });
    });
  });
}

export function fixPrompt(o: {
  title: string;
  report?: string;
  steps: string[];
  expectation: string;
  observed: string;
  failedRequests: string[];
  consoleErrors: string[];
  rca?: string;
  protectedPaths: string[];
  unit?: string;
  feedback?: string;
}): string {
  return `You are fixing a real bug in this repository. It was reproduced in a browser by Kane CLI (a testing agent).

Bug: ${o.title}
User report: ${o.report ?? '(none)'}

Minimal reproduction (Kane runs these from the app's home page):
${o.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Expected: ${o.expectation}
What Kane observed: ${o.observed}
Failed requests: ${o.failedRequests.join(', ') || 'none'}
Console errors: ${o.consoleErrors.join(' | ') || 'none'}
Kane's root-cause analysis: ${o.rca ?? '(none)'}
${o.feedback ? `\nYOUR PREVIOUS ATTEMPT WAS JUDGED BY KANE AND FAILED:\n${o.feedback}\n` : ''}
Rules:
- Fix the root cause in application code with the smallest correct change.
- Do NOT modify: ${o.protectedPaths.join(', ')}. They are hash-locked; any edit disqualifies you.
- Do not start servers, install packages, or commit.${o.unit ? `\n- You may run \`${o.unit}\`.` : ''}
Kane will re-run the reproduction and the regression suite against your change.
Finish with a 2-3 sentence summary of the root cause and your fix.`;
}
