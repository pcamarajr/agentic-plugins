---
description: Hypothesis-driven runtime debugging session. Captures "what happens" vs "what should happen", generates competing hypotheses, instruments the code with self-cleaning log statements that POST to a local collector, has the bug reproduced (automatically or by the user), evaluates the evidence, applies the evidence-backed fix, and asks the user to verify. Remove all instrumentation when the user confirms it's fixed.
disable-model-invocation: true
allowed-tools: Read Write Edit Glob Grep Bash AskUserQuestion
---

# /debug:run

A debugging loop built around **runtime evidence**, not code-reading guesses. The discipline, in order: hypothesize → instrument → reproduce → analyze → diagnose → fix → verify → clean up. Never skip ahead: no fix is applied until a hypothesis is confirmed by captured logs — but once one is, fix immediately and hand the verdict to the user.

Core rules that hold for the entire session:

- **Every inserted instrumentation line contains the literal marker `[claude-debug]`** (multi-line helpers are wrapped in `[claude-debug:start]` / `[claude-debug:end]` lines). This is what makes cleanup deterministic. No exceptions.
- **Never read the whole log file into context.** Count lines first (`wc -l`), then `grep` by `site`/`hyp` and read slices. The file is `.debug-mode/logs.ndjson`.
- **Instrumentation is temporary scaffolding.** It must never change behavior (fire-and-forget, errors swallowed) and must all be removed at the end.
- Keep `.debug-mode/session.md` updated at every phase transition — it is the resume point if the session is interrupted.

## Phase 0 — Intake

If the user's `/debug:run` invocation already describes the bug, extract what you can; ask only for what's missing, via **one** AskUserQuestion call:

1. **Observed** (header: "Observed") — what actually happens, as concretely as possible.
2. **Expected** (header: "Expected") — what should happen instead.
3. **Reproduction** (header: "Repro") — how to trigger it. Options: "I'll reproduce it manually in the app", "There's a failing test", "An HTTP request/script triggers it", Other.

Then set up the workspace:

- Ensure `.debug-mode/` exists and is gitignored (append `.debug-mode/` to `.gitignore` if missing).
- Write `.debug-mode/session.md` with: observed, expected, repro method, status `investigating`, round `0`.

## Phase 1 — Hypotheses

Read the relevant code paths (entry point of the repro → the place the symptom appears). Then write down **2–4 competing hypotheses** about the root cause. For each:

- One sentence stating the suspected mechanism.
- The **discriminating signal**: what runtime value or event ordering would confirm it and refute the others.

Quality bar: hypotheses must be mutually discriminable — if one set of logs can't tell two hypotheses apart, refine them or merge them. Record the hypothesis table (id `H1..Hn`, statement, discriminating signal) in `session.md` and show it to the user before instrumenting.

## Phase 2 — Instrument

1. **Start the collector** (skip if `curl -s http://127.0.0.1:7244/health` already responds):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/collector.mjs" --port 7244 --out .debug-mode/logs.ndjson
   ```

   Run it in the background. Confirm with `curl -s http://127.0.0.1:7244/health` before proceeding.

2. **Insert log statements** at the code sites that discriminate between hypotheses. Snippets, payload conventions, and placement guidance are in `reference.md` — read it before instrumenting. Essentials:
   - Payload shape: `{site, hyp, data}` — `site` is a unique `file:fn:line`-style id, `hyp` names the hypothesis(es) the entry discriminates, `data` holds only the relevant values (small, never whole objects of unknown size).
   - Node: `fetch('http://127.0.0.1:7244/log', …).catch(() => {})` one-liner ending in `// [claude-debug]`.
   - Browser/React: `navigator.sendBeacon(…)` ending in `// [claude-debug]`. Never log in a hot render path — prefer handlers and effects.
   - Log both sides of a boundary when the bug crosses frontend ↔ backend, so event ordering can be reconstructed from `seq`/`t`.

3. Record the list of instrumented files in `session.md`.

## Phase 3 — Reproduce (hybrid)

