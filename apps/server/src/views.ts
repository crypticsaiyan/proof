import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  type Incident,
  incidentDir,
  listRuns,
  type Milestones,
  milestonesOf,
  type Repro,
  type RunRecord,
  readJson,
  severityOf,
  type TimelineEvent,
  type TournamentResult,
  timeline,
  winReason,
} from '@proof/engine';
import { html, raw } from 'hono/html';
import { CSS, FONTS } from './styles.ts';

type H = ReturnType<typeof html>;

const TZ = process.env.PROOF_TZ ?? 'Asia/Kolkata';
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString('en-GB', { ...o, timeZone: TZ });
const hhmm = (iso?: string) => (iso ? fmt(iso, { hour: '2-digit', minute: '2-digit' }) : '');
const hhmmss = (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = (iso?: string) => (iso ? fmt(iso, { day: 'numeric', month: 'short' }) : '');
export const when = (iso?: string) => (iso ? `${day(iso)}, ${hhmm(iso)}` : '');
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
const pathOf = (url: string, origin: string) => {
  try {
    return new URL(url, origin).pathname;
  } catch {
    return url;
  }
};

export type IncidentState = {
  inc: Incident;
  tl: TimelineEvent[];
  ms: Milestones;
  runs: RunRecord[];
  repro: { verdict: string; hits: number; of: number; repro: Repro } | null;
  minimal: {
    repro: Repro;
    from: number;
    to: number;
    checks: number;
    confirmed?: { hits: number; of: number };
  } | null;
  /** The hash-locked test, byte for byte. */
  lockedTest: string | null;
  t: TournamentResult | null;
  ship: { pr: string; evidence?: string; at?: string } | null;
  notify: { name?: string; body: string; runId: string; delivered?: boolean } | null;
  blast: { rows: { label: string; dimension: string; affected: boolean; status: string }[] } | null;
};

export function loadState(inc: Incident): IncidentState {
  const tl = timeline(inc.id);
  const t = readJson<TournamentResult>(inc.id, 'tournament.json');
  const test = join(incidentDir(inc.id), `${inc.id}_test.md`);
  return {
    inc: { ...inc, severity: inc.severity ?? severityOf(inc) },
    tl,
    ms: milestonesOf(tl),
    lockedTest: existsSync(test) ? readFileSync(test, 'utf8') : null,
    runs: listRuns(inc.id),
    repro: readJson(inc.id, 'repro.json'),
    minimal: readJson(inc.id, 'minimal.json'),
    t,
    ship: readJson(inc.id, 'ship.json'),
    notify: readJson(inc.id, 'notify.json'),
    blast: readJson(inc.id, 'blast.json'),
  };
}

/** Nothing more will happen without a new run: the live page can stop polling. */
export const settled = (s: IncidentState) => !!s.ms.prodVerified;

export function status(s: IncidentState): { text: string; tone: '' | 'red' | 'green' | 'amber' } {
  const m = s.ms;
  const last = (...st: TimelineEvent['stage'][]) => s.tl.findLast((e) => st.includes(e.stage))?.stage;
  if (m.reopened) return { text: 'Reopened', tone: 'amber' };
  if (m.prodVerified) return { text: 'Fixed in prod', tone: 'green' };
  if (m.shipped) return { text: 'PR open', tone: 'green' };
  if (m.verified) return { text: 'Fix proven', tone: 'green' };
  if (last('fixing', 'minimizing', 'reproducing') === 'fixing') return { text: 'Fixing', tone: 'amber' };
  const r = last('reproducing', 'reproduced', 'flaky', 'not_reproduced');
  if (r === 'not_reproduced') return { text: 'Not reproduced', tone: '' };
  if (r === 'flaky') return { text: 'Flaky', tone: 'amber' };
  if (r === 'reproduced') return { text: 'Reproduced', tone: 'red' };
  if (r === 'reproducing') return { text: 'Reproducing', tone: 'red' };
  return { text: 'Captured', tone: 'red' };
}

export const badge = (text: string, tone = '') => html`<span class="badge ${tone}">${text}</span>`;

export const fileUrl = (id: string, abs?: string) =>
  abs ? `/files/${id}/${relative(incidentDir(id), abs)}` : undefined;

/** Pipeline milestones, in order. */
export function milestones(s: IncidentState) {
  const w = s.t?.winner;
  const m = s.ms;
  const reply = s.notify ? (s.notify.delivered ? 'Reporter told' : 'Reply written') : '';
  return [
    { label: 'Captured', at: m.captured ?? s.inc.createdAt, d: plural(s.inc.breadcrumbs.length, 'event') },
    { label: 'Reproduced', at: m.reproduced, d: s.repro ? `${s.repro.hits}/${s.repro.of} Kane runs` : '' },
    { label: 'Minimized', at: m.minimized, d: m.minimized && s.minimal ? plural(s.minimal.to, 'step') : '' },
    { label: 'Fixed', at: m.fixed, d: m.fixed && w ? w.label : '' },
    { label: 'Proven', at: m.verified, d: m.verified ? 'Red on revert' : '' },
    // A later re-run clears the shipped milestone, but the PR it opened still exists.
    {
      label: 'PR opened',
      at: m.shipped ?? s.ship?.at,
      d: (m.shipped ?? s.ship?.at) && s.ship?.pr ? `#${s.ship.pr.split('/').pop()}` : '',
    },
    { label: 'Green in prod', at: m.prodVerified, d: m.reopened ? 'Then reopened' : m.prodVerified ? reply : '' },
  ];
}

/** The hosted copy: recorded runs only, nothing can be started from it. */
export const isStatic = () => process.env.PROOF_STATIC === '1';

/** Shown on every read-only page so nobody mistakes the snapshot for the product. */
function exampleNote() {
  return html`<div class="example-note" role="note"><span><b>Example run.</b> Recorded from real Proof and Kane CLI runs on a demo shop. This copy is read-only: nothing runs here.</span><a class="btn primary" href="/#run">Run it yourself</a></div>`;
}

export function page(
  title: string,
  body: H,
  opts: { live?: string; settled?: boolean; nav?: IncidentState[]; current?: string; crumbs?: H; actions?: H } = {},
) {
  const live = opts.live && !isStatic() && !opts.settled;
  return html`<!doctype html>
<html lang="en"${opts.settled ? raw(' data-settled="1"') : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Proof</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="icon" href="data:image/svg+xml,${raw(encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 12"><rect width="10" height="6" rx="1" fill="#dc2626"/><rect y="6" width="10" height="6" rx="1" fill="#15803d"/></svg>'))}">
<style>${raw(CSS)}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="app">
  <aside class="side">
    <a class="brand" href="/"><i aria-hidden="true"></i>Proof</a>
    <div class="side-h"><span>${isStatic() ? 'Example runs' : 'Incidents'}</span><span class="num">${opts.nav?.length ?? 0}</span></div>
    <nav aria-label="Incidents">${(opts.nav ?? []).map((s) => {
      const st = status(s);
      return html`<a class="item" href="/incidents/${s.inc.id}"${s.inc.id === opts.current ? raw(' aria-current="page"') : ''}><span class="dot ${st.tone}"></span><span class="t" title="${s.inc.title ?? s.inc.id}">${s.inc.title ?? s.inc.id}</span><span class="m">${st.text} · ${when(s.ms.captured ?? s.inc.createdAt)}</span></a>`;
    })}</nav>
    <div class="side-f"><a href="https://github.com/crypticsaiyan/proof">GitHub</a><a href="https://github.com/LambdaTest/kane-cli">Kane CLI</a></div>
  </aside>
  <div class="main">
    <header class="topbar"><div class="crumbs">${opts.crumbs ?? html`<span>Overview</span>`}</div><div class="actions">${opts.actions ?? ''}</div></header>
    <main id="main" class="content">${isStatic() ? exampleNote() : ''}${body}</main>
  </div>
</div>
${live ? raw(liveScript(opts.live as string)) : ''}
</body>
</html>`;
}

/**
 * While a pipeline runs, swap in the sections whose content changed. Sections with a playing
 * video stay put, nothing reloads, and polling stops once the incident is settled.
 */
function liveScript(id: string) {
  return `<script>
(() => {
  let n = ${'-1'};
  const playing = (el) => [...el.querySelectorAll('video')].some((v) => !v.paused);
  const swap = (sel, doc) => {
    const cur = document.querySelector(sel), next = doc.querySelector(sel);
    if (!cur || !next) return;
    const old = new Map([...cur.children].map((el) => [el.dataset.k, el]));
    cur.replaceChildren(...[...next.children].map((el) => {
      const o = old.get(el.dataset.k);
      return o && (o.innerHTML === el.innerHTML || playing(o)) ? o : el;
    }));
  };
  const timer = setInterval(async () => {
    try {
      const evs = await (await fetch('/api/incidents/${id}/timeline')).json();
      if (n === -1) { n = evs.length; return; }
      if (evs.length === n) return;
      n = evs.length;
      const doc = new DOMParser().parseFromString(await (await fetch(location.href)).text(), 'text/html');
      document.documentElement.classList.add('updated');
      swap('main', doc);
      document.querySelector('.side nav').innerHTML = doc.querySelector('.side nav').innerHTML;
      document.querySelector('.actions').innerHTML = doc.querySelector('.actions').innerHTML;
      document.title = doc.title;
      if (doc.documentElement.dataset.settled) clearInterval(timer);
    } catch {}
  }, 2000);
})();
</script>`;
}

const FLOW: [string, string][] = [
  ['Capture', 'A script tag records clicks, inputs, console errors and failed requests.'],
  ['Reproduce', 'Kane must fail 3 of 3 times with the user’s own failure signature.'],
  ['Minimize', 'Kane proves each remaining step is needed to trigger the bug.'],
  ['Tournament', 'Coding agents fix it in separate worktrees. Kane judges each one.'],
  ['Proof', 'Red before, green after, red again when the fix is reverted.'],
  ['Prod', 'Kane re-runs the locked repro live and writes the reporter’s reply.'],
];

export function home(states: IncidentState[]) {
  const runs = states.reduce((n, s) => n + s.runs.length, 0);
  const credits = states.reduce((n, s) => n + s.runs.reduce((m, r) => m + r.credits, 0), 0);
  const fixed = states.filter((s) => s.ms.prodVerified && !s.ms.reopened).length;
  return html`<div class="head" data-k="head" style="--i:0">
  <h1>${isStatic() ? 'Example runs' : 'Incidents'}</h1>
  <p class="sub">${isStatic() ? 'Real bug reports from the demo shop, reproduced, fixed and proven by Kane CLI. Open one to follow it from session to production.' : 'Broken user sessions, reproduced, fixed and proven by Kane CLI.'}</p>
</div>
<section class="panel stats" data-k="stats" style="--i:1">
  <div class="stat"><span>Incidents</span><b>${states.length}</b></div>
  <div class="stat"><span>Fixed in prod</span><b>${fixed}</b></div>
  <div class="stat"><span>Kane runs</span><b>${runs.toLocaleString('en')}</b></div>
  <div class="stat"><span>Kane credits</span><b>${Math.round(credits).toLocaleString('en')}</b></div>
</section>
<section class="panel" data-k="list" style="--i:2">
  <div class="panel-h"><h2>${isStatic() ? 'Recorded runs' : 'All incidents'}</h2><span class="aside">Newest first</span></div>
  ${
    states.length
      ? html`<div class="scroll"><table>
    <thead><tr><th>Incident</th><th>Status</th><th>Pipeline</th><th>Captured</th><th>Kane runs</th></tr></thead>
    <tbody>${[...states].reverse().map((s) => {
      const st = status(s);
      const ms = milestones(s);
      return html`<tr>
      <td><a class="link" href="/incidents/${s.inc.id}" style="font-weight:500">${s.inc.title ?? s.inc.id}</a><br><span class="mono mute">${s.inc.id}</span></td>
      <td>${badge(st.text, st.tone)}</td>
      <td><span class="prog" aria-label="${ms.filter((m) => m.at).length} of ${ms.length} stages done">${ms.map((m, i) => html`<i class="${m.at ? (i === ms.length - 1 ? 'ok' : 'on') : ''}"></i>`)}</span></td>
      <td class="nowrap mute">${when(ms[0].at)}</td>
      <td class="num">${s.runs.length}</td>
    </tr>`;
    })}</tbody>
  </table></div>`
      : html`<div class="panel-b mute">No incidents yet. Add <code>&lt;script src="https://your-proof-server/sdk.js" data-project="my-app" defer&gt;&lt;/script&gt;</code> to an app.</div>`
  }
</section>
<section class="panel" data-k="flow" style="--i:3">
  <div class="panel-h"><h2>How a bug becomes a merged fix</h2><span class="aside">Kane CLI checks every stage</span></div>
  <div class="flow">${FLOW.map(([name, text], i) => html`<div><span class="n">0${i + 1}</span><h3>${name}</h3><p>${text}</p></div>`)}</div>
</section>`;
}

function stageTone(stage: TimelineEvent['stage']) {
  if (['captured', 'reproducing', 'reproduced', 'error'].includes(stage)) return 'red';
  if (['fixed', 'verified', 'shipped', 'prod_verified', 'notified', 'locked'].includes(stage)) return 'green';
  if (stage === 'flaky') return 'amber';
  return '';
}

/** Last frame of a run video (where Kane's verdict shows), extracted once and cached beside it. */
export function poster(video?: string): string | undefined {
  if (!video) return undefined;
  const out = video.replace(/\.mp4$/, '.poster.jpg');
  if (!existsSync(out)) {
    spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-sseof', '-1.5', '-i', video, '-frames:v', '1', '-q:v', '4', out],
      {
        timeout: 15_000,
      },
    );
  }
  return existsSync(out) ? out : undefined;
}

