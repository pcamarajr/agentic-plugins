#!/usr/bin/env bash
# PreToolUse hook for the visual-parity plugin.
#
# Fires on every Bash tool call but no-ops unless the command runs the bundled
# capture-parity.mjs script. When it matches, it installs Chromium via Playwright
# if the browser is missing. Must NEVER block the user's tool call — all errors
# are swallowed.

set -u

input=$(cat 2>/dev/null || true)
[ -z "$input" ] && exit 0

# Match either the project-local copy (.visual-parity/scripts/) or the plugin-root
# copy (when running the bundled script directly during development).
command_text=$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
case "$command_text" in
  *.visual-parity/scripts/capture-parity.mjs*) ;;
  *) exit 0 ;;
esac

# Skip if explicitly disabled.
if [ "${VISUAL_PARITY_SKIP_CHROMIUM_INSTALL:-0}" = "1" ]; then
  exit 0
fi

# Detect whether Chromium is already installed. Playwright stores browsers in
# ~/Library/Caches/ms-playwright (macOS) or ~/.cache/ms-playwright (Linux).
playwright_cache_dirs=("$HOME/Library/Caches/ms-playwright" "$HOME/.cache/ms-playwright")
for dir in "${playwright_cache_dirs[@]}"; do
  if [ -d "$dir" ] && ls "$dir"/chromium-* >/dev/null 2>&1; then
    exit 0
  fi
done

# Try to install. Prefer the user project's playwright via npx; fall back silently.
if command -v npx >/dev/null 2>&1; then
  echo "[visual-parity] Chromium not found — installing via 'npx playwright install chromium'" >&2
  npx --no playwright install chromium >&2 2>&1 || true
fi

exit 0
