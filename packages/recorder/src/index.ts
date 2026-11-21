// @proof/recorder: video-record anything that drives a Chrome over CDP (Kane CLI included).
//
// Kane has no video. We launch our own Chrome, screencast every page target, hand Kane the
// CDP endpoint, then stitch frames to MP4 and burn in Kane's step captions.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cdp } from './cdp.ts';
import { type Chrome, launchChrome } from './chrome.ts';
import { burnCaptions, type Caption, type Frame, stitch, toSrt } from './video.ts';

export { Cdp } from './cdp.ts';
export { type Chrome, chromeBin, launchChrome } from './chrome.ts';
export { burnCaptions, type Caption, type Frame, ffmpeg, sideBySide, stitch, toSrt } from './video.ts';

const now = () => Date.now() / 1000;

export class Recorder {
  readonly frames = new Map<string, Frame[]>();
  private sessions = new Map<string, string>();
  private attaching = new Set<string>();
  private stopped = false;
  private cdp: Cdp;
  private dir: string;

  constructor(cdp: Cdp, dir: string) {
    this.cdp = cdp;
    this.dir = dir;
  }

  async start(): Promise<void> {
    this.cdp.on('Target.targetCreated', (p) => void this.attach(p.targetInfo));
    this.cdp.on('Target.targetInfoChanged', (p) => void this.attach(p.targetInfo));
    this.cdp.on('Target.detachedFromTarget', (p) => this.sessions.delete(p.sessionId));
    this.cdp.on('Page.screencastFrame', (p, sid) => this.onFrame(p, sid as string));
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    for (const t of targetInfos) await this.attach(t);
  }

  private async attach(t: { targetId: string; type: string }): Promise<void> {
    if (this.stopped || t.type !== 'page' || this.attaching.has(t.targetId)) return;
    this.attaching.add(t.targetId);
    try {
      const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      this.sessions.set(sessionId, t.targetId);
      this.frames.set(t.targetId, []);
      mkdirSync(join(this.dir, t.targetId), { recursive: true });
      await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, everyNthFrame: 1 }, sessionId);
    } catch {
      // Target vanished before we attached; nothing to record.
    }
  }

  private onFrame(p: { data: string; sessionId: number; metadata: { timestamp?: number } }, cdpSession: string): void {
    this.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, cdpSession).catch(() => {});
    const targetId = this.sessions.get(cdpSession);
    if (!targetId || this.stopped) return;
    const list = this.frames.get(targetId);
    if (!list) return;
    const file = join(this.dir, targetId, `${String(list.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(p.data, 'base64'));
    list.push({ file, ts: p.metadata.timestamp ?? now() });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const sid of this.sessions.keys()) await this.cdp.send('Page.stopScreencast', {}, sid).catch(() => {});
  }

  /** The page Kane actually drove: the target with the most frames. */
  mainFrames(): Frame[] {
    return [...this.frames.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  }
}

export type Recorded<T> = {
  result: T;
  /** Raw MP4, null if no frames were captured. */
  video: string | null;
  /** MP4 with captions burned in, null if no captions or no frames. */
  captioned: string | null;
  srt: string | null;
  frames: number;
  seconds: number;
};

/**
 * Launch Chrome, start recording, run `drive(chrome)`, then produce run.mp4 / run.captioned.mp4.
 * `drive` returns a result plus captions (wall-clock seconds) to burn in.
 */
export async function recordRun<T>(
  dir: string,
  drive: (chrome: Chrome) => Promise<{ result: T; captions?: Caption[] }>,
  opts: { headless?: boolean; maxWidth?: number } = {},
): Promise<Recorded<T>> {
  mkdirSync(dir, { recursive: true });
  const chrome = await launchChrome({ headless: opts.headless });
  const cdp = new Cdp(chrome.wsUrl);
  try {
    await cdp.ready;
    const rec = new Recorder(cdp, join(dir, 'frames'));
    await rec.start();
    const t0 = now();
    const { result, captions = [] } = await drive(chrome);
    const tEnd = now();
    await new Promise((r) => setTimeout(r, 250));
    await rec.stop();
    const frames = rec.mainFrames();
    let video: string | null = null;
    let captioned: string | null = null;
    let srt: string | null = null;
    if (frames.length) {
      video = join(dir, 'run.mp4');
      await stitch(frames, tEnd, video, opts.maxWidth);
      if (captions.length) {
        srt = join(dir, 'run.srt');
        writeFileSync(srt, toSrt(captions, frames[0].ts, tEnd));
        captioned = join(dir, 'run.captioned.mp4');
        await burnCaptions(video, srt, captioned).catch(() => {
          captioned = null;
        });
      }
    }
    return { result, video, captioned, srt, frames: frames.length, seconds: +(tEnd - t0).toFixed(1) };
  } finally {
    cdp.close();
    await chrome.close();
  }
}
