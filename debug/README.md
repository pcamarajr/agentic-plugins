# debug

Hypothesis-driven runtime debugging for Claude Code, modeled on [Cursor's Debug Mode](https://cursor.com/blog/debug-mode): instead of guessing fixes from reading code, the agent instruments your code with temporary log statements, captures **runtime evidence** while the bug is reproduced, applies the fix once a hypothesis is confirmed by the logs, and asks you to verify. You give the problem; it validates, tests, identifies, and fixes; you give the verdict.

## The loop

```
/debug:run
   │
   ├─ 0. Intake        what happens (observed) vs what should happen (expected)
   ├─ 1. Hypotheses    2–4 competing root-cause theories, each with a discriminating signal
   ├─ 2. Instrument    marked log statements → local NDJSON collector (127.0.0.1:7244)
   ├─ 3. Reproduce     agent tries automatically (test/curl/script); falls back to you
   ├─ 4. Analyze       grep the evidence, confirm/refute each hypothesis (max 3 rounds)
   ├─ 5. Fix           evidence-backed diagnosis + minimal fix, applied immediately
   ├─ 6. Verify        you reproduce again and give the verdict: Fixed / Not fixed
   └─ 7. Clean up      on "Fixed": deterministic removal of all instrumentation, collector stopped
```

Key mechanics:

- **Out-of-band log transport.** Instrumented code POSTs JSON to a tiny local collector (`fetch` from Node, `navigator.sendBeacon` from the browser). Logs land in `.debug-mode/logs.ndjson` — a greppable file, not the agent's context window. Frontend and backend logs interleave with server-side sequence numbers, so cross-boundary event ordering is reconstructable.
- **Self-cleaning instrumentation.** Every inserted line carries the literal marker `[claude-debug]`; removal is a deterministic script, not model edits. `git grep -F "[claude-debug"` verifies zero leftovers.
- **Bounded iteration.** After 3 instrumentation rounds without a confirmed hypothesis the agent stops, summarizes what the evidence established, and recommends a fresh start — per the research showing debugging effectiveness decays sharply after 2–3 attempts.

## Commands

| Command | What it does |
|---|---|
| `/debug:run` | Full debugging session (the loop above). |
| `/debug:cleanup` | Standalone removal of all instrumentation + collector shutdown. Crash recovery for abandoned sessions. |

## Requirements

- Node.js 18+ (collector and cleanup scripts; zero npm dependencies)
- Best supported: Node/TypeScript backends and React/browser frontends running on local dev servers
- `git` (used to locate instrumentation for cleanup; a plain filesystem scan is the fallback)

## What lands in your project

Everything lives under `.debug-mode/` (added to `.gitignore` automatically):

```
.debug-mode/
├── logs.ndjson     # captured runtime evidence
├── session.md      # session state — survives interruptions, resumable
└── collector.pid   # collector process id
```

Plus the temporary `[claude-debug]`-marked lines in your source while a session is active — all removed at the end (or by `/debug:cleanup`).

## Design notes

- Logs over breakpoints (no DAP): textual logs are language/environment-agnostic, work across the client↔server boundary simultaneously, and play to what LLMs do best — reading text. Same call Cursor made.
- Collector port is `7244` to avoid colliding with Cursor's own ingest server (`7242`).
- Research grounding: runtime-state visibility beats pass/fail signals ([LDB](https://arxiv.org/abs/2402.16906), [print debugging](https://arxiv.org/abs/2401.05319)); scientific-method loops improve diagnosis ([AutoSD](https://arxiv.org/abs/2304.02195)); iteration decays fast ([Debugging Decay Index](https://arxiv.org/abs/2506.18403)).

## Roadmap (intentionally out of v1)

- Automated reproduction harnesses (recorded repro scripts replacing manual repro)
- Docker / remote (SSH, staging) collector reachability
- Production-bug intake (Sentry/PostHog stack traces as hypothesis seeds)
