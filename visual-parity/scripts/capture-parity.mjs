#!/usr/bin/env node
/**
 * Capture legacy vs new UI crops with optional multi-target and interactive states,
 * then diff them with pixelmatch and emit parity-report.json.
 *
 * Designed to run from the user's project root with bundled-then-copied scripts at
 *   .visual-parity/scripts/capture-parity.mjs
 *
 * Usage:
 *   node .visual-parity/scripts/capture-parity.mjs --config <path/to/parity.config.json>
 *
 * Exit codes:
 *   0 = all targets × states × viewports passed
 *   1 = at least one viewport failed thresholds
 *   2 = capture itself errored (browser, network, etc.)
 */

import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const configIdx = argv.indexOf('--config')
  if (configIdx === -1 || !argv[configIdx + 1]) {
    console.error('Usage: node capture-parity.mjs --config <parity.config.json>')
    process.exit(2)
  }
  return resolve(argv[configIdx + 1])
}

async function loadConfig(configPath) {
  const raw = await readFile(configPath, 'utf8')
  return JSON.parse(raw)
}

function scopeLabel(config) {
  return config.scope ?? config.target ?? 'parity'
}

function normalizeTargets(config) {
  if (Array.isArray(config.targets) && config.targets.length > 0) {
    return config.targets
  }

  if (!config.selector) {
    throw new Error('Config must define targets[] or selector')
  }

  return [
    {
      id: scopeLabel(config),
      selector: config.selector,
      cssRoots: config.cssRoots ?? [],
      states: [{ name: 'default', actions: [] }],
    },
  ]
}

function viewportsForState(state, allViewports) {
  if (!Array.isArray(state.viewports) || state.viewports.length === 0) {
    return allViewports
  }

  const names = new Set(state.viewports)
  return allViewports.filter((viewport) => names.has(viewport.name))
}

async function preparePage(page, preserveSelector, config) {
  const removeSelectors = config.removeSelectors ?? []
  const stripFixed = config.stripFixedAndSticky !== false
  const scrollPolicy = config.scrollPolicy ?? 'bottom'
  const scrollContainerSelector = config.scrollContainerSelector ?? null

  await page.evaluate(
    ({ preserveSelector, removeSelectors, stripFixed, scrollPolicy, scrollContainerSelector }) => {
      for (const sel of removeSelectors) {
        document.querySelectorAll(sel).forEach((node) => node.remove())
      }

      const preserveRoot = preserveSelector ? document.querySelector(preserveSelector) : null

      if (stripFixed) {
        document.querySelectorAll('body *').forEach((node) => {
          if (!(node instanceof HTMLElement)) return
          if (preserveRoot && (node === preserveRoot || node.contains(preserveRoot))) return
          const position = getComputedStyle(node).position
          if (position === 'fixed' || position === 'sticky') node.remove()
        })
      }

      if (scrollPolicy === 'bottom') {
        if (scrollContainerSelector) {
          const container = document.querySelector(scrollContainerSelector)
          if (container instanceof HTMLElement) container.scrollTop = container.scrollHeight
        }
        window.scrollTo(0, document.body.scrollHeight)
      } else if (scrollPolicy === 'top') {
        window.scrollTo(0, 0)
      }
    },
    { preserveSelector, removeSelectors, stripFixed, scrollPolicy, scrollContainerSelector },
  )
}

function resolveActionSelector(action, pageKind) {
  if (pageKind === 'legacy' && action.legacySelector) return action.legacySelector
  if (pageKind === 'new' && action.newSelector) return action.newSelector
  return action.selector
}

async function runActions(page, actions = [], pageKind = 'shared') {
  for (const action of actions) {
    const actionSelector = resolveActionSelector(action, pageKind)
    if (!actionSelector && action.type !== 'wait' && action.type !== 'press' && action.type !== 'evaluate') {
      continue
    }

    switch (action.type) {
      case 'click': {
        const locator = page.locator(actionSelector).first()
        await locator.scrollIntoViewIfNeeded()
        await locator.click({ timeout: action.timeout ?? 15_000, force: action.force ?? false })
        break
      }
      case 'hover': {
        const locator = page.locator(actionSelector).first()
        await locator.scrollIntoViewIfNeeded()
        await locator.hover({ timeout: action.timeout ?? 15_000, force: action.force ?? false })
        break
      }
      case 'fill': {
        const locator = page.locator(actionSelector).first()
        await locator.fill(action.value ?? '')
        break
      }
      case 'wait':
        await page.waitForTimeout(action.ms ?? 300)
        break
      case 'waitForSelector':
        await page.waitForSelector(actionSelector, {
          state: action.state ?? 'visible',
          timeout: action.timeout ?? 15_000,
        })
        break
      case 'press':
        await page.keyboard.press(action.key ?? 'Escape')
        break
      case 'evaluate':
        await page.evaluate(action.expression ?? action.script)
        break
      default:
        throw new Error(`Unknown action type: ${action.type}`)
    }
  }
}

function resolveSelector(entry, pageKind) {
  if (pageKind === 'legacy' && entry.legacySelector) return entry.legacySelector
  if (pageKind === 'new' && entry.newSelector) return entry.newSelector
  return entry.cropSelector ?? entry.selector
}