function clip(id: string, o: { title: string; run?: RunRecord; text: H | string }) {
  const video = o.run?.captioned ?? o.run?.video;
  const src = fileUrl(id, video);
  const still = fileUrl(id, poster(video));
  return html`<figure class="clip" style="margin:0">
  <div class="clip-h"><span style="display:flex;gap:10px;align-items:center"><b>${o.title}</b>${o.run ? badge(`Kane ${o.run.status}`, o.run.status === 'passed' ? 'green' : 'red') : badge('Waiting')}</span><span class="num">${o.run ? `${Math.round(o.run.durationS)}s` : ''}</span></div>
  <div class="media">${src ? html`<video src="${src}" poster="${still ?? ''}" controls muted playsinline preload="none"></video>` : 'No recording yet'}</div>
  <p>${o.text}${o.run?.testUrl ? html` <a class="link" href="${o.run.testUrl}" target="_blank" rel="noreferrer">Kane run</a>` : ''}</p>
</figure>`;
}

/** The pipeline as a horizontal stepper (vertical on narrow screens). */
export function stepper(s: IncidentState) {
  const ms = milestones(s);
  const failed = s.tl.at(-1)?.stage === 'error';
  // After the PR, nothing runs until a person merges and deploys.
  const waiting = !!s.ms.shipped && !s.ms.prodVerified;
  // A static snapshot never runs anything, so no step is shown as running.
  const firstPending = isStatic() || settled(s) || failed || waiting ? -1 : ms.findIndex((m) => !m.at);
  return html`<ol class="stepper" style="--n:${ms.length};list-style:none;margin:0" aria-label="Pipeline">${ms.map(
    (m, i) =>
      html`<li style="--i:${i}" class="step ${m.at ? 'done' : i === firstPending ? 'active' : 'pending'}${i === ms.length - 1 ? ' final' : ''}"><span class="node"></span><span class="l">${m.label}</span><span class="d">${m.d || (m.at ? '' : i === firstPending ? 'Running' : waiting ? 'After merge' : 'Pending')}</span>${m.at ? html`<time datetime="${m.at}" title="${when(m.at)}">${i === 0 || day(m.at) !== day(ms[i - 1].at) ? when(m.at) : hhmm(m.at)}</time>` : ''}</li>`,
  )}</ol>`;
}

