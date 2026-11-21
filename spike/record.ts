// Spike: prove we can video-record a Kane CLI run.
//
// 1. Launch our own Chrome with --remote-debugging-port.
// 2. Attach to every page target over CDP and run Page.startScreencast.
// 3. Run `kane-cli run --agent --cdp-endpoint ...` against that Chrome.
// 4. Stitch the variable-rate JPEG frames into an MP4 with ffmpeg,
//    plus an .srt of Kane step captions keyed to wall-clock time.
//
// Usage:
//   node spike/record.ts --self-test
//   node spike/record.ts --url https://example.com "Verify the heading says Example Domain"
//
// Zero npm deps: Node 26 (type stripping, global WebSocket, fetch) + ffmpeg + Chrome.

import { type ChildProcess, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    port: { type: 'string', default: '9333' },
    out: { type: 'string', default: 'out/spike' },
    'self-test': { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
    'max-steps': { type: 'string', default: '15' },
    'bug-detection': { type: 'string', default: 'off' },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '800' },
  },
});

const PORT = Number(opts.port);
const W = Number(opts.width);
const H = Number(opts.height);
const OUT = resolve(opts.out!, new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(OUT, { recursive: true });
const log = (...a: unknown[]) => console.error('[spike]', ...a);
const now = () => Date.now() / 1000;

// ---------- Chrome ----------

function chromeBin(): string {
  if (process.env.KANE_CLI_CHROME_PATH) return process.env.KANE_CLI_CHROME_PATH;
  const dirs = (process.env.PATH ?? '').split(':');
  for (const b of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    for (const d of dirs) if (existsSync(join(d, b))) return join(d, b);
  }
  throw new Error('Chrome not found; set KANE_CLI_CHROME_PATH');
}

function launchChrome(): ChildProcess {
  const profile = join(tmpdir(), `proof-chrome-${PORT}-${process.pid}`);
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    'about:blank',
  ];
  if (!opts.headed) args.unshift('--headless=new');
  const p = spawn(chromeBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  p.stderr!.on('data', (d) => appendFileSync(join(OUT, 'chrome.log'), d));
  return p;
}

async function waitForCdp(): Promise<string> {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = (await r.json()) as { webSocketDebuggerUrl: string };
      return j.webSocketDebuggerUrl;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`CDP not reachable on ${PORT}`);
}

// ---------- minimal CDP client (flat sessions) ----------

type Handler = (params: any, sessionId?: string) => void;

class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  private handlers = new Map<string, Handler[]>();
  ready: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(new Error(`ws error ${String((e as any).message ?? e)}`));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        msg.error ? p.rej(new Error(`${msg.error.message}`)) : p.res(msg.result);
      } else {
        for (const h of this.handlers.get(msg.method) ?? []) h(msg.params, msg.sessionId);
      }
    };
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }

  on(method: string, h: Handler) {
    this.handlers.set(method, [...(this.handlers.get(method) ?? []), h]);
  }

  close() {
    this.ws.close();
  }
}

// ---------- recorder ----------

type Frame = { file: string; ts: number };

class Recorder {
  frames = new Map<string, Frame[]>(); // targetId -> frames
  private sessions = new Map<string, string>(); // sessionId -> targetId
  private attaching = new Set<string>();
  private stopped = false;
  private cdp: Cdp;
  private dir: string;

  constructor(cdp: Cdp, dir: string) {
    this.cdp = cdp;
    this.dir = dir;
  }

  async start() {
    this.cdp.on('Target.targetCreated', (p) => this.maybeAttach(p.targetInfo));
    this.cdp.on('Target.targetInfoChanged', (p) => this.maybeAttach(p.targetInfo));
    this.cdp.on('Target.detachedFromTarget', (p) => this.sessions.delete(p.sessionId));
    this.cdp.on('Page.screencastFrame', (p, sessionId) => this.onFrame(p, sessionId!));
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    for (const t of targetInfos) await this.maybeAttach(t);
  }

