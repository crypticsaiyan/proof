import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export type Frame = { file: string; ts: number };
export type Caption = { ts: number; text: string; step?: number };

export function ffmpeg(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr?.on('data', (d) => {
      err += d;
    });
    p.on('error', rej);
    p.on('close', (code) => (code ? rej(new Error(`ffmpeg exited ${code}: ${err.slice(-800)}`)) : res()));
  });
}

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

/**
 * Screencast frames arrive only on repaint, so each frame is held until the next one
 * (concat demuxer durations) and the output is resampled to constant 30 fps.
 */
export async function stitch(frames: Frame[], endTs: number, out: string, maxWidth = 1280): Promise<void> {
  if (frames.length === 0) throw new Error('no frames to stitch');
  const lines: string[] = [];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].ts : Math.max(endTs, f.ts + 0.5);
    lines.push(`file '${f.file}'`, `duration ${Math.max(next - f.ts, 0.001).toFixed(3)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const list = `${out}.concat.txt`;
  writeFileSync(list, `${lines.join('\n')}\n`);
  await ffmpeg([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-vf',
    `scale='min(${maxWidth},iw)':-2`,
    '-r',
    '30',
    ...H264,
    out,
  ]);
}

function srtTime(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

export function toSrt(captions: Caption[], t0: number, tEnd: number): string {
  return captions
    .map((c, i) => {
      const end = i + 1 < captions.length ? captions[i + 1].ts : tEnd;
      return `${i + 1}\n${srtTime(c.ts - t0)} --> ${srtTime(Math.max(end, c.ts + 0.5) - t0)}\n${c.text}\n`;
    })
    .join('\n');
}

export async function burnCaptions(video: string, srtFile: string, out: string): Promise<void> {
  const style =
    'FontName=Inter,FontSize=13,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,MarginV=18';
  const esc = srtFile.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
  await ffmpeg(['-i', video, '-vf', `subtitles='${esc}':force_style='${style}'`, ...H264, out]);
}

/** Side-by-side (or any number) clips with a label strip, for before/after comparisons. */
export async function sideBySide(inputs: { file: string; label: string }[], out: string, height = 540): Promise<void> {
  const args: string[] = [];
  for (const i of inputs) args.push('-i', i.file);
  const parts = inputs.map((inp, idx) => {
    const label = inp.label.replace(/[':\\]/g, ' ');
    return `[${idx}:v]scale=-2:${height},drawtext=text='${label}':x=16:y=16:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8[v${idx}]`;
  });
  const stack = `${inputs.map((_, idx) => `[v${idx}]`).join('')}hstack=inputs=${inputs.length}[out]`;
  await ffmpeg([...args, '-filter_complex', `${parts.join(';')};${stack}`, '-map', '[out]', ...H264, out]);
}
