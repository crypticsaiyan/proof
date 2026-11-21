import { relative } from 'node:path';
import {
  type Incident,
  incidentDir,
  listRuns,
  type Repro,
  type RunRecord,
  readJson,
  type TimelineEvent,
  type TournamentResult,
  timeline,
} from '@proof/engine';
import { html, raw } from 'hono/html';
import { CSS, FONTS } from './styles.ts';

type H = ReturnType<typeof html>;

const TZ = process.env.PROOF_TZ ?? 'Asia/Kolkata';
const hhmm = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '--:--';
const hhmmss = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ });

export function page(title: string, body: H | string, opts: { live?: string } = {}) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Proof</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="icon" href="data:image/svg+xml,${raw(encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 12"><rect width="10" height="6" fill="#c3362b"/><rect y="6" width="10" height="6" fill="#1d7a49"/></svg>'))}">
<style>${raw(CSS)}</style>
</head>
<body>
<div class="frame">
<header class="top">
  <a class="mark" href="/">proof<i></i></a>
  <nav><a href="/">incidents</a><a href="https://github.com/crypticsaiyan/proof">github</a></nav>
</header>
<main>${body}</main>
<footer><span>From broken user session to verified, merged fix. Kane CLI verifies every stage.</span><span>proof</span></footer>
</div>
${opts.live && process.env.PROOF_STATIC !== '1' ? raw(liveScript(opts.live)) : ''}
</body>
</html>`;
}

/** Re-render the page when the incident timeline grows (pipeline running). */
function liveScript(id: string) {
  return `<script>
(() => {
  let n = document.querySelectorAll('[data-ev]').length;
  setInterval(async () => {
    try {
      const r = await fetch('/api/incidents/${id}/timeline');
      const evs = await r.json();
      if (evs.length !== n) location.reload();
    } catch {}
  }, 2000);
})();
</script>`;
}

export type IncidentState = {
  inc: Incident;
  tl: TimelineEvent[];
  runs: RunRecord[];
  repro: { verdict: string; hits: number; of: number; repro: Repro } | null;
  minimal: { repro: Repro; from: number; to: number; checks: number } | null;
  t: TournamentResult | null;
  ship: { pr: string; evidence?: string } | null;
  notify: { to?: string; name?: string; body: string; runId: string } | null;
  blast: { rows: { label: string; dimension: string; affected: boolean; status: string }[] } | null;
};

export function loadState(inc: Incident): IncidentState {
  return {
    inc,
    tl: timeline(inc.id),
    runs: listRuns(inc.id),
    repro: readJson(inc.id, 'repro.json'),
    minimal: readJson(inc.id, 'minimal.json'),
    t: readJson(inc.id, 'tournament.json'),
    ship: readJson(inc.id, 'ship.json'),
    notify: readJson(inc.id, 'notify.json'),
    blast: readJson(inc.id, 'blast.json'),
  };
}

export function status(s: IncidentState): { text: string; cls: string } {
  const has = (st: TimelineEvent['stage']) => s.tl.some((e) => e.stage === st);
  if (has('prod_verified')) return { text: 'fixed in prod', cls: 'solid-pass' };
  if (has('shipped')) return { text: 'pr open', cls: 'solid-pass' };
  if (has('verified')) return { text: 'verified fix', cls: 'pass' };
  if (has('fixing')) return { text: 'fixing', cls: 'warn' };
  if (has('not_reproduced')) return { text: 'not reproduced', cls: 'muted' };
  if (has('flaky')) return { text: 'flaky', cls: 'warn' };
  if (has('reproduced')) return { text: 'reproduced', cls: 'solid-fail' };
  if (has('reproducing')) return { text: 'reproducing', cls: 'fail' };
  return { text: 'captured', cls: 'fail' };
}

export const fileUrl = (id: string, abs?: string) =>
  abs ? `/files/${id}/${relative(incidentDir(id), abs)}` : undefined;

const STAGES: [string, string, string][] = [
  [
    'capture',
    'A script tag records the broken session',
    'clicks, inputs, console errors, failed requests, rage clicks, a replay, and a "Report a bug" widget',
  ],
  [
    'reproduce',
    'Kane fails the same way, 3 of 3',
    'the session becomes a Kane objective; the failure must match the user\'s signature, not just "something failed"',
  ],
  [
    'minimize',
    'Kane proves every remaining step matters',
    '30 session events become the handful of steps that still break it',
  ],
  [
    'tournament',
    'Three agents fix it, Kane judges',
    'Claude Code, Codex and a cheap model race in git worktrees; the repro is hash-locked so nobody can weaken it',
  ],
  [
    'proof',
    'Red before, green after, red on revert',
    'the PR carries before/after video, the minimal repro as a regression test, and a sealed Kane evidence pack',
  ],
];

export function home(states: IncidentState[]) {
  return html`<section>
  <p class="label">proof</p>
  <h1>From broken user session to verified, merged fix.</h1>
  <p class="muted" style="max-width:52rem">A user hits a bug. Proof captures the session, has <a href="https://github.com/LambdaTest/kane-cli">Kane CLI</a> reproduce it until it fails the same way, shrinks it, lets coding agents race to fix it, and makes Kane judge every fix. Agents never grade their own work.</p>
  <div class="tl" style="margin-top:1.5rem">${STAGES.map(
    ([k, t, d], i) =>
      html`<div><div class="t">${i + 1}</div><div class="s">${k}</div><p style="margin:.6rem 0 .25rem;font-weight:700">${t}</p><p class="muted" style="margin:0;font-size:.75rem;line-height:1.6">${d}</p></div>`,
  )}</div>
