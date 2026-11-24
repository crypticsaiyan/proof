// The public face of Proof: what it does, shown with a real incident's data rather than mockups.
// Patterns from the devtool sites we studied (Linear, Checkly, Resend, Jam): tight headline, real
// product in a framed hero, two-tone statement, bento of live UI fragments, problem-first copy.

import type { RunRecord } from '@proof/engine';
import { html, raw } from 'hono/html';
import { CSS, FONTS } from './styles.ts';
import { badge, fileUrl, type IncidentState, poster, settled, status, stepper } from './views.ts';

const REPO = 'https://github.com/crypticsaiyan/proof';
const KANE = 'https://github.com/LambdaTest/kane-cli';

const LANDING_CSS = `
.wrap { max-width: 1200px; margin-inline: auto; padding-inline: var(--s6); }
.lnav { position: sticky; top: 0; z-index: 5; border-bottom: 1px solid var(--line); background: rgb(8 9 10 / 0.75); backdrop-filter: blur(12px); }
.lnav .wrap { display: flex; align-items: center; gap: var(--s6); height: 64px; }
.lnav .brand { padding: 0; height: auto; }
.lnav nav { display: flex; gap: var(--s5); color: var(--text-3); font-size: 14px; margin-left: var(--s4); }
.lnav nav a { transition: color 150ms ease; }
.lnav nav a:hover { color: var(--text); }
.lnav .end { margin-left: auto; display: flex; gap: var(--s2); }
.btn-l { display: inline-flex; align-items: center; gap: var(--s2); height: 40px; padding: 0 var(--s4); border-radius: 8px; border: 1px solid var(--line-2); font-weight: 500; font-size: 14px; transition: background-color 150ms ease, transform 120ms var(--ease); white-space: nowrap; }
.btn-l:hover { background: var(--hover); }
.btn-l:active { transform: scale(0.97); }
.btn-l.primary { background: var(--text); color: #08090a; border-color: var(--text); }
.btn-l.primary:hover { background: #ffffff; }
.btn-l.sm { height: 32px; padding: 0 var(--s3); font-size: 13px; }

.hero { position: relative; padding: var(--s9) 0 var(--s8); }
.hero::before { content: ''; position: absolute; inset: -64px 0 auto; height: 720px; pointer-events: none; z-index: -1;
  background: radial-gradient(60% 50% at 50% 0%, rgb(255 255 255 / 0.07), transparent 70%); }
.pill { display: inline-flex; align-items: center; gap: var(--s2); height: 28px; padding: 0 var(--s3); border: 1px solid var(--line-2); border-radius: 999px; color: var(--text-2); font-size: 13px; transition: border-color 150ms ease, color 150ms ease; }
.pill:hover { color: var(--text); border-color: rgb(255 255 255 / 0.24); }
.pill .mk { width: 8px; height: 10px; border-radius: 2px; background: linear-gradient(180deg, var(--red) 0 50%, var(--green) 50%); }
.hero h1 { margin-top: var(--s5); font-size: clamp(44px, 6.4vw, 76px); line-height: 1.02; font-weight: 600; letter-spacing: -0.045em; max-width: 14ch; text-wrap: balance; }
.hero h1 em { font-style: normal; color: var(--text-3); }
.lead { margin-top: var(--s5); font-size: 18px; line-height: 1.55; color: var(--text-2); max-width: 56ch; }
.cta { margin-top: var(--s6); display: flex; flex-wrap: wrap; align-items: center; gap: var(--s3); }
.cmd { display: inline-flex; align-items: center; gap: var(--s2); height: 40px; padding: 0 var(--s4); border-radius: 8px; background: var(--sunk); border: 1px solid var(--line); color: var(--text-2); font-family: var(--mono); font-size: 13px; }
.cmd b { color: var(--text-3); font-weight: 400; }

.shot { position: relative; margin-top: var(--s8); border-radius: 14px; border: 1px solid var(--line-2); background: #0b0c0d; overflow: hidden;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.6), 0 40px 120px -20px rgb(0 0 0 / 0.9), 0 -1px 0 rgb(255 255 255 / 0.06) inset; }
.shot::after { content: ''; position: absolute; inset: auto 0 0; height: 160px; background: linear-gradient(transparent, #08090a); pointer-events: none; }
.shot-bar { display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 var(--s4); border-bottom: 1px solid var(--line); color: var(--text-3); font-size: 13px; }
.shot-bar i { width: 10px; height: 10px; border-radius: 50%; background: rgb(255 255 255 / 0.12); }
.shot-bar span { margin-left: var(--s3); font-family: var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.shot-body { display: grid; grid-template-columns: 220px minmax(0, 1fr); }
.shot-side { border-right: 1px solid var(--line); padding: var(--s3) var(--s2); display: grid; align-content: start; gap: 2px; }
.shot-side .item { cursor: default; }
.shot-main { padding: var(--s5); display: grid; gap: var(--s4); align-content: start; min-width: 0; }
.shot-main h3 { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
.shot-main .panel .stepper { padding: var(--s4); }
.tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s3); }
.tile { border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; background: var(--panel); }
.tile-h { display: flex; justify-content: space-between; align-items: center; padding: var(--s2) var(--s3); font-size: 13px; font-weight: 500; }
.tile img, .tile .ph { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; object-position: top center; border-top: 1px solid var(--line); background: #111; }

.trust { padding: var(--s7) 0 var(--s8); text-align: center; }
.trust p { color: var(--text-3); font-size: 13px; }
.marks { margin-top: var(--s5); row-gap: var(--s3); display: flex; flex-wrap: wrap; justify-content: center; gap: var(--s4) var(--s8); color: var(--text-2); font-size: 18px; font-weight: 600; letter-spacing: -0.02em; }
.marks span { opacity: 0.8; }
.marks .m { font-family: var(--mono); font-weight: 500; font-size: 16px; }

.statement { padding: var(--s9) 0; border-top: 1px solid var(--line); }
.statement p { font-size: clamp(26px, 3.2vw, 40px); line-height: 1.2; font-weight: 500; letter-spacing: -0.03em; max-width: 26ch; }
.statement p span { color: var(--text-3); }

.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s6); align-items: end; padding: var(--s9) 0 var(--s7); border-top: 1px solid var(--line); }
.split h2 { font-size: clamp(30px, 3.6vw, 44px); line-height: 1.08; font-weight: 600; letter-spacing: -0.035em; }
.split p { color: var(--text-2); font-size: 16px; max-width: 48ch; }
.eyebrow { display: block; margin-bottom: var(--s4); font-family: var(--mono); font-size: 13px; color: var(--text-3); }

.bento { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.card { padding: var(--s5); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); display: grid; grid-template-rows: auto 1fr; gap: var(--s5); min-width: 0; background: linear-gradient(180deg, rgb(255 255 255 / 0.015), transparent); }
.card:nth-child(3n) { border-right: 0; }
.card:nth-last-child(-n+3) { border-bottom: 0; }
.card h3 { font-size: 15px; font-weight: 600; display: flex; gap: var(--s2); align-items: baseline; }
.card h3 small { font-family: var(--mono); font-size: 13px; font-weight: 400; color: var(--text-3); }
.card p { margin-top: var(--s1); color: var(--text-2); font-size: 14px; }
.fig { min-height: 168px; border: 1px solid var(--line); border-radius: var(--r); background: #0b0c0d; padding: var(--s3); display: grid; gap: 6px; align-content: start; font-size: 13px; overflow: hidden; }
.fl { display: flex; justify-content: space-between; align-items: center; gap: var(--s2); padding: 6px var(--s2); border-radius: 6px; background: rgb(255 255 255 / 0.025); min-width: 0; }
.fl > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); }
.fl code { font-size: 12.5px; }
.fl.err { background: var(--red-bg); color: var(--red); }
.fl.err > span:first-child { color: var(--red); }
.fl.win { background: var(--green-bg); }
.funnel-l { display: flex; align-items: flex-end; gap: var(--s3); height: 100%; padding: var(--s2) var(--s2) 0; }
.funnel-l div { flex: 1; display: grid; gap: 6px; text-align: center; }
.funnel-l i { display: block; border-radius: 6px 6px 2px 2px; background: rgb(255 255 255 / 0.1); }
.funnel-l div:last-child i { background: var(--text); }
.funnel-l b { font: 600 22px/1 var(--sans); letter-spacing: -0.02em; }
.funnel-l small { color: var(--text-3); font-size: 13px; }
.tri { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; height: 100%; }
.tri div { border-radius: 6px; display: grid; place-items: center; align-content: center; gap: 4px; padding: var(--s3) var(--s1); font-weight: 600; }
.tri .r { background: var(--red-bg); color: var(--red); border: 1px solid var(--red-line); }
.tri .g { background: var(--green-bg); color: var(--green); border: 1px solid var(--green-line); }
.tri small { font-weight: 400; color: var(--text-2); font-size: 13px; }

.lock { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: var(--s5); }
.code { border: 1px solid var(--line); border-radius: 14px; background: #0b0c0d; overflow: hidden; }
.code-h span:first-child { overflow: hidden; text-overflow: ellipsis; }
.code-h { display: flex; justify-content: space-between; gap: var(--s4); white-space: nowrap; padding: var(--s3) var(--s4); border-bottom: 1px solid var(--line); color: var(--text-3); font-family: var(--mono); font-size: 13px; }
.code pre { margin: 0; padding: var(--s4); font-family: var(--mono); font-size: 13px; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.code pre .c { color: var(--text-3); } .code pre .k { color: var(--text); } .code pre .g { color: var(--green); }
.checks { display: grid; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.checks div { padding: var(--s5); border-bottom: 1px solid var(--line); }
.checks div:last-child { border-bottom: 0; }
.checks h3 { font-size: 15px; font-weight: 600; }
.checks p { margin-top: var(--s1); color: var(--text-2); }

.numbers { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: var(--s9); border-block: 1px solid var(--line); }
.numbers div { padding: var(--s6) var(--s5); border-right: 1px solid var(--line); }
.numbers div:last-child { border-right: 0; }
.numbers b { display: block; font-size: 40px; line-height: 1; font-weight: 600; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
.numbers span { display: block; margin-top: var(--s2); color: var(--text-3); font-size: 14px; }

.closing { position: relative; text-align: center; padding: var(--s10) 0; }
.closing::before { content: ''; position: absolute; inset: 0; z-index: -1; background: radial-gradient(40% 60% at 50% 100%, rgb(76 214 138 / 0.08), transparent 70%); }
.closing h2 { font-size: clamp(32px, 4.4vw, 56px); line-height: 1.05; font-weight: 600; letter-spacing: -0.04em; }
.closing p { margin: var(--s4) auto 0; color: var(--text-2); font-size: 16px; max-width: 48ch; }
.closing .cta { justify-content: center; }
.lfoot { border-top: 1px solid var(--line); }
.lfoot .wrap { display: flex; justify-content: space-between; gap: var(--s4); padding-block: var(--s6); color: var(--text-3); font-size: 13px; }
.lfoot a:hover { color: var(--text); }

html:not(.updated) .hero > * { animation: rise 600ms var(--ease) both; animation-delay: calc(var(--i, 0) * 70ms); }
html:not(.updated) .shot { animation: rise 900ms var(--ease) both; animation-delay: 280ms; }
@media (prefers-reduced-motion: reduce) { html:not(.updated) .hero > *, html:not(.updated) .shot { animation: fade 200ms ease both; } }

@media (max-width: 960px) {
  .lnav nav { display: none; }
  .shot-body { grid-template-columns: 1fr; }
  .shot-side { display: none; }
  .bento { grid-template-columns: 1fr; }
  .card { border-right: 0; }
  .card:nth-last-child(-n+3) { border-bottom: 1px solid var(--line); }
  .card:last-child { border-bottom: 0; }
  .split, .lock { grid-template-columns: 1fr; }
  .numbers { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .numbers div:nth-child(2) { border-right: 0; }
  .numbers div:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
}
@media (max-width: 640px) {
  .wrap { padding-inline: var(--s4); }
  .lnav .end .btn-l:not(.primary) { display: none; }
  .hero { padding-top: var(--s8); }
  .tiles { grid-template-columns: 1fr; }
  .tiles .tile:not(:first-child) { display: none; }
  .shot-main .stepper .step:nth-child(n+4) { display: none; }
  .cmd { display: none; }
}
`;

