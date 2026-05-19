# visual-parity

Visual parity loop for UI migrations. Compares a **legacy reference URL** with a **new URL**, captures cropped screenshots at multiple viewports, diffs them with pixelmatch, then **iterates CSS in your project** until the renders match human-eye.

Built for the case where you have an existing UI you trust (legacy live, a staging URL, a previous branch) and a new one you're building, and you want a tight feedback loop to close the gap.

## What it does

| Skill | What it does |
|---|---|
| `/visual-parity:init` | One-time setup. Installs Playwright + pixelmatch, copies the parity scripts into `.visual-parity/scripts/`, writes `.visual-parity/config.md`, registers no hooks (they ship with the plugin). |
| `/visual-parity:run` | The main loop. Intake URLs + target → build parity config → capture screenshots → diff → if failing, spawn a subagent that iterates CSS until every target × state × viewport passes. |

## Quick start

### 1. Install

```bash
claude /plugin marketplace add pcamarajr/agentic-plugins
claude /plugin install visual-parity@agentic-plugins
```

### 2. Initialize in your project

```bash
cd your-project
claude
# inside Claude Code:
/visual-parity:init
```

You'll be asked four questions:

- **Target attribute** — `data-testid` (recommended), `data-element-id`, `data-qa`, `data-test`, or plain CSS.
- **Viewports** — which sizes to capture (mobile / tablet / desktop / wide).
- **Thresholds** — strict / normal / lenient diff tolerance.
- **Writable scope** — where the parity subagent may edit code (or "view-only" if both URLs are external).

### 3. Run the parity loop

```bash
/visual-parity:run
```

Intake asks for: legacy URL, new URL, target (attribute value, CSS selector, or component path), and a scope label. The loop runs until every target × state × viewport passes the thresholds, or 5 iterations elapse.

## Requirements

- Node.js 18+
- A project with `package.json` at its root (the init step adds Playwright + pixelmatch + pngjs as devDependencies)
- Two URLs that render the regions you want to compare. Both should be reachable from your local machine; `localhost` and external HTTPS hosts both work.
- A target you can select via CSS — usually a data attribute like `data-testid="site-header"`.

## Configuration

`.visual-parity/config.md` is the source of truth for project-wide defaults. Hand-edit it freely — the run skill re-reads it on every invocation.

```markdown
data_attribute: data-testid
viewports:
  - { name: mobile,  width: 375,  height: 900 }
  - { name: tablet,  width: 768,  height: 900 }
  - { name: desktop, width: 1024, height: 900 }
thresholds:
  maxDiffPixelRatio: 0.01
  maxDiffPixels: 500
writable_paths: ["src/**"]
read_only_paths: []
mask_selectors: []
remove_selectors: []
strip_fixed_and_sticky: true
scroll_policy: bottom
```

See `skills/init/reference.md` for the full schema and `skills/run/reference.md` for per-run parity config (`parity.config.json`) details and action types.

## Examples

`examples/` ships with two real-world starting points:

- [`framework-migration.config.json`](./examples/framework-migration.config.json) — staging vs. localhost during a framework migration; multi-target, interactive states.
- [`design-system-refactor.config.json`](./examples/design-system-refactor.config.json) — same URL on two branches (via query string), tight thresholds, hover states.

Both files are valid `parity.config.json` inputs you can drop into `.visual-parity/artifacts/<scope>/` and pass directly to `capture-parity.mjs`.

## How the iteration loop works

When the first capture fails thresholds and `writable_paths` is non-empty:

1. The run skill reads `parity-report.json` and the diff PNGs.
2. It spawns a `general-purpose` subagent with a structured prompt that includes the failing targets, the diff PNG paths, and `writable_paths` / `read_only_paths` boundaries.
3. The subagent reads your project's `CLAUDE.md` / `AGENTS.md` first (so it follows your CSS conventions), edits files in `writable_paths`, and re-runs capture.
4. The run skill re-reads the report. If passing → done. If failing and iteration < 5 → spawn another subagent. Otherwise → report remaining failures.

The boundaries are **prompt-enforced**, not sandboxed. Review the subagent's diffs.

## View-only mode

If you set `writable_paths: []`, the iteration loop is skipped. The plugin captures and diffs, prints the report, and stops. This is the right shape when you don't control either URL's code — useful for compliance checks, but not the plugin's primary use case.

## Hooks

The plugin ships two hooks that activate automatically when the plugin is enabled:

- **PreToolUse (Bash)** — `ensure-chromium.sh`: if a Bash command runs `capture-parity.mjs` and Chromium is missing, install it via `npx playwright install chromium`. No-ops on every other Bash call.
- **PostToolUse (Bash)** — `post-capture-summary.sh`: after `capture-parity.mjs` runs, parse the resulting `parity-report.json` and print a compact pass/fail table to the terminal.

To disable Chromium auto-install set `VISUAL_PARITY_SKIP_CHROMIUM_INSTALL=1` in your shell.

## Limitations

- **Chromium only.** No cross-browser support. Use Playwright's other browsers directly if you need them.
- **Snapshot diffs, not video.** Animation timing differences aren't detected.
- **Prompt-bounded subagent.** `writable_paths` is enforced by the subagent prompt, not by sandbox. Always review diffs.
- **Single Chromium instance.** Captures legacy and new sequentially. ~5–15s per target × state × viewport on a modern Mac.

## License

[MIT](../LICENSE) © 2026 Pedro Camara Junior
