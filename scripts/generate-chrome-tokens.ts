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

/** Raw `--name: value` declarations of a block, in source order (values unresolved). */
export function parseRawBlock(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of body.split(';')) {
    const decl = raw.trim()
    if (!decl) continue
    const m = decl.match(/^--([a-z0-9-]+)\s*:\s*(.+)$/)
    if (!m) throw new Error(`chrome.css: unsupported declaration "${decl}"`)
    out[m[1]!] = m[2]!.trim()
  }
  return out
}

/**
 * Resolves a raw block to px numbers. `var(--x)` is looked up in the same
 * (merged) map, like the browser does at computed-value time on <html>:
 * an override of `--control-sm` also changes `--chrome-control: var(--control-sm)`.
 */
export function resolveChromeBlock(raw: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {}
  const resolving = new Set<string>()
  const resolveName = (name: string): number => {
    if (name in out) return out[name]!
    const value = raw[name]
    if (value === undefined) throw new Error(`chrome.css: unknown --${name}`)
    if (resolving.has(name)) throw new Error(`chrome.css: var() cycle at --${name}`)
    resolving.add(name)
    let result: number
    const px = value.match(/^(-?\d+(?:\.\d+)?)px$/)
    const ref = value.match(/^var\(--([a-z0-9-]+)\)$/)
    if (px) {
      result = Number(px[1])
    } else if (ref) {
      if (!(ref[1]! in raw)) throw new Error(`chrome.css: --${name} references unknown --${ref[1]}`)
      result = resolveName(ref[1]!)
    } else {
      throw new Error(`chrome.css: --${name} must be a px value or var() reference, got "${value}"`)
    }
    resolving.delete(name)
    out[name] = result
    return result
  }
  const ordered: Record<string, number> = {}
  for (const name of Object.keys(raw)) ordered[name] = resolveName(name)
  return ordered
}

/** Parses `--name: <n>px | var(--other)` declarations into px numbers. */
export function parseChromeBlock(body: string): Record<string, number> {
  return resolveChromeBlock(parseRawBlock(body))
}

export function readChromeTokens(css = readFileSync(CHROME_TOKENS_CSS, 'utf8')): {
  compact: Record<string, number>
  comfortable: Record<string, number>
} {
  const clean = stripComments(css)
  const compactRaw = parseRawBlock(topLevelBlock(clean, ':root'))
  const overridesRaw = parseRawBlock(topLevelBlock(clean, COMFORTABLE_SELECTOR))
  for (const key of Object.keys(overridesRaw)) {
    if (!(key in compactRaw)) throw new Error(`chrome.css: comfortable override --${key} has no compact default`)
  }
  // Merge the raw declarations first, then resolve: var() references in the
  // compact block pick up comfortable overrides (same as the cascade).
  return {
    compact: resolveChromeBlock(compactRaw),
    comfortable: resolveChromeBlock({ ...compactRaw, ...overridesRaw }),
  }
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
