// The Proof Card: the PR body that carries the evidence. Pure function of the incident state.

import type { Lock } from './lock.ts';
import { milestonesOf } from './milestones.ts';
import { type Entry, type TournamentResult, winReason } from './tournament.ts';
import type { Incident, Repro, RunRecord, TimelineEvent } from './types.ts';

export type CardInput = {
  inc: Incident;
  timeline: TimelineEvent[];
  repro: { verdict: string; hits: number; of: number };
  stepsBefore: number;
  minimal: Repro;
  minimalConfirmed?: { hits: number; of: number };
  rca?: string;
  t: TournamentResult;
  runs: RunRecord[];
  media: { beforeGif?: string; afterGif?: string; revertGif?: string; beforeMp4?: string; afterMp4?: string };
  pack?: { file: string; valid: boolean };
  testPath: string;
  dashboardUrl?: string;
  blast?: { label: string; affected: boolean }[];
};

const TZ = process.env.PROOF_TZ ?? 'Asia/Kolkata';
const hhmm = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: TZ,
      })
    : 'n/a';

function entryRow(e: Entry, winner?: Entry): string {
  const result = e.tampered.length ? 'DISQUALIFIED' : e.passed ? (e === winner ? '**WINNER**' : 'pass') : 'fail';
  const suite = e.regressions.length
    ? `${e.regressions.filter((r) => r.status === 'passed').length}/${e.regressions.length}`
    : 'n/a';
  return `| ${e.label} | ${result} | +${e.added} / -${e.removed} | ${e.judgeStatus ?? 'n/a'} | ${suite} | ${e.unit ? (e.unit.ok ? 'pass' : 'fail') : 'n/a'} | ${e.review?.verdict ?? 'n/a'} | ${e.reason.replace(/\|/g, '/').slice(0, 120)} |`;
}

export function proofCard(c: CardInput): string {
  const { inc, t } = c;
  const w = t.winner;
  const ms = milestonesOf(c.timeline);
  const linkRun = (r?: RunRecord, label = 'Kane run') => (r?.testUrl ? `[${label}](${r.testUrl})` : label);
  const before = c.runs.find((r) => r.kind === 'reproduce' && r.matched);
  const after = c.runs.find((r) => r.id === w?.judgeRunId);
  const revert = c.runs.find((r) => r.id === t.revert?.runId);
  const red = c.repro.verdict === 'confirmed';

  const lines = [
    `## Proof Card: ${inc.title ?? inc.id}`,
    '',
    `> A user hit this at **${hhmm(ms.captured)}**, reproduced **${hhmm(ms.reproduced)}**, fixed **${hhmm(ms.fixed)}**, verified **${hhmm(ms.verified)}** (${TZ}). Every stage was checked by [Kane CLI](https://github.com/LambdaTest/kane-cli).`,
    '',
    `**Triple proof:** RED before (${c.repro.hits}/${c.repro.of} Kane runs of the full ${c.stepsBefore}-step session failed the same way${c.minimalConfirmed ? `, then ${c.minimalConfirmed.hits}/${c.minimalConfirmed.of} confirmation runs of the locked ${c.minimal.steps.length}-step repro` : ''}) -> GREEN after (${w?.label ?? 'no winner'}) -> RED again when the fix is reverted${t.revert?.matched ? '' : ' (NOT CONFIRMED)'}.`,
    '',
  ];
  if (c.media.beforeGif || c.media.afterGif) {
    lines.push(
      '| Before: Kane fails on `main` | After: Kane passes on this branch |',
      '|---|---|',
      `| ${c.media.beforeGif ? `![before](${c.media.beforeGif})` : ''} | ${c.media.afterGif ? `![after](${c.media.afterGif})` : ''} |`,
      `| ${c.media.beforeMp4 ? `[full video](${c.media.beforeMp4}) · ` : ''}${linkRun(before, 'Kane test run')} | ${c.media.afterMp4 ? `[full video](${c.media.afterMp4}) · ` : ''}${linkRun(after, 'Kane test run')} |`,
      '',
    );
  }
  lines.push(
    `### What the user did`,
    inc.report
      ? `> "${inc.report}"${inc.reporter?.name ? ` (${inc.reporter.name})` : ''}`
      : '_No written report; captured automatically by the Proof SDK._',
    '',
    `Signature: ${[...inc.failedRequests.map((r) => `\`${r.method} ${new URL(r.url, inc.origin).pathname} -> ${r.status}\``), ...inc.consoleErrors.map((e) => `\`${e.text}\``)].join(', ') || 'n/a'}`,
    '',
    `### Minimal reproduction (${inc.breadcrumbs.length} session events -> ${c.stepsBefore} steps -> ${c.minimal.steps.length} steps)`,
    ...c.minimal.steps.map((s, i) => `${i + 1}. ${s.text}`),
    `${c.minimal.steps.length + 1}. ${c.minimal.expectation}`,
    '',
    `Saved as \`${c.testPath}\` (Kane \`_test.md\`, runs in the regression suite from now on).`,
    '',
  );
  if (c.rca) lines.push(`### Root cause (Kane's analysis)`, c.rca, '');
  if (c.blast?.length) {
    lines.push(
      `### Blast radius (${c.blast.filter((b) => b.affected).length}/${c.blast.length} variants affected)`,
      '| Variant | Kane |',
      '|---|---|',
      ...c.blast.map((b) => `| ${b.label} | ${b.affected ? 'AFFECTED' : 'safe'} |`),
      '',
    );
  }
  lines.push(
    `### Fix tournament`,
    `Each agent fixed the bug in its own git worktree off \`${t.base}@${t.baseSha.slice(0, 7)}\`. Kane judged every candidate: the locked repro must pass and the regression suite must stay green. Smallest passing diff wins; ties go to the faster agent.${w ? ` ${w.label} won: ${winReason(t.entries, w)}.` : ''}`,
    '',
    '| Agent | Result | Diff | Kane repro | Kane suite | Unit | Review | Notes |',
    '|---|---|---|---|---|---|---|---|',
    ...t.entries.map((e) => entryRow(e, w)),
    '',
  );
  if (w)
    lines.push(`<details><summary>Winning agent's explanation</summary>\n\n${w.agentSummary.trim()}\n\n</details>`, '');
  lines.push(
    `### Anti-cheat`,
    `- Repro hash-locked before any agent ran: \`sha256 ${(t.lock as Lock).sha256}\`. Judges re-check the hash before every run.`,
    `- Protected paths no agent may touch: checked on every diff; ${t.entries.filter((e) => e.tampered.length).length} disqualification(s).`,
    `- Diff review: a model that does not see the agent's explanation checks that the patch removes the cause instead of hiding the error. It can be wrong; read the diff.`,
    `- Revert check: winning patch un-applied, Kane ${t.revert?.matched ? linkRun(revert, 'failed again') : 'did NOT fail again'}: \`${t.revert?.why ?? 'n/a'}\`.`,
    '',
    `### Evidence`,
    `- Kane runs for this incident: ${c.runs.length} (${c.runs.reduce((n, r) => n + r.credits, 0).toFixed(0)} credits).`,
    c.pack
      ? `- Kane evidence pack (before, after and revert merged with \`kane-cli evidence merge\`, local paths and account email redacted): \`${c.pack.file}\`, \`kane-cli evidence validate\`: **${c.pack.valid ? 'valid' : 'invalid'}**.`
      : '',
    c.dashboardUrl ? `- Incident timeline and videos: ${c.dashboardUrl}` : '',
    red ? '' : '- Note: reproduction was FLAKY, see the timeline.',
    '',
    '<sub>Generated by Proof.</sub>',
  );
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}
