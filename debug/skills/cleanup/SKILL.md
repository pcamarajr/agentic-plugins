---
description: Remove all debug-plugin instrumentation from the codebase and stop the log collector. Use after a crashed/abandoned /debug:run session, or whenever lines marked [claude-debug] are left in the working tree.
disable-model-invocation: true
allowed-tools: Read Glob Grep Bash
---

# /debug:cleanup

Standalone recovery: removes every trace of `/debug:run` instrumentation, regardless of session state.

## Steps

1. Show what will be removed (so the user sees the blast radius before any edit):

   ```bash
   git grep -n --untracked -F "[claude-debug" || echo "no instrumentation found"
   ```

   (The pattern is an open prefix on purpose — it catches both `[claude-debug]` lines and `[claude-debug:start]`/`:end]` block markers.)

2. If matches exist, remove them deterministically:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-instrumentation.mjs"
   ```

   The script deletes every line containing `[claude-debug]` and every block between `[claude-debug:start]` / `[claude-debug:end]` (inclusive). It reports files touched and lines removed as JSON; check the report for any `unterminatedBlock: true` entry and inspect that file manually if present.

3. Verify zero leftovers: re-run the `git grep` from step 1 — it must return nothing.

4. Stop the collector if running:

   ```bash
   [ -f .debug-mode/collector.pid ] && kill "$(cat .debug-mode/collector.pid)" 2>/dev/null; rm -f .debug-mode/collector.pid
   ```

5. If `.debug-mode/session.md` exists, set its status to `stopped` (leave the file and `logs.ndjson` in place — they may still hold useful evidence; the directory is gitignored).

6. Report: files cleaned, lines removed, collector stopped or not running.
