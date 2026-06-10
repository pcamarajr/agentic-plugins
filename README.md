# agentic-plugins

Claude Code plugin marketplace by [Pedro Camara Junior](https://github.com/pcamarajr) — agentic developer workflows packaged as installable plugins.

## Install

```bash
# Add this marketplace to Claude Code
claude /plugin marketplace add pcamarajr/agentic-plugins
```

Then install whichever plugins you want:

```bash
claude /plugin install visual-parity@agentic-plugins
```

## Plugins

| Plugin | What it does |
|---|---|
| [`visual-parity`](./visual-parity) | Visual parity loop for UI migrations. Compares a legacy reference URL with a new URL, captures cropped screenshots, diffs them with pixelmatch, then iterates CSS in your project until the renders match human-eye. |
| [`debug`](./debug) | Hypothesis-driven runtime debugging, Cursor Debug Mode style. Generates competing root-cause hypotheses, instruments your code with self-cleaning log statements that stream to a local collector, captures evidence while you (or the agent) reproduce the bug, applies an evidence-backed fix, and asks you for the verdict. |

## Versioning

Each plugin is independently versioned with [SemVer](https://semver.org/). Updates ship only when the plugin's `plugin.json` version field is bumped — see the [CHANGELOG](./CHANGELOG.md) for a per-plugin release history.

## Requirements

- Claude Code v2.1.0+ (for the `/plugin` command and plugin hooks)
- Per-plugin requirements are listed in each plugin's own README

## License

[MIT](./LICENSE) © 2026 Pedro Camara Junior
