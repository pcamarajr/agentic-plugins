#!/usr/bin/env node
/**
 * Discover tagged elements under a directory to seed a parity manifest.
 *
 * Scans React/Vue/Svelte source files for a configurable data-attribute and prints
 * a JSON `targets[]` skeleton ready to paste into your parity.config.json.
 *
 * Usage:
 *   node .visual-parity/scripts/list-parity-targets.mjs <dir> [--attr data-testid] [--ext tsx,jsx,vue,svelte]
 *
 * Defaults: --attr data-testid, --ext tsx,jsx,vue,svelte
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

const ROOT = process.cwd()

function parseArgs(argv) {
  const args = { dir: null, attr: 'data-testid', exts: ['tsx', 'jsx', 'vue', 'svelte'] }
  const positional = []
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--attr') {
      args.attr = argv[++i]
    } else if (arg === '--ext') {
      args.exts = argv[++i]
        .split(',')
        .map((s) => s.trim().replace(/^\./, ''))
        .filter(Boolean)
    } else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`)
      process.exit(2)
    } else {
      positional.push(arg)
    }
  }
  args.dir = positional[0]
  if (!args.dir) {
    console.error('Usage: node list-parity-targets.mjs <dir> [--attr data-testid] [--ext tsx,jsx,vue,svelte]')
    process.exit(2)
  }
  return args
}

function buildIdRegex(attr) {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}=(?:"([^"]+)"|'([^']+)'|{\`([^\`]+)\`}|{"([^"]+)"})`, 'g')
}

async function walk(dir, predicate, files = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(path, predicate, files)
    } else if (predicate(entry.name)) {
      files.push(path)
    }
  }
  return files
}

async function main() {
  const { dir, attr, exts } = parseArgs(process.argv)
  const absRoot = join(ROOT, dir)
  const extRegex = new RegExp(`\\.(${exts.join('|')})$`)
  const files = await walk(absRoot, (name) => extRegex.test(name))
  const idRegex = buildIdRegex(attr)
  const rows = []

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(idRegex)) {
      const id = match[1] ?? match[2] ?? match[3] ?? match[4]
      if (!id) continue
      rows.push({
        id,
        selector: `[${attr}="${id}"]`,
        file: relative(ROOT, file),
      })
    }
  }

  const unique = new Map()
  for (const row of rows) {
    if (!unique.has(row.id)) unique.set(row.id, row)
  }

  const targets = [...unique.values()].map((row) => ({
    id: row.id.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    selector: row.selector,
    cssRoots: [`${dirname(row.file)}/`],
    states: [{ name: 'default', actions: [] }],
  }))

  process.stdout.write(`${JSON.stringify({ scanRoot: dir, attribute: attr, targets }, null, 2)}\n`)
}

main().catch((error) => {
  console.error('DEBUG:[VISUAL-PARITY] list-targets failed', error)
  process.exit(1)
})
