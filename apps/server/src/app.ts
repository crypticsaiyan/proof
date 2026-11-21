import { spawn } from 'node:child_process';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { type Incident, incidentDir, listIncidents, loadIncident, PROOF_DIR, timeline, triage } from '@proof/engine';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { home, incidentPage, loadState, page, reporterPage } from './views.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SDK = resolve(here, '../../../packages/sdk/dist/proof.js');
const CLI = resolve(here, '../../../packages/cli/src/proof.ts');

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.evidence': 'application/zip',
};

export function createApp() {
  const app = new Hono();

  app.use('/api/*', cors());
  app.use('/sdk.js', cors());

  app.get('/', (c) => c.html(page('Incidents', home(listIncidents().map(loadState)))));

  app.get('/incidents/:id', (c) => {
    const id = c.req.param('id');
    if (!existsSync(join(incidentDir(id), 'incident.json'))) return c.notFound();
    const s = loadState(loadIncident(id));
    return c.html(page(s.inc.title ?? id, incidentPage(s), { live: id }));
  });

  app.get('/r/:id', (c) => {
    const id = c.req.param('id');
    if (!existsSync(join(incidentDir(id), 'incident.json'))) return c.notFound();
    return c.html(page('Fixed', reporterPage(loadState(loadIncident(id)))));
  });

  app.get('/api/incidents', (c) => c.json(listIncidents()));
  app.get('/api/incidents/:id/timeline', (c) => c.json(timeline(c.req.param('id'))));

  /** Files under an incident dir (videos, gifs, packs). Range requests so <video> can seek. */
  app.get('/files/:id/*', (c) => {
    const id = c.req.param('id');
    const root = incidentDir(id);
    const rel = decodeURIComponent(c.req.path.split(`/files/${id}/`)[1] ?? '');
    const file = resolve(root, rel);
    if (!file.startsWith(`${root}/`) || !existsSync(file) || !statSync(file).isFile()) return c.notFound();
    const size = statSync(file).size;
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const range = c.req.header('range')?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
      return new Response(body, {
        status: 206,
        headers: {
          'content-type': type,
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
          'content-length': String(end - start + 1),
        },
      });
    }
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return new Response(body, {
      headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' },
    });
  });

  app.get('/sdk.js', (c) => {
    if (!existsSync(SDK)) return c.text('// Proof SDK not built: run `node packages/sdk/build.ts`', 503);
    return c.body(readFileSync(SDK), 200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    });
  });

  /** SDK -> captured session. Triage dedupes; new clusters can auto-start the pipeline. */
  app.post('/api/ingest', async (c) => {
    const body = await readBody(c.req.raw);
    const raw = (body?.incident ?? body) as Omit<Incident, 'id' | 'createdAt'>;
    if (!raw?.origin || !Array.isArray(raw.breadcrumbs)) return c.json({ error: 'bad incident' }, 400);
    raw.failedRequests ??= [];
    raw.consoleErrors ??= [];
    raw.project ??= 'default';
    if (body?.sessionId) raw.replay = String(body.sessionId);
    const r = await triage(raw);
    if (!r.duplicateOf && process.env.PROOF_AUTORUN === '1') autorun(r.incident.id);
    return c.json({ id: r.incident.id, duplicateOf: r.duplicateOf ?? null, count: r.count });
  });

  /** rrweb chunks; text/plain from sendBeacon is accepted. */
  app.post('/api/sessions/:sid/events', async (c) => {
    const sid = c.req
      .param('sid')
      .replace(/[^\w-]/g, '')
      .slice(0, 64);
    const body = await readBody(c.req.raw);
    const events = Array.isArray(body?.events) ? body.events : [];
    mkdirSync(join(PROOF_DIR, 'sessions'), { recursive: true });
    if (events.length)
      appendFileSync(
        join(PROOF_DIR, 'sessions', `${sid}.ndjson`),
        `${events.map((e: unknown) => JSON.stringify(e)).join('\n')}\n`,
      );
    return c.json({ ok: true, n: events.length });
  });

  return app;
}

async function readBody(req: Request): Promise<any> {
  try {
    return JSON.parse(await req.text());
  } catch {
    return null;
  }
}

/** Full pipeline in the background: repro -> minimize -> tournament -> ship. */
function autorun(id: string) {
  const repo = process.env.PROOF_TARGET_REPO;
  const url = process.env.PROOF_TARGET_URL;
  const steps = [
    ['repro', id, ...(url ? ['--url', url] : [])],
    ...(repo ? [['fix', id, '--repo', repo]] : []),
    ...(repo && process.env.PROOF_AUTOSHIP === '1'
      ? [
          [
            'ship',
            id,
            '--repo',
            repo,
            ...(process.env.PROOF_PUBLIC_URL ? ['--dashboard', process.env.PROOF_PUBLIC_URL] : []),
          ],
        ]
      : []),
  ];
  const script = steps
    .map((a) => [process.execPath, CLI, ...a].map((x) => `'${x.replace(/'/g, "'\\''")}'`).join(' '))
    .join(' && ');
  const p = spawn('sh', ['-c', script], { stdio: ['ignore', 'ignore', 'inherit'], detached: true });
  p.unref();
}
