// Proof console, dark-first like the devtools it sits next to: neutral product UI (Geist for interface, Geist Mono for data), the red-to-green
// block as the mark, and colour reserved for meaning: red = Kane failed, green = Kane passed.
// Rules: 13px type floor, sentence case, 4px spacing scale, one radius, motion only on
// transform/opacity with ease-out, visible focus, reduced motion = gentler, not none.

export const FONTS =
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap';

export const CSS = `
:root {
  color-scheme: dark;
  --sans: 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --bg: #08090a; --panel: #0f1011; --side: #08090a; --hover: #16171a; --sunk: #141518;
  --line: rgb(255 255 255 / 0.08); --line-2: rgb(255 255 255 / 0.14);
  --text: #f7f8f8; --text-2: #b4b8c0; --text-3: #8a8f98;
  --red: #ff6b5e; --red-bg: rgb(255 107 94 / 0.1); --red-line: rgb(255 107 94 / 0.28);
  --green: #4cd68a; --green-bg: rgb(76 214 138 / 0.1); --green-line: rgb(76 214 138 / 0.28);
  --amber: #f5b544; --amber-bg: rgb(245 181 68 / 0.1); --amber-line: rgb(245 181 68 / 0.28);
  --focus: #7aa2ff;
  --r: 10px;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px; --s8: 64px; --s9: 96px; --s10: 128px;
  --ease: cubic-bezier(0.23, 1, 0.32, 1);
  --shadow: none;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; color: var(--text); font: 400 14px/1.55 var(--sans); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
a { color: inherit; text-decoration: none; }
a.link { text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px; transition: text-decoration-color 150ms ease; }
a.link:hover { text-decoration-color: currentColor; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
code, .mono { font-family: var(--mono); font-size: 13px; font-variant-numeric: tabular-nums; }
code { overflow-wrap: anywhere; }
time, .num { font-variant-numeric: tabular-nums; }
h1, h2, h3, p { margin: 0; }
.skip { position: absolute; left: var(--s4); top: -64px; background: var(--text); color: var(--bg); padding: var(--s2) var(--s3); border-radius: var(--r); z-index: 10; }
.skip:focus { top: var(--s3); }

/* shell */
.app { display: grid; grid-template-columns: 272px minmax(0, 1fr); min-height: 100vh; background: linear-gradient(90deg, var(--side) 271px, var(--line) 271px 272px, transparent 272px); }
.side { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--side); border-right: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; height: 56px; padding: 0 var(--s4); font: 600 16px/1 var(--sans); letter-spacing: -0.01em; }
.brand i { width: 12px; height: 16px; border-radius: 2px; background: linear-gradient(180deg, var(--red) 0 50%, var(--green) 50% 100%); }
.side-h { display: flex; justify-content: space-between; align-items: center; padding: var(--s4) var(--s4) var(--s2); color: var(--text-3); font-size: 13px; font-weight: 500; }
.side nav { flex: 1; overflow: auto; padding: 0 var(--s2); }
.item { display: grid; grid-template-columns: 8px minmax(0, 1fr); gap: 2px var(--s3); align-items: center; padding: var(--s2) var(--s3); border-radius: 6px; transition: background-color 150ms ease; }
.item:hover { background: var(--hover); }
.item[aria-current='page'] { background: var(--panel); box-shadow: 0 0 0 1px var(--line); }
.item .t { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item .m { grid-column: 2; color: var(--text-3); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.side-f { padding: var(--s3) var(--s4); border-top: 1px solid var(--line); display: flex; gap: var(--s4); color: var(--text-3); font-size: 13px; }
.side-f a:hover { color: var(--text); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); }
.dot.red { background: var(--red); } .dot.green { background: var(--green); } .dot.amber { background: var(--amber); }
.main { min-width: 0; }
.topbar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: var(--s4); height: 56px; padding: 0 var(--s6); background: color-mix(in srgb, var(--bg) 85%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
.crumbs { display: flex; align-items: center; gap: var(--s2); color: var(--text-3); font-size: 13px; min-width: 0; }
.crumbs a:hover { color: var(--text); }
.crumbs span:last-child { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.actions { display: flex; gap: var(--s2); flex-shrink: 0; }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 var(--s3); border-radius: 6px; border: 1px solid var(--line-2); background: var(--panel); font-weight: 500; font-size: 13px; box-shadow: var(--shadow); transition: background-color 150ms ease, transform 120ms var(--ease); white-space: nowrap; }
.btn:hover { background: var(--hover); }
.btn:active { transform: scale(0.97); }
.btn.primary { background: var(--text); color: #08090a; border-color: var(--text); }
.btn.primary:hover { opacity: 0.9; }
.content { padding: var(--s6); max-width: 1280px; display: grid; gap: var(--s5); }

/* page head */
.head { display: grid; gap: var(--s3); }
.head h1 { font-size: 24px; line-height: 1.25; font-weight: 600; letter-spacing: -0.02em; text-wrap: balance; }
.head .sub { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3); color: var(--text-2); font-size: 13px; }
.sep { color: var(--line-2); }

/* badges */
.badge { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 var(--s2); border-radius: 6px; font-size: 13px; font-weight: 500; white-space: nowrap; border: 1px solid var(--line); background: var(--sunk); color: var(--text-2); }
.badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.badge.red { color: var(--red); background: var(--red-bg); border-color: var(--red-line); }
.badge.green { color: var(--green); background: var(--green-bg); border-color: var(--green-line); }
.badge.amber { color: var(--amber); background: var(--amber-bg); border-color: var(--amber-line); }
.badge.plain::before { display: none; }

/* panels */
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow); min-width: 0; }
.panel-h { display: flex; justify-content: space-between; align-items: center; gap: var(--s3); padding: var(--s3) var(--s4); border-bottom: 1px solid var(--line); }
.panel-h h2 { font-size: 14px; font-weight: 600; }
.panel-h .aside { color: var(--text-3); font-size: 13px; }
.panel-b { padding: var(--s4); }
.cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s5); align-items: start; }

/* stepper */
.stepper { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); padding: var(--s5) var(--s4) var(--s4); }
.step { position: relative; display: grid; gap: 2px; align-content: start; padding-right: var(--s3); min-width: 0; }
.step::before { content: ''; position: absolute; top: 9px; left: 22px; right: 4px; height: 2px; background: var(--line); border-radius: 2px; }
.step:last-child::before { display: none; }
.step::after { content: ''; position: absolute; top: 9px; left: 22px; right: 4px; height: 2px; background: var(--text); border-radius: 2px; transform-origin: left; transform: scaleX(0); }
.step.done:not(:last-child):has(+ .step.done)::after { transform: scaleX(1); }
.node { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--line-2); background: var(--panel); display: grid; place-items: center; margin-bottom: var(--s2); }
.step.done .node { background: var(--text); border-color: var(--text); }
.step.done .node::after { content: ''; width: 6px; height: 3px; border: solid #08090a; border-width: 0 0 2px 2px; transform: translateY(-1px) rotate(-45deg); }
.step.final.done .node { background: var(--green); border-color: var(--green); }
.step.active .node { border-color: var(--text); }
.step.active .node::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--text); animation: pulse 1.4s ease-in-out infinite; }
.step .l { font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.step .d { color: var(--text-2); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.step time { color: var(--text-3); font-family: var(--mono); font-size: 13px; }
.step.pending .l, .step.pending .d { color: var(--text-3); }
@keyframes pulse { 50% { opacity: 0.35; } }

/* proof videos */
.proof { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.clip { display: grid; grid-template-rows: auto auto 1fr; min-width: 0; border-right: 1px solid var(--line); }
.clip:last-child { border-right: 0; }
.clip-h { display: flex; justify-content: space-between; align-items: center; gap: var(--s2); padding: var(--s3) var(--s4); }
.clip-h b { font-weight: 600; }
.clip-h .num { color: var(--text-3); font-size: 13px; font-family: var(--mono); }
.media { aspect-ratio: 16 / 9; background: #0b0b0c; display: grid; place-items: center; color: #8b8b94; font-size: 13px; border-block: 1px solid var(--line); }
.media video { display: block; width: 100%; height: 100%; object-fit: contain; background: #0b0b0c; }
.clip p { padding: var(--s3) var(--s4) var(--s4); color: var(--text-2); font-size: 13px; }
.clip p b { color: var(--text); font-weight: 500; }

/* lists */
.rows { display: grid; }
.row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--s3); align-items: center; padding: 10px var(--s4); border-top: 1px solid var(--line); }
.row:first-child { border-top: 0; }
.row .k { min-width: 0; }
.row .k small { display: block; color: var(--text-3); font-size: 13px; }
.row.win { background: var(--green-bg); }
.steps { list-style: none; margin: 0; padding: 0; counter-reset: s; }
.steps li { counter-increment: s; display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: var(--s2); padding: 7px var(--s4); border-top: 1px solid var(--line); }
.steps li:first-child { border-top: 0; }
.steps li::before { content: counter(s); font-family: var(--mono); font-size: 13px; color: var(--text-3); padding-top: 1px; }
.steps li.check { color: var(--text-2); background: var(--sunk); }
.steps li.check::before { content: '✓'; font-family: var(--sans); }
.funnel { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--s2); font-family: var(--mono); font-size: 13px; color: var(--text-3); }
.funnel b { font: 600 20px/1 var(--sans); color: var(--text); letter-spacing: -0.02em; }
.kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s2) var(--s4); font-size: 13px; }
.kv dt { color: var(--text-3); }
.kv dd { margin: 0; min-width: 0; }
.quote { font-size: 15px; line-height: 1.6; }
.quote + .who { margin-top: var(--s2); color: var(--text-3); font-size: 13px; }
.sig { display: grid; gap: 6px; margin-top: var(--s4); }
.sig code { display: block; padding: 6px var(--s3); border-radius: 6px; background: var(--red-bg); color: var(--red); border: 1px solid var(--red-line); }
details summary { cursor: pointer; color: var(--text-2); font-size: 13px; padding: var(--s3) var(--s4); list-style: none; display: flex; align-items: center; gap: var(--s2); border-top: 1px solid var(--line); }
details summary::before { content: '›'; transition: transform 150ms var(--ease); }
details[open] summary::before { transform: rotate(90deg); }
details summary:hover { color: var(--text); }
.session { margin: 0; padding: 0 var(--s4) var(--s4) 40px; color: var(--text-2); font-family: var(--mono); font-size: 13px; max-height: 260px; overflow: auto; }
.mute { color: var(--text-3); }
.red { color: var(--red); } .green { color: var(--green); }

/* tables */
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th { text-align: left; font-weight: 500; color: var(--text-3); padding: 10px var(--s4); border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 10px var(--s4); border-bottom: 1px solid var(--line); vertical-align: middle; }
tr:last-child td { border-bottom: 0; }
td.nowrap { white-space: nowrap; }
tbody tr { transition: background-color 150ms ease; }
tbody tr:hover { background: var(--hover); }
tr.clickable { cursor: pointer; }

/* stats */
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.stat { padding: var(--s4); border-right: 1px solid var(--line); }
.stat:last-child { border-right: 0; }
.stat span { display: block; color: var(--text-3); font-size: 13px; }
.stat b { display: block; margin-top: var(--s1); font: 600 24px/1.2 var(--sans); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }

/* pipeline explainer */
.flow { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); }
.flow > div { padding: var(--s4); border-right: 1px solid var(--line); }
.flow > div:last-child { border-right: 0; }
.flow .n { font-family: var(--mono); font-size: 13px; color: var(--text-3); }
.flow h3 { margin: var(--s2) 0 var(--s1); font-size: 14px; font-weight: 600; }
.flow p { color: var(--text-2); font-size: 13px; }
.prog { display: flex; gap: 3px; }
.prog i { width: 14px; height: 6px; border-radius: 2px; background: var(--line); }
.prog i.on { background: var(--text-2); }
.prog i.ok { background: var(--green); }

/* log */
.log { max-height: 360px; overflow: auto; font-size: 13px; }
.log > div { display: grid; grid-template-columns: 72px 8px minmax(0, 1fr); gap: var(--s3); align-items: baseline; padding: 6px var(--s4); }
.log > div:hover { background: var(--hover); }
.log time { color: var(--text-3); font-family: var(--mono); }
.log .dot { align-self: center; }
.log span { overflow-wrap: anywhere; color: var(--text-2); }
.log span.hi { color: var(--text); font-weight: 500; }

/* reporter (standalone) */
.solo { max-width: 760px; margin: 0 auto; padding: var(--s7) var(--s5); display: grid; gap: var(--s5); }
.solo .brand { padding: 0; height: auto; }
.solo h1 { font-size: 28px; line-height: 1.2; font-weight: 600; letter-spacing: -0.02em; }

/* load moment: the pipeline fills in once */
html:not(.updated) .step.done:not(:last-child):has(+ .step.done)::after { animation: fill 420ms var(--ease) both; animation-delay: calc(var(--i, 0) * 70ms + 120ms); }
html:not(.updated) .content > * { animation: rise 360ms var(--ease) both; animation-delay: calc(var(--i, 0) * 40ms); }
@keyframes fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) {
  html:not(.updated) .step.done:not(:last-child):has(+ .step.done)::after { animation: none; }
  html:not(.updated) .content > * { animation: fade 200ms ease both; }
  .step.active .node::after { animation: none; }
  .btn:active { transform: none; }
}
@keyframes fade { from { opacity: 0; } }

@media (max-width: 1100px) {
  .cols { grid-template-columns: 1fr; }
  .flow { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .flow > div:nth-child(3) { border-right: 0; }
  .flow > div:nth-child(-n+3) { border-bottom: 1px solid var(--line); }
}
@media (max-width: 860px) {
  .app { grid-template-columns: 1fr; background: none; }
  .side { position: static; height: auto; flex-direction: row; align-items: center; border-right: 0; border-bottom: 1px solid var(--line); }
  .side .side-h, .side nav { display: none; }
  .side-f { border-top: 0; margin-left: auto; }
  .topbar { position: static; padding: 0 var(--s4); }
  .content { padding: var(--s4); }
  .proof { grid-template-columns: 1fr; }
  .clip { border-right: 0; border-bottom: 1px solid var(--line); }
  .clip:last-child { border-bottom: 0; }
  .stepper { grid-template-columns: 1fr; gap: var(--s3); }
  .stepper { gap: var(--s2); padding: var(--s4); }
  .step { grid-template-columns: 20px minmax(0, 1fr) auto; column-gap: var(--s3); align-items: center; }
  .step .node { grid-row: span 2; margin: 0; }
  .step time { grid-column: 3; grid-row: 1; }
  .panel-h .aside { display: none; }
  .step::before, .step::after { display: none; }
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stat:nth-child(2) { border-right: 0; }
  .stat:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
  .flow { grid-template-columns: 1fr; }
  .flow > div { border-right: 0; border-bottom: 1px solid var(--line); }
  .actions .btn:not(.primary) { display: none; }
}
`;
