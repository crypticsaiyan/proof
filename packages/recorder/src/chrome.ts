import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Chrome = {
  port: number;
  /** http endpoint for `kane-cli run --cdp-endpoint`. */
  endpoint: string;
  /** browser-level websocket for our own CDP client. */
  wsUrl: string;
  proc: ChildProcess;
  close: () => Promise<void>;
};

export function chromeBin(): string {
  const env = process.env.PROOF_CHROME_PATH ?? process.env.KANE_CLI_CHROME_PATH;
  if (env) return env;
  for (const b of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    for (const d of (process.env.PATH ?? '').split(':')) if (existsSync(join(d, b))) return join(d, b);
  }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  throw new Error('Chrome not found. Set PROOF_CHROME_PATH.');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Launch an isolated Chrome with remote debugging on a free port (port 0, read back from
 * DevToolsActivePort), so several runs can record in parallel.
 */
export async function launchChrome(
  opts: { headless?: boolean; width?: number; height?: number } = {},
): Promise<Chrome> {
  const profile = mkdtempSync(join(tmpdir(), 'proof-chrome-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${opts.width ?? 1280},${opts.height ?? 800}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    'about:blank',
  ];
  if (opts.headless !== false) args.unshift('--headless=new');
  const proc = spawn(chromeBin(), args, { stdio: 'ignore' });

  const portFile = join(profile, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 200 && !port; i++) {
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]) || 0;
    if (!port) await sleep(50);
  }
  if (!port) {
    proc.kill('SIGKILL');
    throw new Error('Chrome did not expose a DevTools port');
  }
  const endpoint = `http://127.0.0.1:${port}`;
  let wsUrl = '';
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      wsUrl = ((await (await fetch(`${endpoint}/json/version`)).json()) as { webSocketDebuggerUrl: string })
        .webSocketDebuggerUrl;
    } catch {
      await sleep(100);
    }
  }
  if (!wsUrl) throw new Error(`CDP not reachable at ${endpoint}`);

  const close = async () => {
    if (proc.exitCode === null) {
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill('SIGTERM');
      await Promise.race([exited, sleep(3000)]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }
    rmSync(profile, { recursive: true, force: true });
  };
  return { port, endpoint, wsUrl, proc, close };
}
