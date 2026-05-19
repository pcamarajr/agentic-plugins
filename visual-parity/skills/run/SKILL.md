---
description: Run a visual-parity loop between a legacy reference URL and a new URL. Captures cropped screenshots, diffs them with pixelmatch, then spawns a subagent that iterates CSS in writable_paths until every target × state × viewport passes thresholds.
disable-model-invocation: true
allowed-tools: Read Write Edit Glob Bash AskUserQuestion Task
---

# /visual-parity:run

The main loop. Compares a legacy reference URL with a new URL, identifies pixel diffs in named regions, and (when configured) iterates CSS in the user's project until human-eye parity is reached.

## Pre-flight

Before anything else, verify `.visual-parity/config.md` and `.visual-parity/scripts/capture-parity.mjs` exist. If either is missing, stop and instruct the user: **"Run `/visual-parity:init` first."**

Parse `.visual-parity/config.md` and hold these fields in scope for the rest of the run:

- `data_attribute` (default `data-testid`)
- `viewports` (the default list)
- `thresholds`
- `writable_paths`, `read_only_paths`
- `mask_selectors`, `remove_selectors`, `strip_fixed_and_sticky`, `scroll_policy`, `scroll_container_selector`

## Intake

Ask the user via **one** AskUserQuestion call. Four questions, in this order:

1. **Legacy URL** (header: "Legacy URL", text input via "Other") — full URL to the reference rendering.
2. **New URL** (header: "New URL", text input via "Other") — full URL to the new rendering.
3. **Target** (header: "Target", text input via "Other") — one of:
   - A `data_attribute` value (e.g. `site-header`) → the skill builds `[<data_attribute>="<value>"]`.
   - A full CSS selector starting with `[`, `#`, `.`, or `:` → use verbatim.
   - A component file/directory path → scan it with `node .visual-parity/scripts/list-parity-targets.mjs <path> --attr <data_attribute>` and propose the discovered ids to the user.
4. **Scope label** (header: "Scope", text input via "Other") — short kebab-case name for the artifacts directory (e.g. `header`, `footer`, `pdp-image-gallery`).

If the user provides a component path in (3), run `list-parity-targets.mjs` first, then present the discovered ids back via a second AskUserQuestion call so the user picks which ones to capture (multiSelect).

### Optional: interactive states

After the four required answers, ask whether any of the discovered targets need interactive states (accordion-open, dialog-open, hover). Default: no. If yes, gather one set per target: `state name + click selector + wait ms`. This is best done with a follow-up AskUserQuestion when the user opts in.

## Build the parity config

Write to `.visual-parity/artifacts/<scope>/parity.config.json`. Template:

```json
{
  "scope": "<scope>",
  "legacyUrl": "<legacy url>",
  "newUrl": "<new url>",
  "ignoreHTTPSErrors": true,
  "viewports": [<from config.md>],
  "thresholds": <from config.md>,
  "maskSelectors": [<from config.md>],
  "removeSelectors": [<from config.md>],
  "stripFixedAndSticky": <from config.md>,
  "scrollPolicy": "<from config.md>",
  "scrollContainerSelector": <from config.md or null>,
  "targets": [
    {
      "id": "<target id>",
      "selector": "<resolved selector>",
      "cssRoots": [<inferred from selector — see Inference below>],
      "states": [{ "name": "default", "actions": [] }, ...optional extra states]
    }
    // ...one entry per chosen target
  ]
}
```

### cssRoots inference

When the user picked targets via `list-parity-targets.mjs`, the script already proposed `cssRoots` from each match's directory. Carry those through. When the user typed a raw selector, set `cssRoots: []` — the subagent will figure out which files to edit from the diff PNGs.

## Capture

```bash
node .visual-parity/scripts/capture-parity.mjs --config .visual-parity/artifacts/<scope>/parity.config.json
```

The bundled `PostToolUse` hook will print a compact pass/fail table after this returns. Read `.visual-parity/artifacts/<scope>/parity-report.json` for the structured result.

If exit code is 0: **done**. Print the artifact paths and stop.

If exit code is 2: capture itself failed. Print the error, suggest checking that:
- The dev server is running and both URLs respond.
- The selector matches at least one element on each page.
- Chromium is installed (the `PreToolUse` hook should have handled this; if not, run `npx playwright install chromium`).

## Iterate (the parity loop)

If capture returned exit code 1 (threshold failure), check `writable_paths`:

- **Empty (view-only mode):** print the failure report and stop. Tell the user: "This is a view-only configuration — edit `.visual-parity/config.md` to add `writable_paths` and run again to enable the iteration loop." Do not attempt to fix anything.
- **Non-empty:** enter the iteration loop.

### Iteration loop

For up to **5 iterations** (override with `max_iterations` in config.md if present):

1. Read `parity-report.json` and the failing diff PNGs.
2. Spawn a subagent with the **Task tool**, `subagent_type: "general-purpose"`. Use this prompt template (substitute the bracketed parts):

```
You are the parity-fix subagent for the visual-parity plugin.

Your job: make the failing targets pass by editing CSS in the new tree.

Inputs
- Parity report:        .visual-parity/artifacts/<SCOPE>/parity-report.json
- Diff PNGs (per fail): .visual-parity/artifacts/<SCOPE>/<TARGET>/<STATE>/<VIEWPORT>/{legacy,new,diff}.png
- Project conventions: read the project's CLAUDE.md and AGENTS.md (if present) before editing. Follow established CSS patterns — do not introduce a new styling approach.

Boundaries
- Writable paths:  <WRITABLE_PATHS>
- Read-only paths: <READ_ONLY_PATHS>
- Never edit files outside writable_paths. If a fix appears to require an edit outside, STOP and return that finding without editing.

What to do
1. For each failing target × state × viewport in the report:
   a. View the diff PNG. Identify what differs (spacing, font, color, layout, missing element).
   b. Use the target's cssRoots as a starting hint; if empty, search writable_paths for the rendered selector.
   c. Apply the minimum CSS change to close the gap. Prefer adjusting tokens / existing variables over hardcoding.
   d. Do NOT change DOM structure unless CSS cannot close the gap. If you must, simplify rather than mirror legacy.
2. After all targets in this iteration are addressed, re-run capture:
   node .visual-parity/scripts/capture-parity.mjs --config .visual-parity/artifacts/<SCOPE>/parity.config.json
3. Return a short summary: which files you changed, which targets still fail, and your best guess at the next step.

What you must NOT do
- Don't write to legacy/reference paths (read_only_paths).
- Don't add stateful UI (useState, focus handlers, JS toggles) for visibility chrome that CSS can express.
- Don't change the parity config.
- Don't add new dependencies.
```

3. Re-read `parity-report.json` after the subagent returns.
4. If `pass === true`: print the final summary, list files changed (from the subagent's reply), stop.
5. If `pass === false` and iteration < max: loop.
6. If max iterations exhausted: print remaining failures and the subagent's last summary. Suggest the user inspect the diff PNGs manually.

## Final report

Always print:

- Pass/fail status overall.
- Per-target × state × viewport table (the PostToolUse hook handles this — let it stand).
- Files changed (consolidated across iterations).
- Artifact directory: `.visual-parity/artifacts/<scope>/`.
- Any deferred risks the subagent flagged.

## See also

- `reference.md` — config schema, action types, subagent prompt rationale, viewports table, failure-mode cheatsheet.
- `/visual-parity:init` — one-time project setup.
- `.visual-parity/scripts/capture-parity.mjs` — the capture/diff implementation.
