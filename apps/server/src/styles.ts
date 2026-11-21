// Proof UI: twin's design language (mono body, dot-matrix display, warm neutrals, color only
// for meaning: red = fails, green = passes), with Proof's own mark: a red-to-green block.

export const FONTS =
  'https://fonts.googleapis.com/css2?family=Doto:wght@900&family=JetBrains+Mono:wght@400;500;700&display=swap';

export const CSS = `
:root {
  --font-body: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --font-mark: 'Doto', 'JetBrains Mono', ui-monospace, monospace;
  --bg: #fafaf8; --surface: #ffffff; --code: #f4f4f1; --code-head: #ecece8; --rule: #e3e2dc;
  --text: #17181a; --muted: #62636a; --fail: #c3362b; --pass: #1d7a49; --focus: #2f5bd3; --warn: #a86a00;
  --term: #141517; --term-head: #1d1e21; --term-text: #d9d9d4;
  --pad: clamp(1rem, 4vw, 4rem);
}
@media (prefers-color-scheme: dark) {
  :root { color-scheme: dark; --bg: #111214; --surface: #16171a; --code: #17181b; --code-head: #1e1f23; --rule: #2a2b30;
    --text: #ececea; --muted: #9d9ea5; --fail: #f0695c; --pass: #5ec98d; --focus: #7d9dff; --warn: #e0a640; }
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; color: var(--text); font: 400 0.875rem/1.75 var(--font-body); font-variant-ligatures: none; -webkit-font-smoothing: antialiased; }
a { color: inherit; text-underline-offset: 3px; text-decoration-color: var(--rule); }
a:hover { text-decoration-color: currentColor; }
.frame { max-width: 112rem; margin: 0 auto; border-inline: 1px solid var(--rule); min-height: 100vh; }
header.top { display: flex; align-items: center; justify-content: space-between; padding: 1.1rem var(--pad); border-bottom: 1px solid var(--rule); }
.mark { font: 900 1.9rem/1 var(--font-mark); letter-spacing: 0.02em; text-decoration: none; display: inline-flex; align-items: center; gap: 0.45rem; }
.mark i { display: inline-block; width: 0.62em; height: 0.78em; background: linear-gradient(180deg, var(--fail) 0 50%, var(--pass) 50% 100%); }
header.top nav a { margin-left: 1.5rem; color: var(--muted); text-decoration: none; }
header.top nav a:hover { color: var(--text); }
main { padding: 2.5rem var(--pad) 5rem; }
.label { color: var(--muted); font-size: 0.75rem; letter-spacing: 0.02em; margin: 0 0 0.6rem; }
h1, h2 { font-family: var(--font-mark); font-weight: 900; line-height: 1.1; margin: 0 0 0.75rem; }
h1 { font-size: clamp(1.8rem, 3.4vw, 2.8rem); }
h2 { font-size: 1.5rem; }
h3 { font-size: 0.875rem; font-weight: 700; margin: 0 0 0.5rem; }
.muted { color: var(--muted); }
.fail { color: var(--fail); } .pass { color: var(--pass); } .warn { color: var(--warn); }
section { border-top: 1px solid var(--rule); padding: 2rem 0; }
section:first-of-type { border-top: 0; padding-top: 0; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 30rem), 1fr)); gap: 2rem; }
.grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: 1.25rem; }
.chip { display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; padding: 0 0.5rem; border: 1px solid currentColor; text-transform: uppercase; }
.chip.solid-fail { background: var(--fail); color: #fff; border-color: var(--fail); }
.chip.solid-pass { background: var(--pass); color: #fff; border-color: var(--pass); }
table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; }
th { text-align: left; font-weight: 500; color: var(--muted); border-bottom: 1px solid var(--rule); padding: 0.4rem 0.75rem 0.4rem 0; }
td { border-bottom: 1px solid var(--rule); padding: 0.55rem 0.75rem 0.55rem 0; vertical-align: top; }
tr.win td { font-weight: 700; }
ol.steps { margin: 0; padding-left: 1.6rem; }
ol.steps li { padding: 0.15rem 0; }
ol.steps li.check { color: var(--muted); }
blockquote { margin: 0 0 1rem; padding: 0.75rem 1rem; background: var(--code); border-left: 3px solid var(--fail); }
code, pre { font-family: var(--font-body); }
pre { background: var(--code); padding: 1rem; overflow: auto; font-size: 0.78rem; line-height: 1.6; margin: 0; }
.term { background: var(--term); color: var(--term-text); border: 1px solid #000; }
.term .bar { display: flex; justify-content: space-between; align-items: center; background: var(--term-head); padding: 0.3rem 0.75rem; font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; color: #9d9ea5; }
.term .bar b { color: var(--term-text); font-weight: 700; }
.term video, .term img { display: block; width: 100%; height: auto; background: #000; }
.term .cap { padding: 0.5rem 0.75rem; font-size: 0.75rem; color: #b9b9b4; }
.dot { display: inline-block; width: 0.55rem; height: 0.55rem; margin-right: 0.4rem; vertical-align: 0.05rem; }
.dot.fail { background: var(--fail); } .dot.pass { background: var(--pass); } .dot.info { background: var(--muted); }
/* timeline */
.tl { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); border: 1px solid var(--rule); }
.tl > div { padding: 0.85rem 1rem; border-right: 1px solid var(--rule); }
.tl > div:last-child { border-right: 0; }
.tl .t { font: 900 1.6rem/1 var(--font-mark); }
.tl .s { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.4rem; }
.tl .pending .t { color: var(--rule); }
.log { font-size: 0.78rem; max-height: 26rem; overflow: auto; border: 1px solid var(--rule); }
.log div { display: grid; grid-template-columns: 5.5rem 8rem 1fr; gap: 0.75rem; padding: 0.3rem 0.75rem; border-bottom: 1px solid var(--rule); }
.log div:last-child { border-bottom: 0; }
.log .stage { text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.04em; padding-top: 0.1rem; }
.cards { display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
.cards a.card { display: grid; grid-template-columns: 8rem 1fr auto; gap: 1.25rem; align-items: center; padding: 1rem 1.25rem; background: var(--surface); text-decoration: none; }
.cards a.card:hover { background: var(--code); }
.big { font: 900 2.2rem/1 var(--font-mark); }
.proof3 { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--rule); }
.proof3 > div { padding: 1rem 1.25rem; border-right: 1px solid var(--rule); }
.proof3 > div:last-child { border-right: 0; }
.empty { padding: 3rem; text-align: center; border: 1px dashed var(--rule); color: var(--muted); }
footer { border-top: 1px solid var(--rule); padding: 1.25rem var(--pad); color: var(--muted); font-size: 0.75rem; display: flex; justify-content: space-between; }
@media (max-width: 40rem) { .cards a.card { grid-template-columns: 1fr; } .log div { grid-template-columns: 4.5rem 1fr; } .log .stage { display: none; } .proof3 { grid-template-columns: 1fr; } }
`;
