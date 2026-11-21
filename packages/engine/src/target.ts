// The repo being fixed: its proof.config.json contract, git worktrees, and running it locally.

import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type ProofConfig = {
  name: string;
  /** Shell command that starts the app; it must listen on $<portEnv>. */
  start: string;
  portEnv: string;
  health: string;
  /** Unit test command. */
  unit?: string;
  /** Directory of Kane `_test.md` regression tests. */
  regressions: string;
  /** Paths agents may not modify (prefix match, `**` suffix allowed). */
  protected: string[];
};

export function loadConfig(repo: string): ProofConfig {
  const f = join(repo, 'proof.config.json');
  if (!existsSync(f)) throw new Error(`${repo} has no proof.config.json`);
  return {
    portEnv: 'PORT',
    health: '/',
    regressions: 'tests/regressions',
    protected: [],
    ...JSON.parse(readFileSync(f, 'utf8')),
  };
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 32 << 20 });
  return stdout;
}

export async function sh(cmd: string, cwd: string, timeoutMs = 120_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((res) => {
    const p = spawn('sh', ['-c', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (d: Buffer) => {
      out = (out + d).slice(-6000);
    };
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(t);
      res({ ok: code === 0, out });
    });
  });
}

export function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      s.close(() => res(port));
    });
    s.on('error', rej);
  });
}

export type RunningApp = { url: string; stop: () => Promise<void>; log: () => string };

/** Start the target app from a checkout on a free port and wait for its health endpoint. */
export async function startApp(dir: string, cfg: ProofConfig): Promise<RunningApp> {
  const port = await freePort();
  const p = spawn('sh', ['-c', `exec ${cfg.start}`], {
    cwd: dir,
    env: { ...process.env, [cfg.portEnv]: String(port), PROOF_SDK_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const add = (d: Buffer) => {
    log = (log + d).slice(-8000);
  };
  p.stdout.on('data', add);
  p.stderr.on('data', add);
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 150; i++) {
    if (p.exitCode !== null) throw new Error(`app exited early: ${log.slice(-500)}`);
    try {
      if ((await fetch(url + cfg.health)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (i === 149) throw new Error(`app not healthy at ${url}${cfg.health}`);
  }
  return {
    url,
    log: () => log,
    stop: async () => {
      if (p.exitCode !== null) return;
      const done = new Promise((r) => p.once('exit', r));
      p.kill('SIGTERM');
      await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
      if (p.exitCode === null) p.kill('SIGKILL');
    },
  };
}

export function isProtected(path: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const base = p.replace(/\/?\*\*$/, '');
    return path === base || path.startsWith(`${base}/`);
  });
}

export type DiffStat = {
  files: { path: string; status: string; added: number; removed: number }[];
  added: number;
  removed: number;
  patch: string;
};

/** Everything the agent changed vs `base`, including untracked files. */
export async function diffAgainst(dir: string, base: string): Promise<DiffStat> {
  await git(dir, 'add', '-A');
  const numstat = await git(dir, 'diff', '--cached', '--numstat', base);
  const names = await git(dir, 'diff', '--cached', '--name-status', base);
  const patch = await git(dir, 'diff', '--cached', base);
  const status = new Map(
    names
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [s, ...rest] = l.split('\t');
        return [rest[rest.length - 1], s] as const;
      }),
  );
  const files = numstat
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, r, path] = l.split('\t');
      return { path, status: status.get(path) ?? 'M', added: Number(a) || 0, removed: Number(r) || 0 };
    });
  return {
    files,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
    patch,
  };
}