export function incidentCrumbs(s: IncidentState) {
  return html`<a href="/incidents">${isStatic() ? 'Example runs' : 'Incidents'}</a><span class="sep">/</span><span class="mono">${s.inc.id}</span>`;
}

export function incidentActions(s: IncidentState) {
  return html`${s.notify ? html`<a class="btn" href="/r/${s.inc.id}">Reporter page</a>` : ''}${s.ship?.pr ? html`<a class="btn primary" href="${s.ship.pr}" target="_blank" rel="noreferrer">Pull request #${s.ship.pr.split('/').pop()}</a>` : ''}`;
}

export function incidentPage(s: IncidentState) {
  const { inc, tl, runs, t } = s;
  const id = inc.id;
  const before = runs.find((r) => r.kind === 'reproduce' && r.matched) ?? runs.find((r) => r.kind === 'reproduce');
  const after = runs.find((r) => r.id === t?.winner?.judgeRunId);
  const revert = runs.find((r) => r.id === t?.revert?.runId);
  const prod = runs.findLast((r) => r.kind === 'prod');
  const prodOk = !!prod && prod.status === 'passed' && !prod.matched;
  const st = status(s);
  const credits = runs.reduce((n, r) => n + r.credits, 0);
  const regs = t?.winner?.regressions ?? [];
  const kinds = [...runs.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1), new Map<string, number>())];
  const KEY = new Set([
    'captured',
    'reproduced',
    'flaky',
    'minimized',
    'locked',
    'fixed',
    'verified',
    'shipped',
    'prod_verified',
    'notified',
    'error',
  ]);

  return html`<div class="head" data-k="head" style="--i:0">
  <h1>${inc.title ?? 'Untitled incident'}</h1>
  <div class="sub">${badge(st.text, st.tone)}<span>${inc.project}</span><span class="sep">·</span><span>${inc.severity ?? 'untriaged'}</span><span class="sep">·</span><span class="num">${plural(runs.length, 'Kane run')}, ${Math.round(credits).toLocaleString('en')} credits</span></div>
</div>

<section class="panel" data-k="pipeline" style="--i:1">
  ${stepper(s)}
</section>

<section class="panel" data-k="proof" style="--i:2">
  <div class="panel-h"><h2>Triple proof</h2><span class="aside">${t?.revert?.matched ? 'Same failure before the fix and after reverting it' : 'Recorded from Kane’s browser'}</span></div>
  <div class="proof">
    ${clip(id, {
      title: 'Before',
      run: before,
      text: s.repro
        ? html`<b>${s.repro.hits}/${s.repro.of}</b> runs of the full session failed on main with the user’s signature.`
        : 'Not reproduced yet.',
    })}
    ${clip(id, {
      title: 'After',
      run: after,
      text: t?.winner
        ? html`<b>${t.winner.label}</b>’s fix. Locked repro passes${regs.length ? html`, <b>${regs.filter((r) => r.status === 'passed').length}/${regs.length}</b> regression tests green` : ''}.`
        : 'No passing fix yet.',
    })}
    ${clip(id, {
      title: 'Fix reverted',
      run: revert,
      text: t?.revert
        ? t.revert.matched
          ? html`Fails again: <b>${t.revert.why.replace(/^same failed request: /, '')}</b>.`
          : `Inconclusive: ${t.revert.why}`
        : 'Runs once a fix wins.',
    })}
  </div>
</section>

<div class="cols" data-k="mid" style="--i:3">
  <section class="panel">
    <div class="panel-h"><h2>Minimal repro</h2>${t?.lock ? html`<span class="aside mono" title="sha256 ${t.lock.sha256}">locked ${t.lock.sha256.slice(0, 10)}</span>` : ''}</div>
    ${
      s.minimal
        ? html`<div class="panel-b" style="padding-bottom:var(--s3)"><div class="funnel"><b>${inc.breadcrumbs.length}</b> events <span>→</span> <b>${s.minimal.from}</b> steps <span>→</span> <b>${s.minimal.to}</b> steps</div><p class="mute" style="font-size:13px;margin-top:var(--s2)">Shrunk with ${plural(s.minimal.checks, 'Kane check')}${s.minimal.confirmed ? `, confirmed ${s.minimal.confirmed.hits}/${s.minimal.confirmed.of} on main` : ''}, saved as <code>${t?.lock?.repoPath.split('/').pop() ?? `${id}_test.md`}</code></p></div>
    <ol class="steps" style="border-top:1px solid var(--line)">${s.minimal.repro.steps.map((x) => html`<li>${x.text}</li>`)}<li class="check">${s.minimal.repro.expectation}</li></ol>`
        : s.repro
          ? html`<ol class="steps">${s.repro.repro.steps.map((x) => html`<li>${x.text}</li>`)}<li class="check">${s.repro.repro.expectation}</li></ol>`
          : html`<div class="panel-b mute">Not reproduced yet.</div>`
    }
  </section>
  <section class="panel">
    <div class="panel-h"><h2>Fix tournament</h2>${t?.winner ? html`<span class="aside">${t.winner.label}: ${winReason(t.entries, t.winner)}</span>` : ''}</div>
    ${
      t
        ? html`<div class="rows">${t.entries.map((e) => {
            const win = e.agent === t.winner?.agent;
            const tone = e.tampered.length || !e.passed ? 'red' : 'green';
            const res = e.tampered.length ? 'Disqualified' : win ? 'Winner' : e.passed ? 'Passed' : 'Failed';
            return html`<div class="row${win ? ' win' : ''}"><div class="k"><b style="font-weight:500">${e.label}</b> <span class="mono mute">+${e.added} -${e.removed}</span><small>${e.passed ? `Repro ${e.judgeStatus ?? 'n/a'}, suite ${e.regressions.filter((r) => r.status === 'passed').length}/${e.regressions.length}, unit ${e.unit ? (e.unit.ok ? 'pass' : 'fail') : 'n/a'}` : e.reason}</small></div>${badge(res, tone)}</div>`;
          })}</div>
    <p class="panel-b mute" style="font-size:13px;border-top:1px solid var(--line)">Smallest passing diff wins, ties go to the faster agent. Agents get the steps but cannot edit the locked test.</p>`
        : html`<div class="panel-b mute">Starts after the repro is minimized.</div>`
    }
  </section>
</div>

<div class="cols" data-k="case" style="--i:4">
  <section class="panel">
    <div class="panel-h"><h2>What the user saw</h2><span class="aside">${inc.source}</span></div>
    <div class="panel-b">
      ${inc.report ? html`<p class="quote">“${inc.report}”</p>${inc.reporter?.name ? html`<p class="who">${inc.reporter.name}</p>` : ''}` : html`<p class="mute">Captured by the Proof SDK, no written report.</p>`}
      <div class="sig">${inc.failedRequests.map((r) => html`<code>${r.method} ${pathOf(r.url, inc.origin)} ${r.status}</code>`)}${inc.consoleErrors.map((c) => html`<code>${c.text}</code>`)}</div>
    </div>
    <details><summary>Captured session, ${plural(inc.breadcrumbs.length, 'event')}</summary><ol class="session">${inc.breadcrumbs.map(
      (b) =>
        html`<li>${b.kind}${b.text ? ` "${b.text}"` : ''}${b.context ? ` (${b.context})` : ''}${b.label ? ` ${b.label}` : ''}${b.value !== undefined ? ` = "${b.value}"` : ''}${b.kind === 'nav' && b.url ? ` ${pathOf(b.url, inc.origin)}` : ''}</li>`,
    )}</ol></details>
  </section>
  <section class="panel">
    <div class="panel-h"><h2>Blast radius</h2>${s.blast?.rows.length ? html`<span class="aside">${s.blast.rows.filter((r) => r.affected).length} of ${plural(s.blast.rows.length, 'variant')} affected</span>` : ''}</div>
    ${
      s.blast?.rows.length
        ? html`<div class="rows">${s.blast.rows.map((r) => html`<div class="row"><div class="k">${r.label}<small>${r.dimension}</small></div>${r.affected ? badge('Affected', 'red') : badge('Safe', 'green')}</div>`)}</div>`
        : html`<div class="panel-b mute">Kane runs variants of the repro (other products, codes, quantities) once it is minimized.</div>`
    }
  </section>
</div>

${
  prod || s.notify
    ? html`<div class="cols" data-k="after" style="--i:5">
  <section class="panel">
    <div class="panel-h"><h2>Production</h2>${badge(prodOk ? 'Kane passed' : 'Kane failed', prodOk ? 'green' : 'red')}</div>
    <div class="clip" style="border:0">${(() => {
      const video = prod?.captioned ?? prod?.video;
      const src = fileUrl(id, video);
      return html`<div class="media" style="border-top:0">${src ? html`<video src="${src}" poster="${fileUrl(id, poster(video)) ?? ''}" controls muted playsinline preload="none"></video>` : 'No recording'}</div><p>The locked repro, re-run by Kane on the live site.${prod?.testUrl ? html` <a class="link" href="${prod.testUrl}" target="_blank" rel="noreferrer">Kane run</a>` : ''}</p>`;
    })()}</div>
  </section>
  <section class="panel">
    <div class="panel-h"><h2>Reporter</h2>${s.notify ? (s.notify.delivered ? badge('Delivered', 'green') : badge('Written, not sent')) : badge('Pending')}</div>
    <div class="panel-b">${s.notify ? html`<p class="quote" style="font-size:14px">${s.notify.body}</p><p style="margin-top:var(--s4)"><a class="link" href="/r/${id}">Open the reporter’s page</a></p>` : html`<p class="mute">Sent after Kane passes on production.</p>`}</div>
  </section>
