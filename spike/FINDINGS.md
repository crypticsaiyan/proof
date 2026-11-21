# Recorder spike findings (kane-cli 0.10.6, Chrome 157)

## Video works

- Our Chrome (`--headless=new --remote-debugging-port=9333`) plus `kane-cli run --agent --cdp-endpoint http://127.0.0.1:9333` works. Kane drives our page target. No extra tab.
- `Page.startScreencast` on that target gives the frames Kane sees. Frames arrive only on repaint (20 frames in about 60s on a static page), so stitch with the concat demuxer using per-frame durations and output a constant 30 fps.
- Kane sets the viewport to 1920x1080 itself (`result.yaml` environment.resolution). Keep native aspect and scale to 1280 wide.
- Captions: ffmpeg has libass, so `subtitles=` burns the SRT in.
- Cost: about 12 to 19 credits per short run. The account has 11200.

## NDJSON on stdout (`--agent`)

- `stream_start`, `recording_state {session_id}`, `bifurcation {flows[]}`, `coverage`, `run_end`.
- Progress: `{step, status: running|done|failed, remark, ts}`. `remark` on done looks like `"click: Clicking the Learn more link"` (`kind: text`). `step` is offset by 1 from the evidence ordinal.
- `run_end` keys: status, summary, one_liner, final_state, reason, reason_code, result_code, duration, bifurcated, total_runs, context, credits_consumed, session_dir, run_dir, per_flow_metadata, run_id, test_url, coverage.
- Failure example: `reason: "Final verification failed: ..."`, `reason_code: assertion_error.final_verification`, `result_code: 710`. Exit code 1.
- Use `reason_code` and the failing step `kind` and `remark` as the error signature for repro matching.

## session_dir

`~/.testmuai/kaneai/sessions/<session_id>/`: `events.ndjson`, `execution.json`, `session.json` (credits, testcase_id), `tui.log`, `runner-stderr.log`, `code-export/test.py` (Playwright python), `evidence/<run_id>.evidence`.

## Evidence pack (`.evidence` = zip)

```
run.yaml                   run_id, title, surfaces, totals
failure.yaml               failures[] {test, ordinal, step, status, path, title (Kane triage), triage_status}
meta/metrics-catalog.yaml
tests/<slug>/result.yaml   status, duration, external_id.sharable_link, environment, steps[]
tests/<slug>/steps/<ord>-0-<n>/screenshot.jpg, step.json {kind,status,summary,duration_ms,url,element_rect}
tests/<slug>/steps/<n>/annotated.png       on click steps: red box on the element plus caption strip
tests/<slug>/steps/<n>/failure.yaml        on the failing step
tests/<slug>/logs/0-actions.ndjson         per action: instruction, selectors, generated_code
tests/<slug>/logs/0-console.ndjson, 0-network.har, 0-run.log
tests/<slug>/v16-trajectory/0-run_summary.json, 0-dag_diagram.md
```

`element_rect` in step.json lets us draw our own click highlight on the video.

## Bug detection (`--bug-detection stop`) on demo shop bug A

Objective: add Tea Tin, apply WELCOME20, checkout, place order, expect confirmation. 10 steps, 68s, 23 credits, exit 1.

- `run_end.reason_code: assertion_error.confirmed_product_bug`, `result_code: 740` (plain assertion failure is `assertion_error.final_verification` / 710).
- `run_end.summary` ends with machine-readable evidence lines:
  `evidence: http_error_response: POST http://localhost:3100/api/checkout -> 500 body: {...}` and
  `evidence: console_error: [checkout] failed: Internal error`.
- `per_flow_metadata[]` repeats result_code, reason_code, error_message, summary per flow.
- Failing step `failure.yaml` has `triage.rca {root_cause, category: application_issue/api_error, confidence}`, `severity`, `suggested_fix.summary`, plus refs to console/network at the failure.
- Kane's RCA independently named the cause: "accepted discount makes the displayed total negative".

Repro signature = `reason_code` + the set of `evidence:` lines (method, path, status) + console error text. Match that, not free-text summary.