  private async maybeAttach(t: { targetId: string; type: string; url: string }) {
    if (this.stopped || t.type !== 'page' || this.attaching.has(t.targetId)) return;
    this.attaching.add(t.targetId);
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    this.sessions.set(sessionId, t.targetId);
    this.frames.set(t.targetId, []);
    mkdirSync(join(this.dir, t.targetId), { recursive: true });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, everyNthFrame: 1 }, sessionId);
    log(`recording page target ${t.targetId.slice(0, 8)} ${t.url}`);
  }

  private onFrame(p: { data: string; sessionId: number; metadata: { timestamp?: number } }, cdpSession: string) {
    const targetId = this.sessions.get(cdpSession);
    // Ack first so Chrome keeps sending frames.
    this.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, cdpSession).catch(() => {});
    if (!targetId || this.stopped) return;
    const list = this.frames.get(targetId)!;
    const file = join(this.dir, targetId, `${String(list.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(p.data, 'base64'));
    list.push({ file, ts: p.metadata.timestamp ?? now() });
  }

  async stop() {
    this.stopped = true;
    for (const sid of this.sessions.keys()) {
      await this.cdp.send('Page.stopScreencast', {}, sid).catch(() => {});
    }
  }
}

// ---------- stitching ----------

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr!.on('data', (d) => (err += d));
    p.on('close', (code) => {
      if (code) log(`${cmd} exited ${code}\n${err.slice(-2000)}`);
      res(code ?? 1);
    });
  });
}

async function stitch(frames: Frame[], endTs: number, outFile: string): Promise<boolean> {
  if (frames.length === 0) return false;
  // concat demuxer: each frame shown for (next.ts - ts) seconds; repeat last file per ffmpeg docs.
  const lines: string[] = [];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].ts : Math.max(endTs, f.ts + 0.5);
    lines.push(`file '${f.file}'`, `duration ${Math.max(next - f.ts, 0.001).toFixed(3)}`);
  });
  lines.push(`file '${frames.at(-1)!.file}'`);
  const list = outFile.replace(/\.mp4$/, '.concat.txt');
  writeFileSync(list, lines.join('\n') + '\n');
  // Kane sets its own viewport (1920x1080 by default). Keep native aspect, cap width.
  const vf = `scale='min(${W},iw)':-2,format=yuv420p`;
  const code = await run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-vf',
    vf,
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-movflags',
    '+faststart',
    outFile,
  ]);
  return code === 0;
}

function srtTime(s: number) {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

function writeSrt(captions: { ts: number; text: string }[], t0: number, tEnd: number, file: string) {
  const out = captions.map((c, i) => {
    const end = i + 1 < captions.length ? captions[i + 1].ts : tEnd;
    return `${i + 1}\n${srtTime(c.ts - t0)} --> ${srtTime(end - t0)}\n${c.text}\n`;
  });
  writeFileSync(file, out.join('\n'));
}

// ---------- drivers ----------

type KaneResult = { exit: number; runEnd: any; events: number };
type Caption = { ts: number; text: string; step?: number };

function runKane(objective: string, captions: Caption[]): Promise<KaneResult> {
  const args = [
    'run',
    objective,
    '--agent',
    '--headless',
    '--cdp-endpoint',
    `http://127.0.0.1:${PORT}`,
    '--max-steps',
    opts['max-steps']!,
  ];
  if (opts.url) args.push('--url', opts.url);
  args.push('--bug-detection', opts['bug-detection'] ?? 'off');
  log('kane-cli', args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' '));
  const p = spawn('kane-cli', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const ndjson = join(OUT, 'kane.ndjson');
  p.stderr!.on('data', (d) => appendFileSync(join(OUT, 'kane.stderr.log'), d));
  let runEnd: any = null;
  let events = 0;
  createInterface({ input: p.stdout! }).on('line', (line) => {
    const ts = now();
    appendFileSync(ndjson, JSON.stringify({ _recv: ts, line }) + '\n');
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    events++;
    if (ev.type === 'run_end') runEnd = ev;
    // Progress events: {step, status: running|done|failed, remark, ts}. Caption spans the
    // step from its 'running' event; text comes from the terminal event's remark.
    const label: string | undefined = ev.remark ?? (ev.type === 'run_end' ? ev.one_liner : undefined);
    const evTs = ev.ts ? Date.parse(ev.ts) / 1000 : ts;
    if (typeof ev.step === 'number' && ev.status === 'running') {
      captions.push({ ts: evTs, text: `Step ${ev.step - 1}`, step: ev.step });
    } else if (typeof ev.step === 'number' && label) {
      const c = captions.findLast((x) => x.step === ev.step);
      const text = `${ev.status === 'failed' ? 'FAILED ' : ''}${label}`.slice(0, 140);
      if (c) c.text = text;
      else captions.push({ ts: evTs, text, step: ev.step });
    } else if (ev.type === 'run_end') {
      captions.push({ ts: evTs, text: `${String(ev.status).toUpperCase()}: ${label ?? ''}`.slice(0, 140) });
    }
    log(`event ${ev.type ?? '?'}${ev.status ? ' ' + ev.status : ''}${label ? ': ' + String(label).slice(0, 100) : ''}`);
  });
  return new Promise((res) => p.on('close', (code) => res({ exit: code ?? 1, runEnd, events })));
}

