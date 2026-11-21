// Ship: regression test into the repo, sealed evidence, media, PR with the Proof Card.
// Post-deploy: Kane re-runs the locked repro on prod, then the reporter gets their own steps back.

import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { evidenceMerge, evidenceValidate, packTriage } from '@proof/kane';
import { ffmpeg, sideBySide } from '@proof/recorder';
import { proofCard } from './card.ts';
import { assertLocked } from './lock.ts';
import { emit, incidentDir, listRuns, loadIncident, readJson, timeline, writeJson } from './store.ts';
import { git } from './target.ts';
import type { TournamentResult } from './tournament.ts';
import type { Repro, RunRecord } from './types.ts';
import { incidentSignature, verify } from './verify.ts';

/** The last `seconds` of a run as a small looping GIF (the moment that matters). */
export async function gif(video: string, out: string, seconds = 14, width = 640): Promise<string> {
  await ffmpeg([
    '-sseof',
    `-${seconds}`,
    '-i',
    video,
    '-vf',
    `fps=8,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer`,
    '-loop',
    '0',
    out,
  ]);
  return out;
}

async function sh(cmd: string, args: string[], cwd: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  return new Promise((res, rej) =>
    execFile(cmd, args, { cwd, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      err ? rej(new Error(`${cmd} ${args[0]}: ${stderr || err.message}`)) : res(stdout),
    ),
  );
}

/** Push media to an orphan `proof-evidence` branch so the PR can embed it. Returns raw URL base. */
async function publishEvidence(repo: string, nwo: string, id: string, files: string[]): Promise<string> {
  const wt = mkdtempSync(join(tmpdir(), 'proof-evidence-'));
  const hasRemote = await git(repo, 'ls-remote', '--heads', 'origin', 'proof-evidence').then(
    (o) => o.trim().length > 0,
  );
  if (hasRemote) {
    await git(repo, 'fetch', 'origin', 'proof-evidence:proof-evidence').catch(() => {});
    await git(repo, 'worktree', 'add', '-f', wt, 'proof-evidence');
  } else {
    await git(repo, 'worktree', 'add', '-f', '--detach', wt);
    await git(wt, 'checkout', '--orphan', 'proof-evidence');
    await git(wt, 'rm', '-rfq', '.');
    writeFileSync(
      join(wt, 'README.md'),
      '# Proof evidence\n\nVideos, GIFs and sealed Kane evidence packs referenced by Proof Cards.\n',
    );
  }
  mkdirSync(join(wt, id), { recursive: true });
  for (const f of files) copyFileSync(f, join(wt, id, basename(f)));
  await git(wt, 'add', '-A');
  if ((await git(wt, 'status', '--porcelain')).trim()) await git(wt, 'commit', '-q', '-m', `evidence: ${id}`);
  await git(wt, 'push', '-q', 'origin', 'proof-evidence');
  await git(repo, 'worktree', 'remove', '--force', wt);
  return `https://github.com/${nwo}/blob/proof-evidence/${id}`;
}

export async function ship(id: string, opts: { repo: string; dashboardUrl?: string; draft?: boolean }) {
  const inc = loadIncident(id);
  const t = readJson<TournamentResult>(id, 'tournament.json');
  const w = t?.winner;
  if (!t || !w) throw new Error(`no winning fix for ${id}; run \`proof fix\` first`);
  const minimal = readJson<{ repro: Repro; from: number }>(id, 'minimal.json');
  const repro = readJson<{ verdict: string; hits: number; of: number; repro: Repro }>(id, 'repro.json');
  if (!minimal || !repro) throw new Error('missing repro/minimal');
  const runs = listRuns(id);
  const byId = (rid?: string) => runs.find((r) => r.id === rid);
  const before = runs.find((r) => r.kind === 'reproduce' && r.matched);
  const after = byId(w.judgeRunId);
  const revert = byId(t.revert?.runId);

  // 1. Locked regression test into the winning branch (trusted copy, hash re-checked).
  assertLocked(t.lock);
  mkdirSync(dirname(join(w.worktree, t.lock.repoPath)), { recursive: true });
  copyFileSync(t.lock.file, join(w.worktree, t.lock.repoPath));

  // 2. Media.
  const media = join(incidentDir(id), 'media');
  mkdirSync(media, { recursive: true });
  const vid = (r?: RunRecord) => r?.captioned ?? r?.video;
  const files: string[] = [];
  const add = (f?: string) => {
    if (f && existsSync(f)) files.push(f);
    return f;
  };
  if (vid(before)) add(await gif(vid(before) as string, join(media, 'before.gif')));
  if (vid(after)) add(await gif(vid(after) as string, join(media, 'after.gif')));
  if (vid(revert)) add(await gif(vid(revert) as string, join(media, 'revert.gif')));
  for (const [r, name] of [
    [before, 'before.mp4'],
    [after, 'after.mp4'],
  ] as const) {
    const src = vid(r);
    if (src) {
      cpSync(src, join(media, name));
      add(join(media, name));
    }
  }
  if (vid(before) && vid(after)) {
    await sideBySide(
      [
        { file: vid(before) as string, label: 'BEFORE  Kane fails' },
        { file: vid(after) as string, label: 'AFTER  Kane passes' },
      ],
      join(media, 'before-after.mp4'),
    );
    add(join(media, 'before-after.mp4'));
  }

  // 3. Sealed evidence pack: before + after + revert merged, then validated by Kane.
  const packs = [before, after, revert].map((r) => r?.evidencePack).filter((p): p is string => !!p && existsSync(p));
  let pack: { file: string; valid: boolean } | undefined;
  if (packs.length) {
    const out = join(media, `${id}.evidence`);
    // kane-cli refuses to overwrite: merge to a fresh path, then swap it in (re-runs stay valid).
    const tmp = join(media, `.${id}.${process.pid}.evidence`);
    const m = await evidenceMerge(packs, `proof-${id}`, tmp, `Proof: ${inc.title ?? id}`);
    if (m.ok) renameSync(tmp, out);
    const v = m.ok ? await evidenceValidate(out) : { valid: false };
    pack = { file: `${id}.evidence`, valid: v.valid };
    if (m.ok) add(out);
    emit(id, {
      stage: 'info',
      message: `Evidence pack merged (${packs.length} Kane runs), validate: ${v.valid ? 'valid' : 'INVALID'}`,
    });
  }

  // 4. Publish media, commit the fix + regression test, push, open the PR.
  const nwo = JSON.parse(await sh('gh', ['repo', 'view', '--json', 'nameWithOwner'], opts.repo))
    .nameWithOwner as string;
  const base = await publishEvidence(opts.repo, nwo, id, files);
  const url = (f: string, raw = false) => `${base}/${f}${raw ? '?raw=true' : ''}`;
  const rca = before?.evidencePack ? (await packTriage(before.evidencePack)).rootCause : undefined;
  const card = proofCard({
    inc,
    timeline: timeline(id),
    repro,
    stepsBefore: repro.repro.steps.length,
    minimal: minimal.repro,
    rca,
    t,
    runs,
    media: {
      beforeGif: existsSync(join(media, 'before.gif')) ? url('before.gif', true) : undefined,
      afterGif: existsSync(join(media, 'after.gif')) ? url('after.gif', true) : undefined,
      beforeMp4: existsSync(join(media, 'before.mp4')) ? url('before.mp4') : undefined,
      afterMp4: existsSync(join(media, 'after.mp4')) ? url('after.mp4') : undefined,
    },
    pack: pack && { ...pack, file: url(pack.file) },
    testPath: t.lock.repoPath,
    blast: readJson<{ rows: { label: string; affected: boolean }[] }>(id, 'blast.json')?.rows,
    dashboardUrl: opts.dashboardUrl ? `${opts.dashboardUrl}/incidents/${id}` : undefined,
  });
  writeFileSync(join(incidentDir(id), 'card.md'), card);

  const title = `fix: ${(inc.title ?? id).replace(/^fix:\s*/i, '')}`;
  await git(w.worktree, 'add', '-A');
  // Safe to re-run after an interruption: commit only if something changed, reuse an open PR.
  if ((await git(w.worktree, 'status', '--porcelain')).trim())
    await git(w.worktree, 'commit', '-q', '-m', `${title}\n\nProof incident ${id}. Adds ${t.lock.repoPath}.`);
  await git(w.worktree, 'push', '-q', '-f', '-u', 'origin', w.branch);
  const open = await sh(
    'gh',
    ['pr', 'list', '--repo', nwo, '--head', w.branch, '--json', 'url', '-q', '.[0].url'],
    opts.repo,
  )
    .then((o) => o.trim())
    .catch(() => '');
  if (open)
    await sh('gh', ['pr', 'edit', open, '--repo', nwo, '--body-file', join(incidentDir(id), 'card.md')], opts.repo);
  const prArgs = [
    'pr',
    'create',
    '--repo',
    nwo,
    '--base',
    t.base,
    '--head',
    w.branch,
    '--title',
    title,
    '--body-file',
    join(incidentDir(id), 'card.md'),
  ];
  if (opts.draft) prArgs.push('--draft');
  const pr = open || ((await sh('gh', prArgs, opts.repo)).trim().split('\n').pop() ?? '');
  writeJson(id, 'ship.json', { pr, branch: w.branch, evidence: base, pack, at: new Date().toISOString() });
  emit(id, { stage: 'shipped', message: `PR opened: ${pr}`, data: { pr } });
  return { pr, card };
}

/** After deploy: Kane re-runs the locked repro on prod; on green, the reporter is notified. */
export async function verifyProd(id: string, prodUrl: string) {
  const inc = loadIncident(id);
  const t = readJson<TournamentResult>(id, 'tournament.json');
  if (!t) throw new Error('no tournament.json');
  const run = await verify({
    incident: inc,
    kind: 'prod',
    label: 'Production',
    objective: assertLocked(t.lock),
    url: prodUrl,
    expected: incidentSignature(inc),
  });
  const ok = run.status === 'passed' && !run.matched;
  emit(id, {
    stage: ok ? 'prod_verified' : 'error',
    message: ok
      ? `Kane re-ran the repro on production: GREEN (${prodUrl})`
      : `Production check failed: ${run.oneLiner}`,
    data: { runId: run.id },
  });
  if (ok && inc.reporter) {
    const note = {
      to: inc.reporter.email,
      name: inc.reporter.name,
      subject: 'Fixed: the problem you reported',
      body: `Hi ${inc.reporter.name?.split(' ')[0] ?? 'there'}, you reported: "${inc.report ?? 'an error'}". It is fixed. Here are your exact steps, working now on the live site.`,
      video: run.captioned ?? run.video,
      runId: run.id,
    };
    writeJson(id, 'notify.json', note);
    emit(id, {
      stage: 'notified',
      message: `Reporter ${inc.reporter.name ?? inc.reporter.email} notified with their exact steps passing on prod`,
    });
  }
  return run;
}
