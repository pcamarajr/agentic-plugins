#!/usr/bin/env node
/**
 * Deterministic removal of `debug` plugin instrumentation.
 *
 * Removes from source files:
 *   - any line containing the literal marker `[claude-debug]`
 *   - any block between lines containing `[claude-debug:start]` and
 *     `[claude-debug:end]` (inclusive)
 *
 * Usage:
 *   node cleanup-instrumentation.mjs [file ...]
 *
 * With no file arguments, finds candidates via `git grep` (tracked +
 * untracked), falling back to a recursive text scan of the cwd.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const MARKER = '[claude-debug]'
const BLOCK_START = '[claude-debug:start]'
const BLOCK_END = '[claude-debug:end]'
// Prefix matches both the single-line marker and the block markers
const SEARCH_PREFIX = '[claude-debug'

function findFilesViaGit() {
  try {
    const stdout = execFileSync('git', ['grep', '-l', '--untracked', '-F', SEARCH_PREFIX], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return stdout.split('\n').filter(Boolean)
  } catch (err) {
    // git grep exits 1 on "no matches" — that's a clean empty result
    if (err.status === 1 && !String(err.stdout || '').trim()) return []
    return null
  }
}

function findFilesViaScan(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.debug-mode') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      findFilesViaScan(full, acc)
    } else if (entry.isFile()) {
      try {
        const content = fs.readFileSync(full, 'utf8')
        if (content.includes(SEARCH_PREFIX)) acc.push(full)
      } catch {
        /* binary or unreadable — skip */
      }
    }
  }
  return acc
}

let files = process.argv.slice(2)
if (!files.length) {
  files = findFilesViaGit() ?? findFilesViaScan(process.cwd())
}

const report = []
for (const file of files) {
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    report.push({ file, removed: 0, error: 'unreadable' })
    continue
  }

  const lines = content.split('\n')
  const kept = []
  let removed = 0
  let inBlock = false
  for (const line of lines) {
    if (inBlock) {
      removed++
      if (line.includes(BLOCK_END)) inBlock = false
      continue
    }
    if (line.includes(BLOCK_START)) {
      inBlock = true
      removed++
      continue
    }
    if (line.includes(MARKER)) {
      removed++
      continue
    }
    kept.push(line)
  }

  if (removed > 0) {
    fs.writeFileSync(file, kept.join('\n'))
  }
  report.push({ file, removed, unterminatedBlock: inBlock || undefined })
}

const total = report.reduce((sum, r) => sum + (r.removed || 0), 0)
console.log(JSON.stringify({ filesTouched: report.filter((r) => r.removed > 0).length, linesRemoved: total, report }, null, 2))
process.exit(0)
