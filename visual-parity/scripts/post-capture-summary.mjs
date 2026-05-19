#!/usr/bin/env node
/**
 * Read parity-report.json and print a compact pass/fail table.
 *
 * Called by the PostToolUse hook after capture-parity.mjs runs. The hook wrapper
 * (post-capture-summary.sh) supplies --report on stdout-friendly invocations; this
 * script can also be run by hand:
 *
 *   node .visual-parity/scripts/post-capture-summary.mjs --report <path>
 *
 * Exits 0 silently if the report is missing or unreadable (best-effort).
 */

import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

function parseArgs(argv) {
  const idx = argv.indexOf('--report')
  if (idx === -1 || !argv[idx + 1]) return null
  return resolve(argv[idx + 1])
}

function pad(s, n) {
  s = String(s)
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function fmtRatio(r) {
  if (r === null || r === undefined || Number.isNaN(r)) return '—'
  return (r * 100).toFixed(2) + '%'
}

async function main() {
  const reportPath = parseArgs(process.argv)
  if (!reportPath) return
  try {
    await stat(reportPath)
  } catch {
    return
  }

  let report
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'))
  } catch {
    return
  }

  const rows = []
  for (const [targetId, target] of Object.entries(report.targets ?? {})) {
    for (const [stateName, state] of Object.entries(target.states ?? {})) {
      for (const [vpName, vp] of Object.entries(state.viewports ?? {})) {
        rows.push({
          status: vp.pass ? 'PASS' : 'FAIL',
          target: targetId,
          state: stateName,
          viewport: vpName,
          ratio: vp.diffPixelRatio,
          pixels: vp.diffPixels,
          reason: vp.reason ?? '',
        })
      }
    }
  }

  if (rows.length === 0) return

  const widths = {
    status: 4,
    target: Math.max(6, ...rows.map((r) => r.target.length)),
    state: Math.max(5, ...rows.map((r) => r.state.length)),
    viewport: Math.max(8, ...rows.map((r) => r.viewport.length)),
    ratio: 7,
    pixels: 7,
  }

  const sep = '─'.repeat(widths.status + widths.target + widths.state + widths.viewport + widths.ratio + widths.pixels + 17)
  console.log('')
  console.log(`╭─ visual-parity (${report.scope ?? '—'}) ${report.pass ? '✓ PASS' : '✗ FAIL'}`)
  console.log(`│  ${reportPath}`)
  console.log(`│`)
  console.log(
    `│  ${pad('', widths.status)}  ${pad('target', widths.target)}  ${pad('state', widths.state)}  ${pad('viewport', widths.viewport)}  ${pad('ratio', widths.ratio)}  ${pad('pixels', widths.pixels)}`,
  )
  console.log(`│  ${sep}`)
  for (const r of rows) {
    const tag = r.status === 'PASS' ? '✓   ' : '✗   '
    console.log(
      `│  ${tag}${pad(r.target, widths.target)}  ${pad(r.state, widths.state)}  ${pad(r.viewport, widths.viewport)}  ${pad(fmtRatio(r.ratio), widths.ratio)}  ${pad(r.pixels ?? '—', widths.pixels)}${r.reason ? '  ' + r.reason : ''}`,
    )
  }
  console.log(`╰─`)
  console.log('')
}

main().catch(() => {
  /* silent — hooks must not break the user's tool call */
})