function tile(id: string, label: string, run?: RunRecord) {
  const img = fileUrl(id, poster(run?.captioned ?? run?.video));
  const verdict = run ? badge(`Kane ${run.status}`, run.status === 'passed' ? 'green' : 'red') : badge('Pending');
  return html`<div class="tile"><div class="tile-h"><span>${label}</span>${verdict}</div>${img ? html`<img src="${img}" alt="${label}: last frame of Kane's run" loading="lazy">` : html`<div class="ph"></div>`}</div>`;
}

export function landing(all: IncidentState[]) {
  // Feature the most complete incident: the one furthest through the pipeline.
  const s = [...all].sort((a, b) => Number(settled(b)) - Number(settled(a)) || b.tl.length - a.tl.length)[0];
  const inc = s?.inc;
  const t = s?.t;
  const runs = all.flatMap((x) => x.runs);
  const before = s?.runs.find((r) => r.kind === 'reproduce' && r.matched);
  const after = s?.runs.find((r) => r.id === t?.winner?.judgeRunId);
  const revert = s?.runs.find((r) => r.id === t?.revert?.runId);
  const confirms =
    s?.runs.filter((r) => (r.kind === 'reproduce' || r.kind === 'confirm') && r.matched).slice(0, 3) ?? [];
  const sig = inc?.failedRequests[0];
  const sigText = sig ? `${sig.method} ${new URL(sig.url, inc.origin).pathname} ${sig.status}` : '';
  const crumbs = inc?.breadcrumbs.filter((b) => b.kind !== 'nav').slice(-4) ?? [];
  const st = s ? status(s) : null;
  const ms = s?.ms ?? {};
  const prod = s?.runs.findLast((x) => x.kind === 'prod');
  const prodOk = !!prod && prod.status === 'passed' && !prod.matched;

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proof · from broken session to proven fix</title>
<meta name="description" content="Proof turns a user's broken session into a merged fix that Kane CLI has proven: red before, green after, red again on revert.">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="icon" href="data:image/svg+xml,${raw(encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 12"><rect width="10" height="6" rx="1" fill="#ff6b5e"/><rect y="6" width="10" height="6" rx="1" fill="#4cd68a"/></svg>'))}">
<style>${raw(CSS)}${raw(LANDING_CSS)}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="lnav"><div class="wrap">
  <a class="brand" href="/"><i aria-hidden="true"></i>Proof</a>
  <nav aria-label="Sections"><a href="#how">How it works</a><a href="#lock">Anti-cheat</a><a href="${KANE}">Kane CLI</a></nav>
  <div class="end"><a class="btn-l sm" href="${REPO}">GitHub</a><a class="btn-l sm primary" href="/incidents">Open console</a></div>
</div></header>

<main id="main">
<section class="wrap hero">
  <a class="pill" href="${KANE}" style="--i:0"><span class="mk" aria-hidden="true"></span>Every stage verified by Kane CLI</a>
  <h1 style="--i:1">From broken session to <em>proven</em> fix</h1>
  <p class="lead" style="--i:2">Proof takes what a user did when your app broke, has Kane CLI reproduce it in a real browser, lets three coding agents race to fix it, and opens a PR only for the fix Kane can show working.</p>
  <div class="cta" style="--i:3"><a class="btn-l primary" href="/incidents">Open the console</a><a class="btn-l" href="${REPO}">Read the code</a><code class="cmd"><b>$</b> proof repro session.json</code></div>

  ${
    s && inc
      ? html`<div class="shot" aria-label="The Proof console showing a real incident">
    <div class="shot-bar"><i></i><i></i><i></i><span>proof / incidents / ${inc.id}</span></div>
    <div class="shot-body">
      <div class="shot-side">${all.slice(0, 6).map((x) => {
        const xs = status(x);
        return html`<span class="item"${x === s ? raw(' aria-current="page"') : ''}><span class="dot ${xs.tone}"></span><span class="t">${x.inc.title ?? x.inc.id}</span><span class="m">${xs.text}</span></span>`;
      })}</div>
      <div class="shot-main">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><h3>${inc.title}</h3>${st ? badge(st.text, st.tone) : ''}</div>
        <div class="panel">${stepper(s)}</div>
        <div class="tiles">
          ${tile(inc.id, 'Before', before)}
          ${tile(inc.id, 'After', after)}
          ${tile(inc.id, 'Fix reverted', revert)}
        </div>
      </div>
    </div>
  </div>`
      : ''
  }
</section>

<section class="wrap trust">
  <p>Runs on the tools your team already uses</p>
  <div class="marks"><span class="m">kane-cli</span><span>Claude Code</span><span>Codex</span><span>GitHub</span><span>Vercel</span></div>
</section>

<section class="wrap statement">
  <p>Most bug reports end at “cannot reproduce”. <span>Proof makes Kane CLI the referee at every stage, so the agents that write a fix never grade their own work.</span></p>
</section>

<section class="wrap" id="how">
  <div class="split" style="border-top:0;padding-top:0">
    <h2><span class="eyebrow">How it works</span>Six stages, each one checked in a real browser</h2>
    <p>A failure only counts when Kane hits the user’s own signature, the same failed request or console error. Passing only counts when that failure is gone.</p>
  </div>
  <div class="bento">
    <div class="card"><div class="fig">
      ${crumbs.map((b) => html`<div class="fl"><span>${b.kind} ${b.text ?? b.label ?? ''}${b.value ? ` "${b.value}"` : ''}</span></div>`)}
      <div class="fl err"><span><code>${sigText}</code></span></div>
    </div><div><h3><small>01</small>Capture</h3><p>A script tag records clicks, inputs, console errors and failed requests. Users can add a note.</p></div></div>

    <div class="card"><div class="fig">
      ${confirms.map((r, i) => html`<div class="fl err"><span>Run ${i + 1}: <code>${sigText}</code></span><span class="num">${Math.round(r.durationS)}s</span></div>`)}
      <div class="fl"><span>Verdict</span>${s?.repro ? badge(`${s.repro.verdict === 'confirmed' ? 'Confirmed' : 'Flaky'} ${s.repro.hits}/${s.repro.of}`, 'red') : badge('Pending')}</div>
    </div><div><h3><small>02</small>Reproduce</h3><p>The session becomes a Kane objective. It has to fail the same way three times, or it is marked flaky.</p></div></div>

    <div class="card"><div class="fig"><div class="funnel-l">
      <div><i style="height:96px"></i><b>${inc?.breadcrumbs.length ?? 'n/a'}</b><small>events</small></div>
      <div><i style="height:60px"></i><b>${s?.minimal?.from ?? 'n/a'}</b><small>steps</small></div>
      <div><i style="height:24px"></i><b>${s?.minimal?.to ?? 'n/a'}</b><small>steps</small></div>
    </div></div><div><h3><small>03</small>Minimize</h3><p>Kane proves every remaining step is needed. The result becomes a locked regression test.</p></div></div>

    <div class="card"><div class="fig">
      ${(t?.entries ?? []).map((e) => html`<div class="fl${e.agent === t?.winner?.agent ? ' win' : ''}"><span>${e.label} <code class="mute">+${e.added} -${e.removed}</code></span>${badge(e.tampered.length ? 'Disqualified' : e.agent === t?.winner?.agent ? 'Winner' : e.passed ? 'Passed' : 'Failed', e.passed && !e.tampered.length ? 'green' : 'red')}</div>`)}
    </div><div><h3><small>04</small>Fix tournament</h3><p>Claude Code, Codex and a cheap model fix it in separate worktrees. Smallest diff that Kane passes wins, ties go to the faster agent.</p></div></div>

    <div class="card"><div class="fig"><div class="tri">
      ${[
        ['before', before?.status],
        ['after', after?.status],
        ['on revert', revert?.status],
      ].map(
        ([k, st]) =>
          html`<div class="${st === 'passed' ? 'g' : st ? 'r' : ''}">${st === 'passed' ? 'Green' : st ? 'Red' : 'Pending'}<small>${k}</small></div>`,
      )}
    </div></div><div><h3><small>05</small>Triple proof</h3><p>The winning patch is reverted and Kane must fail again, proving the fix is what fixed it.</p></div></div>

    <div class="card"><div class="fig">
      <div class="fl"><span>${s?.ship?.pr ? `PR #${s.ship.pr.split('/').pop()}` : 'Pull request'} with Proof Card</span>${ms.shipped ? badge('Opened', 'green') : badge('Pending')}</div>
      <div class="fl"><span>Kane on production</span>${prod ? badge(prodOk ? 'Passed' : 'Failed', prodOk ? 'green' : 'red') : badge('Pending')}</div>
      <div class="fl"><span>Reply with ${inc?.reporter?.name ?? 'the reporter'}’s steps</span>${s?.notify ? badge(s.notify.delivered ? 'Delivered' : 'Written', 'green') : badge('Pending')}</div>
    </div><div><h3><small>06</small>Ship and verify</h3><p>The PR carries videos, the minimal repro and a Kane evidence pack. Kane re-runs it on prod.</p></div></div>
  </div>
</section>

<section class="wrap" id="lock">
  <div class="split">
    <h2><span class="eyebrow">Anti-cheat</span>Nobody gets to weaken the test</h2>
    <p>Agents are good at making tests pass. Proof locks the repro before any agent sees the code, and every judge run re-checks the hash.</p>
  </div>
  <div class="lock">
    <div class="code"><div class="code-h"><span>${t?.lock?.repoPath ?? 'tests/regressions/inc_test.md'}</span><span class="g" style="color:var(--green)">${t?.lock ? `sha256 ${t.lock.sha256.slice(0, 12)}` : ''}</span></div>
<pre>${s?.lockedTest ?? 'No repro locked yet.'}</pre></div>
    <div class="checks">
      <div><h3>Locked before agents run</h3><p>The minimal repro is written as a Kane <code>_test.md</code> and its sha256 recorded. Agents get the steps, not a file they can edit: judges read the trusted copy.</p></div>
      <div><h3>Protected paths disqualify</h3><p>Touching the regression suite, unit tests or config is an instant loss, whatever Kane says.</p></div>
      <div><h3>Red again on revert</h3><p>The winning patch is un-applied and Kane must fail with the same signature, or the fix is not credited.</p></div>
    </div>
  </div>
</section>

<section class="wrap">
  <div class="numbers">
    <div><b>${runs.length.toLocaleString('en')}</b><span>Kane runs so far</span></div>
    <div><b>${inc && s?.minimal ? `${inc.breadcrumbs.length} → ${s.minimal.to}` : 'n/a'}</b><span>Session events to repro steps</span></div>
    <div><b>${t?.entries.length ?? 'n/a'}</b><span>Agents raced to fix it</span></div>
    <div><b>${s?.repro ? `${s.repro.hits} of ${s.repro.of}` : 'n/a'}</b><span>Runs that failed the same way</span></div>
  </div>
</section>

<section class="wrap closing">
  <h2>See a bug Proof closed</h2>
  <p>Every video, Kane run, diff and hash from one real incident, start to finish.</p>
  <div class="cta">${inc ? html`<a class="btn-l primary" href="/incidents/${inc.id}">Open the incident</a>` : ''}<a class="btn-l" href="/incidents">All incidents</a></div>
</section>
</main>

<footer class="lfoot"><div class="wrap"><span>Proof. Built on <a class="link" href="${KANE}">Kane CLI</a>. MIT.</span><a href="${REPO}">GitHub</a></div></footer>
</body>
</html>`;
}
