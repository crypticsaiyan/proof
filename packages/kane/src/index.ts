// @proof/kane: drive kane-cli headlessly and turn its NDJSON + evidence pack into typed results.

import { execFile, spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { emptySignature, fromEvidenceLines, fromPackLogs, merge, type Signature } from './signature.ts';

export * from './signature.ts';

const exec = promisify(execFile);
export const KANE_BIN = process.env.PROOF_KANE_BIN ?? 'kane-cli';

export type Caption = { ts: number; text: string; step?: number };
export type KaneStatus = 'passed' | 'failed' | 'error' | 'timeout';

export type KaneRunOpts = {
  objective: string;
  url?: string;
  cdpEndpoint?: string;
  maxSteps?: number;
  timeoutS?: number;
  bugDetection?: 'off' | 'stop' | 'continue';
  mode?: 'action' | 'testing';
  variables?: Record<string, string>;
  cwd?: string;
  /** Append raw NDJSON lines here. */
  logFile?: string;
  onEvent?: (ev: any) => void;
};

export type KaneRun = {
  exit: number;
  status: KaneStatus;
  summary: string;
  oneLiner: string;
  reason: string;
  reasonCode?: string;
  /** Progress steps as Kane reported them: "click: Clicking Place order". */
  steps: { step: number; status: string; remark: string }[];
  captions: Caption[];
  signature: Signature;
  sessionDir?: string;
  evidencePack?: string;
  testUrl?: string;
  credits: number;
  durationS: number;
  runEnd: any;
};

export function kaneArgs(o: KaneRunOpts): string[] {
  const a = ['run', o.objective, '--agent', '--headless', '--max-steps', String(o.maxSteps ?? 25)];
  if (o.url) a.push('--url', o.url);
  if (o.cdpEndpoint) a.push('--cdp-endpoint', o.cdpEndpoint);
  if (o.timeoutS) a.push('--timeout', String(o.timeoutS));
  a.push('--bug-detection', o.bugDetection ?? 'stop');
  if (o.mode) a.push('--mode', o.mode);
  if (o.variables) a.push('--variables', JSON.stringify(o.variables));
  return a;
}

/** Streams NDJSON from any kane-cli subcommand, building captions from progress events. */
function streamKane(args: string[], o: Pick<KaneRunOpts, 'cwd' | 'logFile' | 'onEvent'>) {
  const p = spawn(KANE_BIN, args, { cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const events: any[] = [];
  const captions: Caption[] = [];
  const steps: KaneRun['steps'] = [];
  let stderr = '';
  p.stderr?.on('data', (d) => {
    stderr = (stderr + d).slice(-4000);
  });
  createInterface({ input: p.stdout as NodeJS.ReadableStream }).on('line', (line) => {
    if (o.logFile) appendFileSync(o.logFile, `${line}\n`);
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    events.push(ev);
    const ts = ev.ts ? Date.parse(ev.ts) / 1000 : Date.now() / 1000;
    if (typeof ev.step === 'number' && ev.status === 'running') {
      captions.push({ ts, text: `Step ${ev.step - 1}`, step: ev.step });
    } else if (typeof ev.step === 'number' && ev.remark) {
      steps.push({ step: ev.step, status: ev.status, remark: ev.remark });
      const text = `${ev.status === 'failed' ? 'FAILED  ' : ''}${ev.remark}`.slice(0, 140);
      const c = captions.findLast((x) => x.step === ev.step);
      if (c) c.text = text;
      else captions.push({ ts, text, step: ev.step });
    } else if (ev.type === 'run_end' || ev.type === 'test_md_done') {
      const st = String(ev.status ?? ev.overall_status ?? '').toUpperCase();
      captions.push({ ts, text: `${st}: ${ev.one_liner ?? ''}`.slice(0, 140) });
    }
    o.onEvent?.(ev);
  });
  const done = new Promise<number>((res) => {
    p.on('error', () => res(2));
    p.on('close', (code) => res(code ?? 2));
  });
  return { done, events, captions, steps, stderr: () => stderr, kill: () => p.kill('SIGTERM') };
}

function statusFor(exit: number, runEnd: any): KaneStatus {
  if (exit === 3) return 'timeout';
  if (exit === 2 || (!runEnd && exit !== 0)) return 'error';
  return runEnd?.status === 'passed' || exit === 0 ? 'passed' : 'failed';
}

export async function runKane(o: KaneRunOpts): Promise<KaneRun> {
  const t0 = Date.now();
  const s = streamKane(kaneArgs(o), o);
  const exit = await s.done;
  const runEnd = s.events.findLast((e) => e.type === 'run_end') ?? null;
  const sessionDir: string | undefined = runEnd?.session_dir;
  const evidencePack = findPack(sessionDir);
  const flowSummaries = (runEnd?.per_flow_metadata ?? []).map((f: any) => f.summary).join('\n');
  const signature = merge(
    { ...emptySignature(), reasonCode: runEnd?.reason_code },
    fromEvidenceLines(`${runEnd?.summary ?? ''}\n${flowSummaries}`),
    evidencePack ? await signatureFromPack(evidencePack) : emptySignature(),
  );
  return {
    exit,
    status: statusFor(exit, runEnd),
    summary: runEnd?.summary ?? s.stderr(),
    oneLiner: runEnd?.one_liner ?? '',
    reason: runEnd?.reason ?? (runEnd ? '' : s.stderr().trim().split('\n').slice(-3).join(' ')),
    reasonCode: runEnd?.reason_code,
    steps: s.steps,
    captions: s.captions,
    signature,
    sessionDir,
    evidencePack,
    testUrl: runEnd?.test_url,
    credits: Number(runEnd?.credits_consumed ?? 0),
    durationS: +((Date.now() - t0) / 1000).toFixed(1),
    runEnd,
  };
}

export function findPack(sessionDir?: string): string | undefined {
  if (!sessionDir) return undefined;
  const dir = join(sessionDir, 'evidence');
  if (!existsSync(dir)) return undefined;
  const f = readdirSync(dir).find((n) => n.endsWith('.evidence'));
  return f ? join(dir, f) : undefined;
}

/** Read one or more files out of a sealed pack (a zip) by glob. */
export async function readFromPack(pack: string, glob: string): Promise<string> {
  try {
    const { stdout } = await exec('unzip', ['-p', pack, glob], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch {
    return '';
  }
}

export async function packEntries(pack: string): Promise<string[]> {
  try {
    const { stdout } = await exec('unzip', ['-Z1', pack], { maxBuffer: 8 << 20 });
    return stdout.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export async function signatureFromPack(pack: string): Promise<Signature> {
  const names = await packEntries(pack);
  const entries: any[] = [];
  for (const n of names.filter((f) => f.endsWith('-network.har'))) {
    try {
      entries.push(...(JSON.parse(await readFromPack(pack, n))?.log?.entries ?? []));
    } catch {}
  }
  const consoleText = await readFromPack(pack, 'tests/*/logs/*-console.ndjson');
  return fromPackLogs({ log: { entries } }, consoleText);
}

/** Kane's own triage of the failing step (title, root cause, suggested fix), if present. */
export async function packTriage(pack: string): Promise<{ title?: string; rootCause?: string; fix?: string }> {
  const y = await readFromPack(pack, 'tests/*/steps/*/failure.yaml');
  if (!y) return {};
  const grab = (key: string) => {
    const m = y.match(new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n\\s*[a-z_]+:|$)`));
    return m?.[1].replace(/\s+/g, ' ').trim();
  };
  return { title: grab('\\ntitle'), rootCause: grab('root_cause'), fix: grab('suggested_fix:\\s*\\n\\s*summary') };
}

export type TestmdRun = {
  exit: number;
  status: KaneStatus;
  events: any[];
  captions: Caption[];
  steps: KaneRun['steps'];
  shareUrl?: string;
  durationS: number;
};

/** `kane-cli testmd run <file>_test.md`: replays cached steps when nothing changed. */
export async function runTestmd(
  file: string,
  o: {
    url?: string;
    cdpEndpoint?: string;
    cwd?: string;
    logFile?: string;
    author?: boolean;
    onEvent?: (e: any) => void;
  } = {},
): Promise<TestmdRun> {
  const args = ['testmd', 'run', file, '--agent', '--headless', '--bug-detection', 'stop'];
  if (o.url) args.push('--url', o.url);
  if (o.cdpEndpoint) args.push('--cdp-endpoint', o.cdpEndpoint);
  if (o.author) args.push('--author');
  const t0 = Date.now();
  const s = streamKane(args, o);
  const exit = await s.done;
  const done = s.events.findLast((e) => e.type === 'test_md_done');
  const overall = String(done?.overall_status ?? '').toLowerCase();
  const status: KaneStatus =
    exit === 3 ? 'timeout' : exit === 2 ? 'error' : exit === 0 && overall !== 'failed' ? 'passed' : 'failed';
  return {
    exit,
    status,
    events: s.events,
    captions: s.captions,
    steps: s.steps,
    shareUrl: done?.share_url,
    durationS: +((Date.now() - t0) / 1000).toFixed(1),
  };
}

export async function evidenceValidate(pack: string): Promise<{ valid: boolean; report: any }> {
  try {
    const { stdout } = await exec(KANE_BIN, ['evidence', 'validate', pack, '--json'], { maxBuffer: 8 << 20 });
    return { valid: true, report: safeJson(stdout) };
  } catch (e: any) {
    return { valid: false, report: safeJson(e.stdout) ?? e.message };
  }
}

export async function evidenceMerge(packs: string[], runId: string, out: string, title?: string) {
  const args = [
    'evidence',
    'merge',
    ...packs,
    '--run-id',
    runId,
    '-o',
    out,
    '--json',
    '--on-collision',
    'prefer-first',
  ];
  if (title) args.push('--title', title);
  try {
    const { stdout } = await exec(KANE_BIN, args, { maxBuffer: 8 << 20 });
    return { ok: true, out, report: safeJson(stdout) };
  } catch (e: any) {
    return { ok: false, out, report: safeJson(e.stdout) ?? e.stderr ?? e.message };
  }
}

function safeJson(s: string | undefined): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    const last = s.trim().split('\n').pop();
    try {
      return last ? JSON.parse(last) : null;
    } catch {
      return s;
    }
  }
}
