# Changelog

All notable changes to this marketplace and its plugins are documented here.
The marketplace and each plugin follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) independently.

## visual-parity

### 1.0.0 — 2026-05-19

Initial release.

- `/visual-parity:init` — interactive setup wizard: writes `.visual-parity/config.md`, copies bundled scripts into `.visual-parity/scripts/`, installs Playwright + pixelmatch + pngjs into the user's project, appends `.visual-parity/artifacts/` to `.gitignore`.
- `/visual-parity:run` — interactive intake → builds parity config → captures cropped screenshots on legacy and new URLs → diffs with pixelmatch → spawns a subagent that iterates CSS in `writable_paths` until every target × state × viewport passes thresholds. Falls back to view-only when no `writable_paths` are configured.
- Bundled hooks: `PreToolUse` ensures Chromium is installed before `capture-parity.mjs` runs; `PostToolUse` prints a compact pass/fail summary from `parity-report.json`.
- Configurable target attribute (default `data-testid`; common alternatives `data-element-id`, `data-qa`, `data-test`; or any CSS selector).
- Configurable viewports, thresholds, mask selectors, scroll behavior, and DOM cleanup selectors.
- Bundled example configs under `examples/` for the two supported flows.
