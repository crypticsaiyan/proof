// Bundle the browser SDK (rrweb included) into one minified IIFE: dist/proof.js.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const dir = import.meta.dirname;
export const outfile = join(dir, 'dist', 'proof.js');

export async function buildSdk(): Promise<{ file: string; bytes: number }> {
  await build({
    entryPoints: [join(dir, 'src', 'sdk.ts')],
    outfile,
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    legalComments: 'none',
    logLevel: 'warning',
  });
  return { file: outfile, bytes: statSync(outfile).size };
}

if (import.meta.main) {
  const { file, bytes } = await buildSdk();
  console.log(`built ${file} (${(bytes / 1024).toFixed(1)} KB)`);
}
