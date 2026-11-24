#!/usr/bin/env node
// proof: from broken user session to verified fix. Kane CLI verifies every stage.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  type AgentId,
  blastRadius,
  breadcrumbSteps,
  clusterKey,
  emit,
  type Incident,
  listIncidents,
  listRuns,
  loadIncident,
  minimize,
  patchIncident,
  type Repro,
  type RunRecord,
  readJson,
  reproduce,
  saveIncident,
  severityOf,
  ship,
  stopHook,
  timeline,
  toObjective,
  tournament,
  verifyProd,
} from '@proof/engine';
import { packTriage } from '@proof/kane';

const HELP = `proof: from broken user session to verified, merged fix

Usage:
  proof repro <incident.json | id> [--url <preview url>] [--no-minimize]
  proof minimize <id> [--url <url>]
  proof blast <id> [--url <url>]           map the blast radius with Kane
  proof fix <id> --repo <path> [--base main] [--agents claude,codex,haiku]
  proof ship <id> --repo <path> [--dashboard <url>] [--draft]
  proof verify-prod <id> --url <prod url>
  proof reopen <id> --why <text> [--at <iso>]   the fix is no longer live
  proof hook-stop                         Claude Code Stop hook (reads hook JSON on stdin)
  proof steps <incident.json | id>        print the session as Kane steps (no Kane run)
  proof show <id>                         timeline + runs
  proof ls                                list incidents

Env: PROOF_HOME (.proof), PROOF_PARALLEL (3), PROOF_LLM=off, PROOF_LLM_MODEL (haiku)`;

function load(ref: string): Incident {
  if (existsSync(ref)) {
    const inc = JSON.parse(readFileSync(ref, 'utf8')) as Incident;
    saveIncident(inc);
    return inc;
  }
  return loadIncident(ref);
}

async function cmdRepro(ref: string, url: string | undefined, doMin: boolean) {
  const inc = load(ref);
  const target = url ?? inc.origin;
  if (!timeline(inc.id).some((e) => e.stage === 'captured')) {
    emit(inc.id, {
      t: inc.createdAt,
      stage: 'captured',
      message: `${inc.source}: ${inc.report ?? 'session with errors'} (${inc.breadcrumbs.length} events)`,
    });
  }
  if (!inc.severity) {
    inc.clusterKey = clusterKey(inc);
    inc.severity = severityOf(inc);
    patchIncident(inc.id, { clusterKey: inc.clusterKey, severity: inc.severity });
    emit(inc.id, { stage: 'triaged', message: `${inc.severity.toUpperCase()}: cluster ${inc.clusterKey}` });
  }
  const r = await reproduce(inc, { url: target });
  if (r.verdict === 'not_reproduced' || !doMin) return r.verdict === 'not_reproduced' ? 1 : 0;
  const first = r.runs.find((x) => x.matched);
  const rca = first?.evidencePack ? await packTriage(first.evidencePack) : {};
  const m = await minimize(inc, r.repro, { url: target, kaneRca: rca.rootCause ?? first?.summary });
  console.log(`\nMinimal repro (${m.from} -> ${m.to} steps):\n${toObjective(m.repro)}`);
  return 0;
}

async function cmdMinimize(id: string, url: string | undefined) {
  const inc = loadIncident(id);
  const repro = readJson<{ repro: Repro }>(id, 'repro.json');
  if (!repro) throw new Error(`no repro.json for ${id}; run \`proof repro ${id}\` first`);
  const m = await minimize(inc, repro.repro, { url: url ?? inc.origin });
  console.log(`\nMinimal repro (${m.from} -> ${m.to} steps):\n${toObjective(m.repro)}`);
  return 0;
}

