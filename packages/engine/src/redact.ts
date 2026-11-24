// Evidence packs carry Kane's runner logs, which include the machine's home path and the Kane
// account email. Nothing is published before both are gone, and the result must still validate.

import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** Reserved for documentation (RFC 2606): the demo's fictional people use these. */
const SAFE = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|[\w-]+\.(?:invalid|test))$/i;

export function redactText(s: string, home = homedir()): string {
  return s
    .replaceAll(home, '/home/user')
    .replace(/\/(home|Users)\/(?!user\b)[^/\s"'\\]+/g, '/home/user')
    .replace(EMAIL, (e) => (SAFE.test(e) ? e : 'redacted@example.com'));
}

const isBinary = (b: Buffer) => b.subarray(0, 8000).includes(0);

/** Rewrite a pack with every text entry redacted. Returns how many entries changed. */
export async function redactPack(src: string, out: string): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'proof-redact-'));
  let changed = 0;
  try {
    await exec('unzip', ['-q', resolve(src), '-d', dir]);
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const f = join(d, name);
        if (statSync(f).isDirectory()) {
          walk(f);
          continue;
        }
        const buf = readFileSync(f);
        if (isBinary(buf)) continue;
        const before = buf.toString('utf8');
        const after = redactText(before);
        if (after !== before) {
          writeFileSync(f, after);
          changed++;
        }
      }
    };
    walk(dir);
    await exec('zip', ['-q', '-r', resolve(out), '.'], { cwd: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return changed;
}
