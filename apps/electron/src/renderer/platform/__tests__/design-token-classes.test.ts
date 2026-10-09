/**
 * Guard: renderer / packages-ui source may only use *live* design-token
 * classes.
 *
 * packages/ui/src/styles/index.css defines `--color-status-warning` but not
 * `--color-warning`, so `text-warning` / `bg-warning/*` / `border-warning/*`
 * (and siblings such as `ring-warning`) emit no declarations at all — borders
 * silently fall back to currentColor. PR #1732's sweep missed ~27 renderer
 * files; this test makes the sweep regression-proof by reading the token
 * palette straight from index.css and failing with the offending file list.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const rendererDir = join(import.meta.dir, '..', '..')
const uiSrcDir = join(rendererDir, '..', '..', '..', '..', 'packages', 'ui', 'src')
const indexPath = join(uiSrcDir, 'styles', 'index.css')
const repoRoot = join(rendererDir, '..', '..', '..', '..')

/** Tailwind colour utilities that take a `-<token>` colour name. */
const UTILITY_PREFIXES = [
  'text',
  'bg',
  'border',
  'ring',
  'fill',
  'stroke',
  'divide',
  'outline',
  'from',
  'to',
  'via',
  'shadow',
  'decoration',
  'placeholder',
  'caret',
  'accent',
  'indicator',
] as const

/** Every `--color-<token>` declared in the design-token stylesheet. */
const definedColors = new Set(
  [...readFileSync(indexPath, 'utf8').matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
)

// Match `text-warning`, `hover:bg-warning/10`, `border-warning`, … while
// capturing the full colour token (`warning` vs `status-warning`).
const boundary = String.raw`(?:^|[\s"'\`{}:=>\[\]()])`
const warningClass = new RegExp(
  `${boundary}(${UTILITY_PREFIXES.join('|')})-([a-z0-9-]*warning)(?:\\/\\d+)?(?![\\w-])`,
  'g',
)

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) acc.push(full)
  }
  return acc
}

const deadClasses = [...walk(rendererDir), ...walk(uiSrcDir)].flatMap((file) => {
  const hits: string[] = []
  for (const match of readFileSync(file, 'utf8').matchAll(warningClass)) {
    const token = match[2]!
    if (!definedColors.has(token)) hits.push(`${relative(repoRoot, file)} → ${match[1]}-${token}`)
  }
  return hits
})

describe('design-token class names', () => {
  it('the premise holds: --color-status-warning is live, --color-warning is not', () => {
    expect(definedColors.has('status-warning')).toBe(true)
    expect(definedColors.has('warning')).toBe(false)
  })

  it('no renderer / ui source uses a dead *-warning token class', () => {
    if (deadClasses.length > 0) {
      throw new Error(
        `Dead *-warning token classes (no --color-* declaration):\n${deadClasses.join('\n')}`,
      )
    }
    expect(deadClasses).toEqual([])
  })
})