async function cmdFix(id: string, repo: string | undefined, base: string, agents: string) {
  if (!repo) throw new Error('--repo <path to target repo> is required');
  const inc = loadIncident(id);
  const min = readJson<{ repro: Repro }>(id, 'minimal.json') ?? readJson<{ repro: Repro }>(id, 'repro.json');
  if (!min) throw new Error(`no repro for ${id}; run \`proof repro ${id}\` first`);
  const first = listRuns(id).find((r: RunRecord) => r.kind === 'reproduce' && r.matched);
  const rca = first?.evidencePack ? await packTriage(first.evidencePack) : {};
  const t = await tournament(inc, min.repro, {
    repo,
    base,
    agents: agents.split(',').map((a) => a.trim()) as AgentId[],
    rca: rca.rootCause ?? first?.summary,
    observed: first?.oneLiner,
  });
  console.log('\nTournament:');
  for (const e of t.entries) {
    console.log(
      `  ${e.passed ? 'PASS' : 'FAIL'}  ${e.label.padEnd(14)} +${e.added}/-${e.removed}  round ${e.round}  ${e.reason}`,
    );
  }
  if (t.winner)
    console.log(
      `\nWinner: ${t.winner.label} (${t.winner.branch})\nRevert check: ${t.revert?.matched ? 'red again (proof holds)' : t.revert?.why}`,
    );
  return t.winner && t.revert?.matched ? 0 : 1;
}

function cmdShow(id: string) {
  for (const e of timeline(id)) console.log(`${e.t.slice(11, 19)}  ${e.stage.padEnd(14)} ${e.message}`);
  console.log('\nruns:');
  for (const r of listRuns(id)) {
    console.log(
      `  ${r.id.padEnd(28)} ${r.kind.padEnd(10)} ${r.status.padEnd(7)} ${r.matched ? 'match' : '     '} ${r.durationS}s ${r.credits.toFixed(1)}cr ${r.video ? 'video' : ''}`,
    );
  }
  return 0;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      'no-minimize': { type: 'boolean', default: false },
      repo: { type: 'string' },
      base: { type: 'string', default: 'main' },
      agents: { type: 'string', default: 'claude,codex,haiku' },
      dashboard: { type: 'string' },
      draft: { type: 'boolean', default: false },
      why: { type: 'string' },
      at: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, arg] = positionals;
  if (values.help || !cmd) {
    console.log(HELP);
    return 0;
  }
  switch (cmd) {
    case 'repro':
      return cmdRepro(arg, values.url, !values['no-minimize']);
    case 'minimize':
      return cmdMinimize(arg, values.url);
    case 'blast': {
      const inc = loadIncident(arg);
      const min = readJson<{ repro: Repro }>(arg, 'minimal.json');
      if (!min) throw new Error('run `proof repro` first');
      const rows = await blastRadius(inc, min.repro, { url: values.url ?? inc.origin });
      for (const r of rows) console.log(`  ${r.affected ? 'AFFECTED' : 'safe    '}  ${r.label}`);
      return 0;
    }
    case 'fix':
      return cmdFix(arg, values.repo, values.base ?? 'main', values.agents ?? 'claude,codex,haiku');
    case 'ship': {
      if (!values.repo) throw new Error('--repo is required');
      const r = await ship(arg, { repo: values.repo, dashboardUrl: values.dashboard, draft: values.draft });
      console.log(r.pr);
      return 0;
    }
    case 'verify-prod': {
      if (!values.url) throw new Error('--url is required');
      const r = await verifyProd(arg, values.url);
      return r.status === 'passed' ? 0 : 1;
    }
    case 'reopen':
      loadIncident(arg);
      emit(arg, { t: values.at, stage: 'reopened', message: `Reopened: ${values.why ?? 'fix no longer live'}` });
      return 0;
    case 'hook-stop': {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      let input = {};
      try {
        input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      } catch {}
      const d = await stopHook(input);
      if (d.block) console.log(JSON.stringify({ decision: 'block', reason: d.reason }));
      else console.error(d.reason);
      return 0;
    }
    case 'steps':
      console.log(
        breadcrumbSteps(load(arg))
          .map((s, i) => `${i + 1}. ${s}`)
          .join('\n'),
      );
      return 0;
    case 'show':
      return cmdShow(arg);
    case 'ls':
      for (const i of listIncidents()) console.log(`${i.id}  ${i.title ?? ''}  ${i.createdAt}`);
      return 0;
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
