// Static snapshot of the dashboard (recorded runs + videos) for a backup deploy judges can open
// without Kane, Chrome or agents. Usage: node apps/server/src/export.ts [outDir]

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { incidentDir, listIncidents } from '@proof/engine';

process.env.PROOF_STATIC = '1';
const { createApp } = await import('./app.ts');

const out = resolve(process.argv[2] ?? 'out/site');
const app = createApp();

async function render(path: string): Promise<string> {
  const res = await app.request(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

function write(rel: string, html: string) {
  const f = join(out, rel, 'index.html');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, html);
}

write('', await render('/'));
let files = 0;
for (const inc of listIncidents()) {
  const pageHtml = await render(`/incidents/${inc.id}`);
  write(`incidents/${inc.id}`, pageHtml);
  if (existsSync(join(incidentDir(inc.id), 'notify.json'))) write(`r/${inc.id}`, await render(`/r/${inc.id}`));
  // Copy only the media the pages reference.
  for (const m of pageHtml.matchAll(/\/files\/[^/"]+\/([^"#?]+)/g)) {
    const src = join(incidentDir(inc.id), decodeURIComponent(m[1]));
    const dst = join(out, 'files', inc.id, decodeURIComponent(m[1]));
    if (existsSync(src) && !existsSync(dst)) {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst);
      files++;
    }
  }
  for (const extra of ['card.md', 'tournament.json', 'timeline.ndjson', 'media']) {
    const src = join(incidentDir(inc.id), extra);
    if (existsSync(src)) cpSync(src, join(out, 'files', inc.id, extra), { recursive: true });
  }
}
console.log(`exported ${listIncidents().length} incident(s), ${files} media file(s) to ${out}`);
