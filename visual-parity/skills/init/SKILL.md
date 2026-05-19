---
description: One-time setup for the visual-parity plugin in this project — installs Playwright + pixelmatch, copies the parity scripts into .visual-parity/scripts, writes .visual-parity/config.md, and adds .visual-parity/artifacts to .gitignore.
disable-model-invocation: true
allowed-tools: Read Write Edit Glob Bash AskUserQuestion
---

# /visual-parity:init

Set this project up so `/visual-parity:run` can work without any further configuration. Run this **once per project** — re-running is safe (idempotent).

## What you will produce

After this skill finishes, the project root must contain:

```
.visual-parity/
  config.md            # Project-wide defaults (data attribute, viewports, thresholds, paths)
  scripts/             # Copied from the plugin so the user can edit them
    capture-parity.mjs
    list-parity-targets.mjs
    post-capture-summary.mjs
    parity.config.example.json
  artifacts/           # Created on first /visual-parity:run; gitignored
```

…plus Playwright + pixelmatch + pngjs in the project's `devDependencies`, Chromium downloaded, and `.visual-parity/artifacts/` appended to `.gitignore`.

## Steps

### 1. Detect the package manager

Look at the project root, in this order:

| File | Manager | Install command |
|---|---|---|
| `pnpm-lock.yaml` | pnpm | `pnpm add -D playwright pixelmatch pngjs` |
| `yarn.lock` | yarn | `yarn add -D playwright pixelmatch pngjs` |
| `bun.lockb` | bun | `bun add -d playwright pixelmatch pngjs` |
| `package-lock.json` or no lockfile | npm | `npm install -D playwright pixelmatch pngjs` |

If `package.json` does not exist, stop and tell the user: "No `package.json` found — visual-parity expects a Node project. Run `npm init -y` first, then re-run `/visual-parity:init`."

### 2. Ask the user 4 questions (use AskUserQuestion)

Ask these in **one** AskUserQuestion call:

1. **Target attribute** (header: "Attribute") — what selector strategy will you use?
   - `data-testid` (recommended; widely used)
   - `data-element-id` (uppercase tag-cased ids, e.g. `Footer_Newsletter`)
   - `data-qa`
   - `data-test`
   - Plain CSS selectors only (no convention)

2. **Default viewports** (header: "Viewports", multiSelect) — capture at which sizes?
   - mobile 375×900 (default on)
   - tablet 768×900 (default on)
   - desktop 1024×900 (default on)
   - wide 1440×900 (default off)

3. **Diff thresholds** (header: "Thresholds") — how strict is "match"?
   - Strict — `maxDiffPixelRatio: 0.005`, `maxDiffPixels: 250`
   - **Normal — `0.01` / `500`** (recommended)
   - Lenient — `0.02` / `1500`

4. **Writable scope** (header: "Writable scope") — when the parity loop fails, where may the subagent edit code?
   - Anywhere under the project root (no lock)
   - Only under `src/` (typical web app)
   - Custom — I'll edit `.visual-parity/config.md` myself afterwards
   - View-only — never edit code (only useful if both URLs are external; the loop degrades to single-pass report)

### 3. Write `.visual-parity/config.md`

Create the directory if missing. Write this file (substituting answers from Step 2):

```markdown
# visual-parity config

This file is the source of truth for `/visual-parity:run`. Edit it freely.

## Target attribute

`data_attribute`: <answer 1>

The plugin defaults to `[<attr>="<id>"]` selectors. You can always override per-target by passing a full CSS selector directly when prompted by `/visual-parity:run`.

## Viewports

```
- name: mobile,   width: 375,  height: 900
- name: tablet,   width: 768,  height: 900
- name: desktop,  width: 1024, height: 900
(- name: wide,    width: 1440, height: 900)
```

Only include the ones the user picked.

## Thresholds

- `maxDiffPixelRatio`: <answer 3 numeric>
- `maxDiffPixels`: <answer 3 numeric>

## Paths

- `writable_paths`: <answer 4 — single-item array, e.g. ["src/**"], or empty array if view-only>
- `read_only_paths`: []   # add globs the parity subagent must NEVER edit (e.g. legacy/**)

## Mask + cleanup defaults

- `mask_selectors`: []     # nodes to remove before capture (e.g. ".trustpilot-widget", "iframe[src*='youtube']")
- `remove_selectors`: []   # nodes to remove during preparePage (e.g. consent banners)
- `strip_fixed_and_sticky`: true   # remove position:fixed/sticky overlays that pollute crops
- `scroll_policy`: bottom   # "bottom" | "top"; controls whether the page scrolls to footer before capture
- `scroll_container_selector`: null   # optional inner scroll container (rare; for SPAs that don't scroll <body>)
```

(Render exactly that as Markdown — the keys are read as-is by the run skill. Do NOT use YAML frontmatter; this is a human-edited file.)

### 4. Copy bundled scripts into the project

```bash
mkdir -p .visual-parity/scripts
cp "${CLAUDE_SKILL_DIR}/../../scripts/capture-parity.mjs" .visual-parity/scripts/
cp "${CLAUDE_SKILL_DIR}/../../scripts/list-parity-targets.mjs" .visual-parity/scripts/
cp "${CLAUDE_SKILL_DIR}/../../scripts/post-capture-summary.mjs" .visual-parity/scripts/
cp "${CLAUDE_SKILL_DIR}/../../scripts/parity.config.example.json" .visual-parity/scripts/
chmod +x .visual-parity/scripts/*.mjs
```

If `.visual-parity/scripts/capture-parity.mjs` already exists, **do not overwrite** — print a warning that the user has a customized copy, and skip the copy step entirely. Mention they can re-eject by deleting `.visual-parity/scripts/` first.

### 5. Install npm dependencies

Run the install command picked in Step 1. Then:

```bash
npx playwright install chromium
```

This downloads Chromium (~150MB). Mention this to the user before running.

### 6. Update `.gitignore`

Append (idempotent — check for the exact line first):

```
.visual-parity/artifacts/
```

If `.gitignore` does not exist, create it with just that line.

### 7. Report

Print a concise summary:

- Package manager: <detected>
- Config written to: `.visual-parity/config.md`
- Scripts in: `.visual-parity/scripts/`
- Playwright: installed, Chromium downloaded
- Next: run `/visual-parity:run` and follow the intake prompts.

## Idempotency rules (re-running init must not destroy work)

- **Do not overwrite** `.visual-parity/config.md` if it exists. Ask the user whether to overwrite or skip (use AskUserQuestion, two options).
- **Do not overwrite** any file in `.visual-parity/scripts/` if it exists (see Step 4).
- Skip `npx playwright install chromium` if `~/Library/Caches/ms-playwright/chromium-*` (macOS) or `~/.cache/ms-playwright/chromium-*` (Linux) already exists.
- `.gitignore` append: check before appending.

## See also

- `reference.md` — config.md schema, package-manager detection details, edge cases.
- `/visual-parity:run` — the main loop.