</div>`
    : ''
}

<section class="panel" data-k="log" style="--i:6">
  <div class="panel-h"><h2>Activity</h2><span class="aside">${plural(tl.length, 'event')}</span></div>
  <div class="log">${[...tl]
    .reverse()
    .map(
      (e) =>
        html`<div data-ev><time datetime="${e.t}" title="${day(e.t)}">${hhmmss(e.t)}</time><span class="dot ${stageTone(e.stage)}"></span><span class="${KEY.has(e.stage) ? 'hi' : ''}">${e.message}</span></div>`,
    )}</div>
</section>

<section class="panel" data-k="runs" style="--i:7">
  <div class="panel-h"><h2>Kane runs</h2><span class="aside">${kinds.map(([k, n], i) => html`${i ? ' · ' : ''}<span class="num">${n}</span> ${k}`)}</span></div>
  <details><summary>Show all ${plural(runs.length, 'run')}</summary>
    <div class="scroll"><table>
      <thead><tr><th>Run</th><th>Kind</th><th>Kane</th><th>Same bug</th><th>Time</th><th>Credits</th><th></th></tr></thead>
      <tbody>${runs.map(
        (r) => html`<tr>
        <td>${r.label}</td><td class="mute">${r.kind}</td>
        <td>${badge(r.status, r.status === 'passed' ? 'green' : 'red')}</td>
        <td class="${r.matched ? 'red' : 'mute'}">${r.matched ? 'Yes' : 'No'}</td>
        <td class="num nowrap">${Math.round(r.durationS)}s</td><td class="num">${r.credits.toFixed(1)}</td>
        <td class="nowrap">${r.testUrl ? html`<a class="link" href="${r.testUrl}" target="_blank" rel="noreferrer">Kane</a>` : ''} ${r.video ? html`<a class="link" href="${fileUrl(id, r.captioned ?? r.video)}">Video</a>` : ''}</td>
      </tr>`,
      )}</tbody>
    </table></div>
  </details>
</section>`;
}

