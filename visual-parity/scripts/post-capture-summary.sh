#!/usr/bin/env bash
# PostToolUse hook for the visual-parity plugin.
#
# Fires on every Bash tool call but no-ops unless the command ran capture-parity.mjs.
# When it matches, finds the parity-report.json produced by the capture and prints
# a compact pass/fail summary via post-capture-summary.mjs. Must NEVER fail the
# user's tool call — all errors are swallowed.

set -u

input=$(cat 2>/dev/null || true)
[ -z "$input" ] && exit 0

command_text=$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
case "$command_text" in
  *.visual-parity/scripts/capture-parity.mjs*) ;;
  *) exit 0 ;;
esac

# Extract --config <path> from the command. Take the first match.
config_path=$(printf '%s' "$command_text" | sed -n 's/.*--config[[:space:]]\{1,\}\([^[:space:]"]*\).*/\1/p' | head -n1)
[ -z "$config_path" ] && exit 0

# parity-report.json lives alongside the config.
config_dir=$(dirname "$config_path")
report_path="$config_dir/parity-report.json"
[ -f "$report_path" ] || exit 0

script_dir=$(cd "$(dirname "$0")" && pwd)
if command -v node >/dev/null 2>&1; then
  node "$script_dir/post-capture-summary.mjs" --report "$report_path" 2>/dev/null || true
fi

exit 0