First try to reproduce **autonomously**: run the failing test, replay the HTTP request with `curl`, or run a small script — whatever the intake said triggers the bug.

If autonomous reproduction isn't possible, hand off to the user. Tell them, precisely:

1. **Wait for the dev server to pick up the instrumented code** (HMR/restart — reproducing too early hits non-instrumented code and produces empty logs).
2. The exact steps to perform, numbered.
3. To say "done" when finished.

After reproduction (either path), verify evidence actually arrived: `wc -l .debug-mode/logs.ndjson`. If it's empty, debug the pipeline before re-asking (is the collector healthy? did the dev server reload? is the instrumented path actually executed?) — don't burn the user's repro attempts on a broken pipe.

## Phase 4 — Analyze

Work the log file with `grep`/`wc`, reading only relevant slices:

```bash
wc -l .debug-mode/logs.ndjson
grep '"hyp":"H2"' .debug-mode/logs.ndjson | head -50
grep '"site":"checkout.ts:submit"' .debug-mode/logs.ndjson | tail -20
```

For each hypothesis, state the verdict — **confirmed / refuted / no signal** — citing specific log entries (by `seq` and content). Update `session.md`.

- **One hypothesis confirmed** → Phase 5.
- **All refuted or inconclusive** → refine: form new hypotheses from what the evidence *did* show, adjust the instrumentation (add/move/remove log sites), and run another reproduction round. Increment `round` in `session.md`.
- **After 3 rounds without a confirmed hypothesis, stop.** Iterative debugging effectiveness decays sharply after 2–3 attempts. Summarize for the user: everything the evidence established, everything ruled out, and your best remaining theory. Recommend restarting with a fresh framing (possibly a fresh session) rather than grinding — and offer to clean up the instrumentation or leave it for the next attempt.

## Phase 5 — Diagnose and fix

Once a hypothesis is confirmed, **apply the fix immediately** — no approval gate. The fix must be:

- **Evidence-backed**: directly addresses the confirmed hypothesis, nothing else.
- **Minimal and targeted**: typically a few lines, never a speculative rewrite.

Then report to the user in one block: the **diagnosis** (confirmed hypothesis + the evidence chain: specific log entries → conclusion) and the **fix applied** (files and the exact change). Leave the instrumentation in place — it now serves as the verification probe.

## Phase 6 — Verify (user gives the verdict)

If the reproduction was autonomous (test/curl/script), re-run it yourself first and check the logs — the discriminating signal should have flipped. Report what the evidence shows.

Then hand the verdict to the user. Ask them to reproduce again (remind them to wait for the dev-server reload), and collect the verdict via AskUserQuestion — this is the equivalent of Cursor's verification buttons:

- **"Fixed"** → Phase 7 (cleanup).
- **"Not fixed"** → read the fresh log slice, compare against the failing run, and go back to Phase 4 with the new evidence (this counts toward the round limit). The instrumentation is already live, so each retry costs the user one reproduction, nothing more.
- **"Partially / something else broke"** → treat as new evidence: capture what changed, update hypotheses, back to Phase 4.

## Phase 7 — Clean up

Only after the user answers "Fixed" (or chooses to stop the session):

1. Remove all instrumentation deterministically:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-instrumentation.mjs"
   ```

2. Verify nothing is left: `git grep -n --untracked -F "[claude-debug"` must return nothing (the pattern is an open prefix on purpose — it catches both `[claude-debug]` lines and `[claude-debug:start]`/`:end]` block markers).
3. Stop the collector: `kill "$(cat .debug-mode/collector.pid)"` (if the pidfile exists).
4. Update `session.md`: status `fixed` (or `stopped`), the diagnosis, and the fix applied.
5. Final report: diagnosis, evidence summary, files changed by the fix, confirmation that instrumentation count is zero.

If the session dies midway, `/debug:cleanup` performs steps 1–3 standalone.

## See also

- `reference.md` — instrumentation snippets per environment, payload conventions, placement guidance, collector API, troubleshooting.
- `/debug:cleanup` — standalone instrumentation removal (crash recovery, or "get this out of my diff").