/** The page the reporter gets: no console chrome, just their steps passing on the live site. */
export function reporterPage(s: IncidentState) {
  const prod = s.runs.findLast((r) => r.kind === 'prod');
  const video = prod?.captioned ?? prod?.video;
  const src = fileUrl(s.inc.id, video);
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fixed · Proof</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${raw(CSS)}</style>
</head>
<body>
<main class="solo">
  <span class="brand"><i aria-hidden="true"></i>Proof</span>
  <div class="head">${s.ms.reopened ? html`<p>${badge('Reopened', 'amber')}</p><h1>This was fixed and verified live, and has since been reopened. The recording below is from when it was fixed.</h1>` : html`<p>${badge('Fixed', 'green')}</p><h1>The problem you reported is fixed. Here are the steps that broke, working on the live site.</h1>`}</div>
  ${s.inc.report ? html`<section class="panel panel-b"><p class="quote">“${s.inc.report}”</p><p class="who">You reported this on ${day(s.inc.createdAt)}</p></section>` : ''}
  <section class="panel">
    <div class="panel-h"><h2>Your steps, on the live site</h2>${prod ? badge('Kane passed', 'green') : badge('Pending')}</div>
    <div class="media" style="border-top:0">${src ? html`<video src="${src}" poster="${fileUrl(s.inc.id, poster(video)) ?? ''}" controls muted playsinline preload="none"></video>` : 'Recording pending'}</div>
    ${s.minimal ? html`<ol class="steps">${s.minimal.repro.steps.map((x) => html`<li>${x.text}</li>`)}</ol>` : ''}
  </section>
  <p class="mute" style="font-size:13px">Recorded by Kane CLI after the fix shipped.</p>
</main>
</body>
</html>`;
}
