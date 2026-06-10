# /debug:run — reference

## Collector API

`scripts/collector.mjs` — zero-dependency Node HTTP server, localhost only.

| Endpoint | Method | Behavior |
|---|---|---|
| `/log` | POST | Body: JSON object, NDJSON batch, or plain text (sendBeacon). Each entry appended to the out file as one NDJSON line, stamped with server `t` (ISO) and monotonic `seq`. Returns 204. |
| `/health` | GET | `{ok, seq, out, pid}`. Returns 200. |
| any | OPTIONS | CORS preflight (`Access-Control-Allow-Origin: *`). Returns 204. |

Flags: `--port` (default `7244`), `--out` (default `.debug-mode/logs.ndjson`). Writes `collector.pid` next to the out file. Caps the log at 50 MB (drops further entries, appends one error entry), caps request bodies at 1 MB. Exits 1 on `EADDRINUSE` — `GET /health` first; if a previous collector is alive, reuse it.

Port 7244 was chosen to not collide with Cursor's Debug Mode ingest server (7242), so both can run on the same machine.

## Payload convention

```json
{ "site": "src/checkout.ts:submitOrder:42", "hyp": "H2", "data": { "cartId": "…", "total": 0 } }
```

- `site` — unique id per log statement, `path:function:line` style. Uniqueness is what makes `grep '"site":…'` reconstruct an execution path.
- `hyp` — which hypothesis this entry discriminates (`"H1"`, or `"H1,H3"` when shared).
- `data` — only the values needed for the verdict. Keep it small and JSON-safe: primitive fields, lengths, ids, booleans. Never spread whole objects of unknown size (request bodies, ORM entities, React props).

The collector stamps `t` and `seq` server-side; entries from browser and server interleave in arrival order, which is what lets you reconstruct cross-boundary event ordering.

## Instrumentation snippets

Every snippet is **one line** and **ends with `// [claude-debug]`**. Behavior-neutral: fire-and-forget, all errors swallowed.

### Node (18+, global fetch) — servers, APIs, scripts

```ts
fetch('http://127.0.0.1:7244/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: 'src/api/auth.ts:login:31', hyp: 'H1', data: { userId, sessionExists: !!session } }) }).catch(() => {}) // [claude-debug]
```

For processes that may exit before the request flushes (short-lived CLI scripts, process handlers), use a sync file append instead — point it at the **absolute** path of `.debug-mode/logs.ndjson` (the collector and direct appends share the file safely; direct appends just lack `t`/`seq`, so include your own `ts: Date.now()` in `data`):

```js
require('node:fs').appendFileSync('/abs/path/.debug-mode/logs.ndjson', JSON.stringify({ site: 'bin/job.js:main:12', hyp: 'H2', data: { ts: Date.now(), exitCode } }) + '\n') // [claude-debug]
```

(ESM without `require`: `(await import('node:fs')).appendFileSync(…)`.)

### Browser / React

`sendBeacon` survives page navigation and never throws on network failure:

```ts
navigator.sendBeacon('http://127.0.0.1:7244/log', JSON.stringify({ site: 'src/Cart.tsx:handleAdd:58', hyp: 'H1', data: { qty, optimistic: true } })) // [claude-debug]
```

Inside JSX, wrap in an expression container or move the call into the handler/effect — never leave a bare statement in JSX. If you need a multi-line helper (e.g. a `useEffect` that logs a state transition), wrap the whole block:

```tsx
// [claude-debug:start]
useEffect(() => {
  navigator.sendBeacon('http://127.0.0.1:7244/log', JSON.stringify({ site: 'src/Cart.tsx:itemsEffect', hyp: 'H3', data: { count: items.length, ids: items.map(i => i.id) } }))
}, [items])
// [claude-debug:end]
```

## Placement guidance

- **Discriminate, don't narrate.** Each log site exists to confirm or refute a specific hypothesis. If you can't say which hypothesis a site serves, don't add it.
- **Boundaries first.** The highest-value sites are where data crosses a boundary: handler entry/exit, API request leaving the client, request arriving at the server, response received, state committed. A bug is localized by finding the boundary where "still correct" becomes "wrong".
- **Order matters as much as values.** For race/timing hypotheses, log both sides of the suspected race with minimal `data` — the collector's `seq` gives you the interleaving.
- **Hot paths:** never log inside a React render body, a tight loop, or a per-frame callback — it floods the file toward the 50 MB cap and drowns the signal. Log in handlers, effects, and at loop boundaries (first iteration, condition flips, final tally).
- **Conditional logging** beats volume: `if (total === 0) fetch(…)` captures exactly the anomalous case.

## Troubleshooting the pipeline

| Symptom | Likely cause | Fix |
|---|---|---|
| `logs.ndjson` empty after repro | Dev server hadn't reloaded the instrumented code | Wait for HMR/restart, repro again |
| Empty, and reload was fine | Instrumented path not actually executed | Re-check the repro steps reach that code; add one log at a site you're *certain* runs to validate the pipe |
| Browser logs missing, server logs present | Page served over HTTPS while collector is HTTP, or CSP `connect-src` blocks localhost | Check the browser console for blocked-request errors; sendBeacon fails silently — temporarily switch that site to `fetch(…).catch(e => {})` and inspect |
| Collector won't start (exit 1) | Port 7244 busy | `curl -s http://127.0.0.1:7244/health` — if it answers, it's a previous collector: reuse it. Otherwise pick `--port 7245` and update the snippet URLs |
| Log file huge | A hot path got instrumented | `grep -c '"site":"…"' ` per site to find the flooder, remove that line, restart the round |

## Session state — `.debug-mode/session.md`

Keep it current at every phase transition; it is the resume point after an interruption (new session: read it, check `git grep --untracked -F "[claude-debug]"` and collector health, continue from `status`).

```markdown
# Debug session — <short bug title>
- Status: investigating | diagnosed | fixing | verifying | fixed | stopped
- Round: 1
- Observed: …
- Expected: …
- Repro: …

## Hypotheses
| id | statement | discriminating signal | verdict |
|----|-----------|----------------------|---------|
| H1 | …         | …                    | pending |

## Instrumented files
- src/Cart.tsx
- src/api/cart.ts

## Evidence log
- Round 1: H1 refuted (seq 12–18 show …), H2 confirmed (seq 23: total=0 before discount applied)
```

## Design rationale (why logs, not breakpoints)

Modeled on Cursor's Debug Mode: textual runtime logs are language- and environment-agnostic, work across the frontend ↔ backend boundary simultaneously, and land in a greppable file instead of the context window. Research backs the key choices: runtime-state visibility beats pass/fail test signals (LDB, arXiv:2402.16906; print-debugging, arXiv:2401.05319); structured hypothesize→experiment→observe loops improve diagnosis quality (AutoSD, arXiv:2304.02195); and iterative debugging decays sharply after 2–3 attempts, which is where the 3-round limit comes from (Debugging Decay Index, arXiv:2506.18403).