</section>
<section>
  <p class="label">incidents</p>
</section>
<section>
${
  states.length
    ? html`<div class="cards">${states.map((s) => {
        const st = status(s);
        const first = s.tl.find((e) => e.stage === 'captured')?.t ?? s.inc.createdAt;
        return html`<a class="card" href="/incidents/${s.inc.id}">
      <span class="big">${hhmm(first)}</span>
      <span><b>${s.inc.title ?? s.inc.id}</b><br><span class="muted">${s.inc.project} · ${s.inc.severity ?? 'untriaged'} · ${s.inc.breadcrumbs.length} events · ${s.runs.length} Kane runs</span></span>
      <span class="chip ${st.cls}">${st.text}</span>
    </a>`;
      })}</div>`
    : html`<div class="empty">No incidents yet. Add the SDK to an app: <code>&lt;script src="${'{this server}'}/sdk.js" data-project="my-app" defer&gt;&lt;/script&gt;</code></div>`
}
</section>`;
}

function stageCls(stage: TimelineEvent['stage']) {
  if (['captured', 'reproducing', 'reproduced', 'error'].includes(stage)) return 'fail';
  if (['fixed', 'verified', 'shipped', 'prod_verified', 'notified', 'locked'].includes(stage)) return 'pass';
  if (stage === 'flaky') return 'warn';
  return 'info';
}

function videoPanel(id: string, title: string, verdict: 'fail' | 'pass', run?: RunRecord, caption?: string) {
  const src = fileUrl(id, run?.captioned ?? run?.video);
  return html`<div class="term">
  <div class="bar"><span><span class="dot ${verdict}"></span><b>${title}</b></span><span>${run ? `kane ${run.status} · ${run.durationS}s` : 'waiting'}</span></div>
  ${src ? html`<video src="${`${src}#t=6`}" controls muted playsinline preload="metadata"></video>` : html`<div class="cap" style="padding:3rem 1rem;text-align:center">no recording yet</div>`}
  <div class="cap">${caption ?? run?.oneLiner ?? ''}${run?.testUrl ? html` · <a href="${run.testUrl}" target="_blank" rel="noreferrer">Kane test run</a>` : ''}</div>
</div>`;
}

export function incidentPage(s: IncidentState) {
  const { inc, tl, runs, t } = s;
  const id = inc.id;
  const at = (...st: TimelineEvent['stage'][]) => tl.find((e) => st.includes(e.stage))?.t;
  const before = runs.find((r) => r.kind === 'reproduce' && r.matched) ?? runs.find((r) => r.kind === 'reproduce');
  const after = runs.find((r) => r.id === t?.winner?.judgeRunId);
  const revert = runs.find((r) => r.id === t?.revert?.runId);
  const prod = runs.findLast((r) => r.kind === 'prod');
  const st = status(s);
  const milestones: [string, string | undefined][] = [
    ['user hit bug', at('captured')],
    ['reproduced', at('reproduced', 'flaky')],
    ['minimized', at('minimized')],
    ['fixed', at('fixed')],
    ['verified', at('verified')],
    ['pr opened', at('shipped')],
    ['prod green', at('prod_verified')],
  ];
  const credits = runs.reduce((n, r) => n + r.credits, 0);

  return html`<section>
  <p class="label">incident ${id} · ${inc.project} · ${inc.severity ?? 'untriaged'}</p>
  <h1>${inc.title ?? 'Untitled incident'}</h1>
  <p><span class="chip ${st.cls}">${st.text}</span> <span class="muted">${runs.length} Kane runs · ${credits.toFixed(0)} credits</span>
  ${s.ship?.pr ? html` · <a href="${s.ship.pr}" target="_blank" rel="noreferrer"><b>pull request</b></a>` : ''}</p>
</section>

<section>
  <p class="label">the timeline</p>
  <div class="tl">${milestones.map(
    ([label, t]) =>
      html`<div class="${t ? '' : 'pending'}"><div class="t">${hhmm(t)}</div><div class="s">${label}</div></div>`,
  )}</div>
</section>

<section class="grid2">
  <div>
    <p class="label">the report</p>
    ${inc.report ? html`<blockquote>"${inc.report}"${inc.reporter?.name ? html`<br><span class="muted">${inc.reporter.name}</span>` : ''}</blockquote>` : html`<p class="muted">Captured automatically by the Proof SDK, no written report.</p>`}
    <h3>What broke</h3>
    <p>${inc.failedRequests.map((r) => html`<code class="fail">${r.method} ${new URL(r.url, inc.origin).pathname} ${r.status}</code><br>`)}
    ${inc.consoleErrors.map((c) => html`<code class="fail">${c.text}</code><br>`)}</p>
    <h3>The session (${inc.breadcrumbs.length} events)</h3>
    <ol class="steps muted" style="font-size:.78rem;max-height:14rem;overflow:auto">${inc.breadcrumbs.map(
      (b) =>
        html`<li>${b.kind} ${b.text ? `"${b.text}"` : ''}${b.context ? ` (${b.context})` : ''}${b.label ? ` ${b.label}` : ''}${b.value !== undefined ? ` = "${b.value}"` : ''}${b.kind === 'nav' ? ` ${b.url ? new URL(b.url).pathname : ''}` : ''}</li>`,
    )}</ol>
  </div>
  <div>
    <p class="label">the repro</p>
    ${
      s.minimal
        ? html`<h2>${inc.breadcrumbs.length} events → ${s.minimal.from} steps → ${s.minimal.to} steps</h2>
      <ol class="steps">${s.minimal.repro.steps.map((x) => html`<li>${x.text}</li>`)}<li class="check">${s.minimal.repro.expectation}</li></ol>
      <p class="muted">Delta-debugged with ${s.minimal.checks} Kane checks. ${t?.lock ? html`Hash-locked: <code>${t.lock.sha256.slice(0, 16)}…</code>` : ''}</p>`
        : s.repro
          ? html`<ol class="steps">${s.repro.repro.steps.map((x) => html`<li>${x.text}</li>`)}<li class="check">${s.repro.repro.expectation}</li></ol>`
          : html`<p class="muted">Not reproduced yet.</p>`
    }
    ${s.repro ? html`<p><span class="chip ${s.repro.verdict === 'confirmed' ? 'solid-fail' : 'warn'}">${s.repro.verdict}</span> Kane failed the same way <b>${s.repro.hits}/${s.repro.of}</b> runs.</p>` : ''}
  </div>
</section>

<section>
  <p class="label">the proof</p>
  <div class="proof3">
    <div><span class="dot fail"></span><b>red before</b><br><span class="muted">${s.repro ? `${s.repro.hits}/${s.repro.of} Kane runs fail on main` : 'pending'}</span></div>
    <div><span class="dot pass"></span><b>green after</b><br><span class="muted">${t?.winner ? `${t.winner.label}'s fix, Kane passes + suite green` : 'pending'}</span></div>
    <div><span class="dot fail"></span><b>red on revert</b><br><span class="muted">${t?.revert ? (t.revert.matched ? 'fix un-applied, Kane fails the same way again' : `inconclusive: ${t.revert.why}`) : 'pending'}</span></div>
  </div>
  <div class="grid3" style="margin-top:1.25rem">
    ${videoPanel(id, 'before · main', 'fail', before)}
    ${videoPanel(id, 'after · fix', 'pass', after)}
    ${videoPanel(id, 'revert · fix removed', 'fail', revert)}
  </div>
</section>

${
  s.blast?.rows.length
    ? html`<section>
  <p class="label">the blast radius</p>
  <h2>${s.blast.rows.filter((r) => r.affected).length} of ${s.blast.rows.length} variants hit the same bug</h2>
  <table>
    <tr><th>variant</th><th>changes</th><th>kane</th><th>impact</th></tr>
    ${s.blast.rows.map(
      (r) =>
        html`<tr><td>${r.label}</td><td class="muted">${r.dimension}</td><td>${r.status}</td><td class="${r.affected ? 'fail' : 'pass'}"><b>${r.affected ? 'affected' : 'safe'}</b></td></tr>`,
    )}
  </table>
</section>`
    : ''
}

${
  t
    ? html`<section>
  <p class="label">the fix tournament</p>
  <table>
    <tr><th>agent</th><th>result</th><th>diff</th><th>kane repro</th><th>kane suite</th><th>unit</th><th>notes</th></tr>
    ${t.entries.map(
      (e) => html`<tr class="${e === t.winner || e.agent === t.winner?.agent ? 'win' : ''}">
      <td>${e.label}</td>
      <td class="${e.tampered.length ? 'fail' : e.passed ? 'pass' : 'fail'}">${e.tampered.length ? 'disqualified' : e.agent === t.winner?.agent ? 'winner' : e.passed ? 'pass' : 'fail'}</td>
      <td>+${e.added} / -${e.removed}</td>
      <td>${e.judgeStatus ?? 'n/a'}</td>
      <td>${e.regressions.length ? `${e.regressions.filter((r) => r.status === 'passed').length}/${e.regressions.length}` : 'n/a'}</td>
      <td>${e.unit ? (e.unit.ok ? 'pass' : 'fail') : 'n/a'}</td>
      <td class="muted">${e.reason}</td>
    </tr>`,
    )}
  </table>
</section>`
    : ''
}

${
  prod || s.notify
    ? html`<section class="grid2">
  <div>
    <p class="label">after deploy</p>
    ${videoPanel(id, 'production', prod?.status === 'passed' ? 'pass' : 'fail', prod, 'Kane re-ran the locked repro on production.')}
  </div>
  <div>
    <p class="label">the reporter</p>
    ${s.notify ? html`<blockquote style="border-left-color:var(--pass)">${s.notify.body}</blockquote><p><a href="/r/${id}">reporter's page</a></p>` : html`<p class="muted">Pending.</p>`}
  </div>
</section>`
    : ''
}

<section>
  <p class="label">the log</p>
  <div class="log">${tl.map(
    (e) =>
      html`<div data-ev><span class="muted">${hhmmss(e.t)}</span><span class="stage ${stageCls(e.stage)}">${e.stage.replace('_', ' ')}</span><span>${e.message}</span></div>`,
  )}</div>
</section>

<section>
  <p class="label">every kane run</p>
  <table>
    <tr><th>run</th><th>kind</th><th>kane</th><th>same bug</th><th>time</th><th>credits</th><th></th></tr>
    ${runs.map(
      (r) => html`<tr>
      <td>${r.label}</td><td>${r.kind}</td>
      <td class="${r.status === 'passed' ? 'pass' : 'fail'}">${r.status}</td>
      <td class="${r.matched ? 'fail' : ''}">${r.matched ? 'yes' : 'no'}</td>
      <td>${r.durationS}s</td><td>${r.credits.toFixed(1)}</td>
      <td>${r.testUrl ? html`<a href="${r.testUrl}" target="_blank" rel="noreferrer">kane</a>` : ''} ${r.video ? html`<a href="${fileUrl(id, r.captioned ?? r.video)}">video</a>` : ''}</td>
    </tr>`,
    )}
  </table>
</section>`;
}

export function reporterPage(s: IncidentState) {
  const prod = s.runs.findLast((r) => r.kind === 'prod');
  return html`<section>
  <p class="label">your report</p>
  <h1>Fixed. Here are your exact steps, working now.</h1>
  ${s.inc.report ? html`<blockquote style="border-left-color:var(--pass)">"${s.inc.report}"</blockquote>` : ''}
  <div style="max-width:60rem">${videoPanel(s.inc.id, 'your steps · live site', 'pass', prod, 'Recorded by Kane CLI on the production site after the fix shipped.')}</div>
  ${s.minimal ? html`<h3 style="margin-top:1.5rem">The steps</h3><ol class="steps">${s.minimal.repro.steps.map((x) => html`<li>${x.text}</li>`)}</ol>` : ''}
</section>`;
}
