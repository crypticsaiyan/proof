# proof

**From broken user session to verified, merged fix. Kane CLI verifies every stage.**

A user hits a bug. Proof captures their session, has [Kane CLI](https://github.com/LambdaTest/kane-cli) reproduce it until it fails _the same way_, shrinks it to the smallest repro, lets three coding agents race to fix it, makes Kane judge every fix, and opens a PR with a **Proof Card**: before/after videos, the minimal steps, the tournament, and a triple proof (red before, green after, red again on revert).

```
user session ──► triage ──► reproduce x3 ──► minimize ──► fix tournament ──► revert check ──► PR + Proof Card ──► prod check ──► reporter notified
   (SDK)        (dedupe)      Kane            Kane         Kane judges        Kane            sealed evidence      Kane          "here are your steps"
```

## Why

Most bug reports die at "cannot reproduce". When they do get fixed, nobody proves the fix fixed _that_ bug, or that the test was not quietly weakened to pass. Proof makes Kane the referee at every step, and the agents never get to grade their own work.

## What each stage does with Kane

| Stage              | What happens                                                                                                                                                                                                                                                                                                                                                                | Kane's role                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Capture**        | `<script src=".../sdk.js">` records clicks, inputs, navigations, console errors, failed requests, rage clicks, an rrweb replay, and a "Report a bug" widget. Sentry/PostHog-style webhooks can feed the same ingest.                                                                                                                                                        |                                                               |
| **Triage**         | Clusters duplicate sessions by failure signature, ranks severity, titles it with a cheap model.                                                                                                                                                                                                                                                                             |                                                               |
| **Reproduce**      | Session becomes a Kane objective. `kane-cli run --agent --bug-detection stop` runs it. The failure must match the user's signature (same failed request or console error), not just "something failed". If Kane passes or fails differently, its step trace goes back to the model to revise the objective. Then 2 more independent runs: 3/3 = confirmed, otherwise FLAKY. | judge of "same bug"                                           |
| **Minimize**       | The model proposes the minimal steps (seeded by Kane's own root-cause analysis); Kane checks it, then proves every remaining step is needed. Falls back to delta debugging.                                                                                                                                                                                                 | every candidate                                               |
| **Fix tournament** | Claude Code, Codex and a cheap model each fix the bug in their own git worktree.                                                                                                                                                                                                                                                                                            | locked repro must pass, Kane regression suite must stay green |
| **Anti-cheat**     | The minimal repro becomes a `_test.md`, sha256-locked before any agent runs. Edits to protected paths disqualify. The winning patch is then reverted and Kane must fail again.                                                                                                                                                                                              | revert check                                                  |
| **Ship**           | Regression test committed to `tests/regressions/`, Kane evidence packs merged and validated (`kane-cli evidence merge/validate`), PR opened with the Proof Card.                                                                                                                                                                                                            | sealed evidence                                               |
| **After deploy**   | Kane re-runs the locked repro on production, then the reporter gets their own steps back, passing.                                                                                                                                                                                                                                                                          | prod check                                                    |
| **Stop hook**      | In everyday Claude Code sessions, the agent cannot stop while the Kane regression suite is red; failures are fed back.                                                                                                                                                                                                                                                      | gate                                                          |

**Video.** Kane has no video recording, so Proof launches its own Chrome, hands Kane `--cdp-endpoint`, screencasts the page over CDP and stitches the frames into MP4 with Kane's step remarks burned in as captions.

## Quickstart

Requirements: Node 24+, pnpm, Google Chrome, ffmpeg, `kane-cli` (logged in), and for the tournament the `claude` and `codex` CLIs (logged in). No API keys are needed: Proof uses your existing CLI logins.

```bash
npm install -g @testmuai/kane-cli && kane-cli login
git clone https://github.com/crypticsaiyan/proof && cd proof && pnpm install

# the demo store with real bugs
git clone https://github.com/crypticsaiyan/proof-demo-shop ../proof-demo-shop
(cd ../proof-demo-shop && pnpm install && PORT=3100 pnpm start) &

# dashboard on :4600
pnpm --filter @proof/server start &

# the full loop on a captured session
node packages/cli/src/proof.ts repro fixtures/incidents/checkout-negative-total.json
node packages/cli/src/proof.ts fix inc-checkout-negative-total --repo ../proof-demo-shop
node packages/cli/src/proof.ts ship inc-checkout-negative-total --repo ../proof-demo-shop
node packages/cli/src/proof.ts verify-prod inc-checkout-negative-total --url https://<your-prod-url>
```

Or let it run itself: start the server with `PROOF_AUTORUN=1 PROOF_TARGET_REPO=../proof-demo-shop`, add the SDK to the app, and break something.

## CLI

```
proof repro <incident.json | id> [--url <preview url>] [--no-minimize]
proof minimize <id> [--url <url>]
proof fix <id> --repo <path> [--base main] [--agents claude,codex,haiku]
proof ship <id> --repo <path> [--dashboard <url>] [--draft]
proof verify-prod <id> --url <prod url>
proof hook-stop                 Claude Code Stop hook
proof show <id> | proof ls | proof steps <incident>
```

Env: `PROOF_HOME` (state dir, default `.proof`), `PROOF_PARALLEL` (parallel Kane runs, default 3), `PROOF_LLM=off` (deterministic fallbacks only), `PROOF_LLM_MODEL` (default `haiku`), `PROOF_CLAUDE_MODEL`, `PROOF_CODEX_MODEL`.

## Making your app Proof-ready

Add `proof.config.json` to the repo:

```json
{
  "name": "my-app",
  "start": "node server.js",
  "portEnv": "PORT",
  "health": "/healthz",
  "unit": "npm test --silent",
  "regressions": "tests/regressions",
  "protected": ["tests/regressions/**", "test/**", "proof.config.json"]
}
```

Add the SDK: `<script src="https://<proof-server>/sdk.js" data-project="my-app" defer></script>`.

Add the Stop hook to `.claude/settings.json`:

```json
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "proof hook-stop", "timeout": 900 }] }] } }
```

## Layout

```
packages/recorder   CDP screencast -> MP4 + captions (zero deps)
packages/kane       kane-cli driver: NDJSON, run_end, exit codes, evidence packs, failure signatures
packages/engine     triage, reproduce, minimize, tournament, lock, ship, Proof Card, Stop hook
packages/sdk        browser capture SDK + report widget
packages/cli        `proof`
apps/server         ingest API + dashboard
```

State is plain files under `.proof/` (incidents, timelines, runs, videos), shared by the CLI, the dashboard and the hook.

## License

MIT
