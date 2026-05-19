# /visual-parity:init — reference

## `.visual-parity/config.md` schema

The run skill parses this file as a flat key/value document. Keys are read case-insensitively but written lower_snake_case for clarity.

| Key | Type | Default | Notes |
|---|---|---|---|
| `data_attribute` | string | `data-testid` | Used to build selectors like `[<attr>="<id>"]`. Set to `null` if you only use raw CSS selectors. |
| `viewports` | list of `{name, width, height}` | mobile/tablet/desktop | Each capture runs at each viewport unless a state restricts its own list. |
| `thresholds.maxDiffPixelRatio` | number | `0.01` | Pass if `(diffPixels / totalPixels) <= ratio`. |
| `thresholds.maxDiffPixels` | number | `500` | Pass if `diffPixels <= count`. Both must hold. |
| `writable_paths` | list of globs | `[]` | Where the parity subagent may edit code. Empty → view-only mode (no iteration). |
| `read_only_paths` | list of globs | `[]` | Paths the subagent must never touch. Enforced by prompt, not sandbox. |
| `mask_selectors` | list of CSS selectors | `[]` | Removed before each capture. Use for volatile third-party widgets. |
| `remove_selectors` | list of CSS selectors | `[]` | Removed during DOM cleanup. Use for consent banners, chatbots, etc. |
| `strip_fixed_and_sticky` | boolean | `true` | Remove `position: fixed`/`sticky` elements before capture so they don't pollute scrolled crops. The crop target itself is preserved. |
| `scroll_policy` | `"bottom"` \| `"top"` | `"bottom"` | Where to scroll before capture. `"bottom"` is correct for most footer/below-fold work. |
| `scroll_container_selector` | string \| null | `null` | Inner element to scroll instead of `window`. Rare; needed only when an SPA doesn't scroll `<body>`. |

## Package-manager detection

Order of precedence (first match wins):

1. `pnpm-lock.yaml` → pnpm
2. `yarn.lock` → yarn
3. `bun.lockb` → bun
4. `package-lock.json` → npm
5. Otherwise → npm

If a project has multiple lockfiles (a known footgun), warn the user that mixed lockfiles are an inconsistency and proceed with the first match.

## Chromium download

`npx playwright install chromium` downloads ~150MB into:

- macOS: `~/Library/Caches/ms-playwright/`
- Linux: `~/.cache/ms-playwright/`
- Windows: `%USERPROFILE%\AppData\Local\ms-playwright\`

The hook script `ensure-chromium.sh` (shipped in this plugin) also installs Chromium on demand if the user skipped init or moved machines.

## Re-running init safely

The skill body enforces these rules but here's the rationale:

- Config is the user's source of truth — never silently overwrite.
- Scripts may have been edited locally — never silently overwrite.
- Lockfile changes show up in version control — installs are safe to re-run.
- Chromium install is a no-op if already present.

If a user wants a clean reset: instruct them to `rm -rf .visual-parity/` and re-run init.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `EACCES` on `.visual-parity/scripts/*.mjs` | Cluster restored without exec bit | `chmod +x .visual-parity/scripts/*.mjs` |
| `Cannot find module '@playwright/test'` | Install failed silently | Re-run the package-manager install command manually |
| `Executable doesn't exist at .../chromium-XXXX/...` | Chromium download interrupted | `npx playwright install chromium` |
| Lockfile detection picked the wrong manager | Mixed lockfiles | Delete the stale lockfile, re-run init |
