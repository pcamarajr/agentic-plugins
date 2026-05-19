# /visual-parity:run — reference

## Parity config (`.visual-parity/artifacts/<scope>/parity.config.json`)

The run skill writes this file from intake answers + `.visual-parity/config.md` defaults. It is the only input to `capture-parity.mjs`. You can hand-edit it between iterations if you need to.

### Top-level fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `scope` | string | yes | — | Short label, used in artifact paths and logs |
| `legacyUrl` | string | yes | — | URL of the reference rendering |
| `newUrl` | string | yes | — | URL of the new rendering |
| `ignoreHTTPSErrors` | boolean | no | `true` | Pass through to Playwright `newContext` |
| `viewports` | array | yes | from config.md | Each `{name, width, height}` |
| `thresholds` | object | yes | from config.md | `{maxDiffPixelRatio, maxDiffPixels}` |
| `targets` | array | one of | — | Per-region capture entries (see below) |
| `selector` | string | one of | — | Single-target shortcut; equivalent to a one-entry `targets` |
| `maskSelectors` | array | no | `[]` | Removed before capture (volatile widgets) |
| `removeSelectors` | array | no | `[]` | Removed during DOM cleanup (consent banners, chatbots) |
| `stripFixedAndSticky` | boolean | no | `true` | Strips `position: fixed`/`sticky` to avoid pollution |
| `scrollPolicy` | `"bottom"`\|`"top"` | no | `"bottom"` | Where to scroll before capture |
| `scrollContainerSelector` | string\|null | no | `null` | Inner element to scroll instead of `window` |
| `waitUntil` | string | no | `"networkidle"` | Playwright `page.goto` wait state |
| `settleMs` | number | no | `250` | Pause after scrolling and before capture |

### Target entry

```json
{
  "id": "header-nav",
  "selector": "[data-testid=\"header-nav\"]",
  "legacySelector": "[data-element-id=\"OldHeader_Nav\"]",
  "newSelector": null,
  "cropSelector": null,
  "cssRoots": ["src/components/Header/Nav/"],
  "states": [
    { "name": "default", "actions": [] },
    {
      "name": "menu-open",
      "viewports": ["mobile"],
      "actions": [
        { "type": "click", "selector": "[data-testid=\"header-nav-toggle\"]" },
        { "type": "wait", "ms": 350 }
      ],
      "cropSelector": "[data-testid=\"header-nav-drawer\"]"
    }
  ]
}
```

- `selector` is the default crop region for every state.
- `legacySelector` / `newSelector` override per-side when DOM hooks differ between trees.
- `cropSelector` (per state) crops something narrower than the target root — useful for dialogs that open from a button (`[role="dialog"]`).
- `states[].viewports` filters which viewports to capture for that state — omit to capture all.
- `cssRoots` are hints for the parity-fix subagent. Empty is fine; the subagent will search.

### Action types

| `type` | Fields | Behavior |
|---|---|---|
| `click` | `selector`, `timeout?`, `force?` | Scroll into view, then click |
| `hover` | `selector`, `timeout?`, `force?` | Scroll into view, then hover |
| `fill` | `selector`, `value` | Set the value of an input |
| `wait` | `ms` | Sleep |
| `waitForSelector` | `selector`, `state?`, `timeout?` | Wait until element exists/visible |
| `press` | `key` | Keyboard press (e.g. `Escape`) |
| `evaluate` | `expression` or `script` | Run arbitrary JS in the page context |

Each action can specify `legacySelector` / `newSelector` to use a different selector per side.

Actions run on **both** legacy and new pages before the crop, so states stay in sync.

## Parity report

`capture-parity.mjs` writes `.visual-parity/artifacts/<scope>/parity-report.json`:

```json
{
  "scope": "header",
  "legacyUrl": "...",
  "newUrl": "...",
  "generatedAt": "2026-05-19T12:00:00.000Z",
  "pass": false,
  "coverage": { "targetCount": 2, "stateCount": 3 },
  "targets": {
    "header-nav": {
      "selector": "[data-testid=\"header-nav\"]",
      "cssRoots": ["src/components/Header/Nav/"],
      "states": {
        "default": {
          "viewports": {
            "mobile":  { "pass": true,  "diffPixels": 12, "diffPixelRatio": 0.0001, "totalPixels": 120000, "artifactDir": "..." },
            "desktop": { "pass": false, "diffPixels": 980, "diffPixelRatio": 0.012,  "totalPixels": 80000,  "artifactDir": "..." }
          }
        }
      }
    }
  }
}
```

When `mismatchDimensions: true`, the crop captured at a different size on legacy vs new (usually because content height differs). This always counts as fail; the fix is usually to scope a tighter `selector` or add a `wait` action so content settles.

## Default viewports

| Name | Width | Height |
|---|---|---|
| mobile | 375 | 900 |
| tablet | 768 | 900 |
| desktop | 1024 | 900 |
| wide *(opt-in)* | 1440 | 900 |

The height is intentionally large so cropped regions are not truncated.

## Iteration loop notes

- **Max iterations: 5** by default. Override with `max_iterations` in `.visual-parity/config.md`.
- The subagent is `general-purpose` (full tools). It runs in a forked context per Task call — each iteration is a fresh subagent.
- The orchestrator (the run skill itself) re-reads `parity-report.json` between iterations to decide whether to loop.
- If `writable_paths` is empty, the loop is skipped entirely (view-only mode).
- The subagent receives the failing report + the diff PNGs by path. Reading PNGs lets it visually identify which CSS dimension differs.

## Failure-mode cheatsheet

| Symptom | Likely cause | First thing to try |
|---|---|---|
| Large diff everywhere | Locale / store / auth mismatch between URLs | Compare network payloads; align query strings |
| Dimension mismatch on capture | Element heights differ (lazy images, ads) | Add `wait` + tighter `selector`; or `maskSelectors` for volatile children |
| Diff only on text | Font, line-height, letter-spacing | Inspect computed styles on matching nodes |
| Diff on images | Different CDN URLs, sizes, formats | Mask the image, or normalize image rules in CSS |
| Flaky pass/fail | Animation, lazy-load shift | Add `wait` actions; `state: "stable"` waits |
| Cannot reach HTTPS host | Self-signed cert | `ignoreHTTPSErrors: true` is on by default |
| Sticky header in crops of below-fold content | Overlay pollution | `stripFixedAndSticky: true` (default) handles this; otherwise add to `removeSelectors` |

## When NOT to use this plugin

- Pure functional QA (does the button work?) — use Playwright tests directly.
- Storybook-driven visual regression — use Chromatic or Loki.
- Cross-browser tests — this is Chromium-only by design.
- Animation timing tests — pixelmatch is a snapshot tool, not a video diff.

## Subagent prompt rationale

The subagent prompt deliberately:

- **Tells the subagent to read CLAUDE.md/AGENTS.md first.** The plugin doesn't know your project's CSS conventions; the project does.
- **Bounds writes by `writable_paths`.** This is prompt-enforced, not sandboxed. Trust your subagent's compliance; review its diff.
- **Forbids DOM/state changes for visibility chrome.** Visual parity often tempts a fix via `useState` toggles for hidden elements — usually CSS or native HTML elements (`<details>`, `:has()`, `:focus-within`) can express the same.
- **Forbids dependency additions.** Iteration should not silently grow the user's `package.json`.

You can override this prompt by replacing the template inline in `skills/run/SKILL.md` after ejecting the plugin (copying it into your own marketplace).