async function selfTest(cdp: Cdp, captions: { ts: number; text: string }[]) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const page = targetInfos.find((t: any) => t.type === 'page');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const html = `<html><body style="margin:0;font:28px system-ui;background:#0b0b0f;color:#eee;display:grid;place-items:center;height:100vh">
    <div><h1 id=h>Proof recorder self-test</h1><input id=i style="font-size:24px"><div id=c>0</div></div>
    <script>let n=0;setInterval(()=>{document.getElementById('c').textContent=++n},100)</script></body></html>`;
  captions.push({ ts: now(), text: 'navigate to self-test page' });
  await cdp.send('Page.navigate', { url: 'data:text/html,' + encodeURIComponent(html) }, sessionId);
  await new Promise((r) => setTimeout(r, 1000));
  captions.push({ ts: now(), text: 'type into input' });
  await cdp.send('Runtime.evaluate', { expression: "document.getElementById('i').focus()" }, sessionId);
  for (const ch of 'coupon SAVE10') {
    await cdp.send('Input.insertText', { text: ch }, sessionId);
    await new Promise((r) => setTimeout(r, 120));
  }
  captions.push({ ts: now(), text: 'wait 2s' });
  await new Promise((r) => setTimeout(r, 2000));
}

// ---------- main ----------

async function main() {
  const chrome = launchChrome();
  let exitCode = 0;
  try {
    const wsUrl = await waitForCdp();
    log(`chrome up on ${PORT}`);
    const cdp = new Cdp(wsUrl);
    await cdp.ready;
    const rec = new Recorder(cdp, join(OUT, 'frames'));
    await rec.start();

    const captions: Caption[] = [];
    const t0 = now();
    let result: KaneResult | null = null;
    if (opts['self-test']) {
      await selfTest(cdp, captions);
    } else {
      const objective = positionals.join(' ');
      if (!objective) throw new Error('objective required (or --self-test)');
      result = await runKane(objective, captions);
      exitCode = result.exit;
    }
    const tEnd = now();
    await new Promise((r) => setTimeout(r, 300));
    await rec.stop();
    cdp.close();

    // Main video = page target with the most frames. Others written too.
    const ranked = [...rec.frames.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [i, [targetId, frames]] of ranked.entries()) {
      const file = join(OUT, i === 0 ? 'run.mp4' : `page-${targetId.slice(0, 8)}.mp4`);
      const ok = await stitch(frames, tEnd, file);
      log(`${ok ? 'wrote' : 'skipped'} ${file} (${frames.length} frames)`);
    }
    const srt = join(OUT, 'run.srt');
    writeSrt(captions, ranked[0]?.[1][0]?.ts ?? t0, tEnd, srt);
    if (ranked.length && existsSync(join(OUT, 'run.mp4'))) {
      const style =
        'FontName=Inter,FontSize=13,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,MarginV=18';
      const ok = await run('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        join(OUT, 'run.mp4'),
        '-vf',
        `subtitles=${srt}:force_style='${style}'`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-movflags',
        '+faststart',
        join(OUT, 'run.captioned.mp4'),
      ]);
      log(ok === 0 ? `wrote ${join(OUT, 'run.captioned.mp4')}` : 'caption burn failed');
    }

    const report = {
      out: OUT,
      seconds: +(tEnd - t0).toFixed(1),
      targets: ranked.map(([id, f]) => ({ id, frames: f.length })),
      kane: result && {
        exit: result.exit,
        events: result.events,
        status: result.runEnd?.status,
        summary: result.runEnd?.summary,
        test_url: result.runEnd?.test_url,
        session_dir: result.runEnd?.session_dir,
        run_end_keys: result.runEnd ? Object.keys(result.runEnd) : null,
      },
    };
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));

    const sd = result?.runEnd?.session_dir;
    if (sd && existsSync(sd)) {
      log(`session_dir tree (${sd}):`);
      const walk = (d: string, depth = 0) => {
        if (depth > 3) return;
        for (const n of readdirSync(d)) {
          const p = join(d, n);
          const s = statSync(p);
          console.error(`${'  '.repeat(depth)}${n}${s.isDirectory() ? '/' : ` (${s.size}b)`}`);
          if (s.isDirectory()) walk(p, depth + 1);
        }
      };
      walk(sd);
    }
  } finally {
    chrome.kill('SIGTERM');
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