async function captureState(page, url, entry, viewport, config, pageKind = 'shared') {
  const waitUntil = config.waitUntil ?? 'networkidle'

  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.addInitScript((skipScroll) => {
    window.__paritySkipScrollToBottom = skipScroll
  }, config.scrollPolicy === 'top')
  await page.goto(url, { waitUntil, timeout: 120_000 })

  const cropSelector = resolveSelector(entry, pageKind)
  const hasInteractiveActions = (entry.actions ?? []).length > 0
  if (!hasInteractiveActions) {
    await page.waitForSelector(cropSelector, { state: 'visible', timeout: 60_000 })
    await preparePage(page, cropSelector, config)
  }

  for (const mask of config.maskSelectors ?? []) {
    await page.locator(mask).evaluateAll((nodes) => nodes.forEach((node) => node.remove()))
  }

  await runActions(page, entry.actions, pageKind)

  await page.waitForSelector(cropSelector, { state: 'visible', timeout: 60_000 })
  if (hasInteractiveActions) {
    await preparePage(page, cropSelector, config)
  }
  const locator = page.locator(cropSelector).first()
  await locator.scrollIntoViewIfNeeded({ block: 'center' })
  await page.waitForTimeout(config.settleMs ?? 250)
  return locator.screenshot()
}

function diffBuffers(legacyBuf, newBuf) {
  const legacy = PNG.sync.read(legacyBuf)
  const current = PNG.sync.read(newBuf)

  if (legacy.width !== current.width || legacy.height !== current.height) {
    return {
      mismatchDimensions: true,
      legacy: { width: legacy.width, height: legacy.height },
      current: { width: current.width, height: current.height },
      diffBuffer: null,
      diffPixels: null,
      totalPixels: legacy.width * legacy.height,
    }
  }

  const { width, height } = legacy
  const diff = new PNG({ width, height })
  const diffPixels = pixelmatch(legacy.data, current.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: true,
  })

  return {
    mismatchDimensions: false,
    legacy: { width, height },
    current: { width, height },
    diffBuffer: PNG.sync.write(diff),
    diffPixels,
    totalPixels: width * height,
  }
}

function evaluateViewport(result, thresholds) {
  if (result.mismatchDimensions) return { pass: false, reason: 'dimension_mismatch' }
  const ratio = result.diffPixels / result.totalPixels
  const pass = ratio <= thresholds.maxDiffPixelRatio && result.diffPixels <= thresholds.maxDiffPixels
  return { pass, diffPixelRatio: ratio, diffPixels: result.diffPixels, totalPixels: result.totalPixels }
}

async function main() {
  const configPath = parseArgs(process.argv)
  const config = await loadConfig(configPath)
  const outRoot = join(dirname(configPath))
  await mkdir(outRoot, { recursive: true })

  const scope = scopeLabel(config)
  const targets = normalizeTargets(config)
  const viewports = config.viewports ?? []
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    ignoreHTTPSErrors: config.ignoreHTTPSErrors ?? true,
  })

  const report = {
    scope,
    legacyUrl: config.legacyUrl,
    newUrl: config.newUrl,
    generatedAt: new Date().toISOString(),
    targets: {},
    pass: true,
    coverage: {
      targetCount: targets.length,
      stateCount: targets.reduce((sum, target) => sum + (target.states?.length ?? 1), 0),
    },
  }

  try {
    const legacyPage = await context.newPage()
    const newPage = await context.newPage()

    for (const target of targets) {
      const states = target.states?.length ? target.states : [{ name: 'default', actions: [] }]
      report.targets[target.id] = {
        selector: target.selector,
        cssRoots: target.cssRoots ?? [],
        states: {},
      }

      for (const state of states) {
        report.targets[target.id].states[state.name] = { viewports: {} }

        for (const viewport of viewportsForState(state, viewports)) {
          const artifactDir = join(outRoot, target.id, state.name, viewport.name)
          await mkdir(artifactDir, { recursive: true })

          const entry = {
            selector: target.selector,
            legacySelector: target.legacySelector,
            newSelector: target.newSelector,
            cropSelector: state.cropSelector ?? target.cropSelector,
            actions: state.actions ?? [],
          }

          console.log(`DEBUG:[VISUAL-PARITY/${scope}] capture ${target.id}/${state.name}/${viewport.name}`)

          const legacyBuf = await captureState(legacyPage, config.legacyUrl, entry, viewport, config, 'legacy')
          const newBuf = await captureState(newPage, config.newUrl, entry, viewport, config, 'new')

          await writeFile(join(artifactDir, 'legacy.png'), legacyBuf)
          await writeFile(join(artifactDir, 'new.png'), newBuf)

          const diffResult = diffBuffers(legacyBuf, newBuf)
          if (diffResult.diffBuffer) {
            await writeFile(join(artifactDir, 'diff.png'), diffResult.diffBuffer)
          }

          const evaluation = evaluateViewport(diffResult, config.thresholds)
          const { diffBuffer: _diffBuffer, ...diffSummary } = diffResult
          report.targets[target.id].states[state.name].viewports[viewport.name] = {
            ...diffSummary,
            ...evaluation,
            artifactDir,
          }

          if (!evaluation.pass) report.pass = false
        }
      }
    }
  } finally {
    await browser.close()
  }

  const reportPath = join(outRoot, 'parity-report.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2))

  console.log(`DEBUG:[VISUAL-PARITY/${scope}] report=${reportPath} pass=${report.pass}`)
  process.exit(report.pass ? 0 : 1)
}

main().catch((error) => {
  console.error('DEBUG:[VISUAL-PARITY] capture failed', error)
  process.exit(2)
})
