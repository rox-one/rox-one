#!/usr/bin/env bun
/**
 * Generates apps/electron/src/renderer/platform/chrome-tokens.ts from
 * packages/ui/src/styles/tokens/chrome.css (UI-A1, rox-one#1567).
 *
 * chrome.css is the single source of truth for shell geometry. TypeScript
 * layout code (chrome-density.ts, panel-constants.ts) reads the generated
 * numbers instead of keeping its own copies.
 *
 *   bun run scripts/generate-chrome-tokens.ts           # write
 *   bun run scripts/generate-chrome-tokens.ts --check   # exit 1 if stale
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..')
export const CHROME_TOKENS_CSS = join(REPO_ROOT, 'packages/ui/src/styles/tokens/chrome.css')
export const CHROME_TOKENS_TS = join(REPO_ROOT, 'apps/electron/src/renderer/platform/chrome-tokens.ts')

const COMFORTABLE_SELECTOR = 'html[data-density="comfortable"]'

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Body of the first top-level block whose selector is exactly `selector`. */
function topLevelBlock(css: string, selector: string): string {
  let depth = 0
  let selectorStart = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      if (depth === 0 && css.slice(selectorStart, i).trim() === selector) {
        const end = css.indexOf('}', i)
        if (end < 0) break
        return css.slice(i + 1, end)
      }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) selectorStart = i + 1
    } else if (ch === ';' && depth === 0) {
      selectorStart = i + 1
    }
  }
  throw new Error(`chrome.css: missing top-level block ${selector}`)
}

function camel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** Parses `--name: <n>px | var(--other)` declarations into px numbers. */
export function parseChromeBlock(body: string, scope: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {}
  for (const raw of body.split(';')) {
    const decl = raw.trim()
    if (!decl) continue
    const m = decl.match(/^--([a-z0-9-]+)\s*:\s*(.+)$/)
    if (!m) throw new Error(`chrome.css: unsupported declaration "${decl}"`)
    const [, name, value] = m as unknown as [string, string, string]
    const px = value.match(/^(-?\d+(?:\.\d+)?)px$/)
    if (px) {
      out[name] = Number(px[1])
      continue
    }
    const ref = value.match(/^var\(--([a-z0-9-]+)\)$/)
    if (ref) {
      const resolved = out[ref[1]!] ?? scope[ref[1]!]
      if (resolved === undefined) throw new Error(`chrome.css: --${name} references unknown --${ref[1]}`)
      out[name] = resolved
      continue
    }
    throw new Error(`chrome.css: --${name} must be a px value or var() reference, got "${value}"`)
  }
  return out
}

export function readChromeTokens(css = readFileSync(CHROME_TOKENS_CSS, 'utf8')): {
  compact: Record<string, number>
  comfortable: Record<string, number>
} {
  const clean = stripComments(css)
  const compact = parseChromeBlock(topLevelBlock(clean, ':root'))
  const overrides = parseChromeBlock(topLevelBlock(clean, COMFORTABLE_SELECTOR), compact)
  for (const key of Object.keys(overrides)) {
    if (!(key in compact)) throw new Error(`chrome.css: comfortable override --${key} has no compact default`)
  }
  return { compact, comfortable: { ...compact, ...overrides } }
}

function renderObject(tokens: Record<string, number>): string {
  return Object.entries(tokens)
    .map(([name, value]) => `  /** --${name} */\n  ${camel(name)}: ${value},`)
    .join('\n')
}

export function renderChromeTokens(css?: string): string {
  const { compact, comfortable } = readChromeTokens(css)
  return `/**
 * GENERATED FILE — do not edit by hand.
 * Source: packages/ui/src/styles/tokens/chrome.css
 * Regenerate: bun run scripts/generate-chrome-tokens.ts
 *
 * Shell geometry in px. CSS reads the same numbers as custom properties.
 */

export type ChromeTokenName =
${Object.keys(compact).map((name) => `  | '${camel(name)}'`).join('\n')}

/** Compact density (the default). */
export const CHROME_TOKENS: Readonly<Record<ChromeTokenName, number>> = Object.freeze({
${renderObject(compact)}
})

/** \`html[data-density="comfortable"]\` values (compact merged with overrides). */
export const CHROME_TOKENS_COMFORTABLE: Readonly<Record<ChromeTokenName, number>> = Object.freeze({
${renderObject(comfortable)}
})
`
}

if (import.meta.main) {
  const next = renderChromeTokens()
  if (process.argv.includes('--check')) {
    const current = readFileSync(CHROME_TOKENS_TS, 'utf8')
    if (current !== next) {
      console.error('chrome-tokens.ts is stale; run: bun run scripts/generate-chrome-tokens.ts')
      process.exit(1)
    }
    console.log('chrome-tokens.ts is up to date')
  } else {
    writeFileSync(CHROME_TOKENS_TS, next)
    console.log(`wrote ${CHROME_TOKENS_TS}`)
  }
}
