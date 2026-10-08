import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UI-A1 (rox-one#1567): token foundation v2. Static checks over the token
 * sources; the DOM/pixel matrix lives in the UI-A4 harness.
 */
const stylesDir = join(import.meta.dir, '..')
const tokensDir = join(stylesDir, 'tokens')
const repoRoot = join(stylesDir, '../../../..')
const indexCss = readFileSync(join(stylesDir, 'index.css'), 'utf8')
const rendererCss = readFileSync(join(repoRoot, 'apps/electron/src/renderer/index.css'), 'utf8')
const tokenFiles = readdirSync(tokensDir).filter((f) => f.endsWith('.css'))
const token = (name: string) => readFileSync(join(tokensDir, name), 'utf8')
const allTokens = tokenFiles.map(token).join('\n')

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Declarations of every top-level (or @media-nested) block matching `selector`. */
function blocks(css: string, selector: string): Record<string, string>[] {
  const clean = stripComments(css)
  const out: Record<string, string>[] = []
  const re = /([^{};]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean))) {
    if (m[1]!.trim() !== selector) continue
    const decls: Record<string, string> = {}
    for (const part of m[2]!.split(';')) {
      const d = part.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/)
      if (d) decls[d[1]!] = d[2]!
    }
    out.push(decls)
  }
  return out
}

const merge = (bs: Record<string, string>[]): Record<string, string> => Object.assign({}, ...bs)
const rootOf = (css: string) => merge(blocks(css, ':root'))

/** Resolves `var(--x)` chains against `scope` to a final literal. */
function resolve(value: string, scope: Record<string, string>, depth = 0): string {
  if (depth > 20) throw new Error(`cycle resolving ${value}`)
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name: string, fallback?: string) => {
    const next = scope[name] ?? fallback
    if (next === undefined) throw new Error(`unresolved ${name}`)
    return resolve(next, scope, depth + 1)
  })
}

const px = (v: string) => {
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)px$/)
  if (!m) throw new Error(`not a px value: ${v}`)
  return Number(m[1])
}

const LAYERS = [
  'base', 'raised', 'sticky', 'chrome', 'sash', 'popover', 'tooltip',
  'scrim', 'modal', 'toast', 'island', 'island-popover', 'splash',
] as const

describe('token foundation v2: structure', () => {
  it('ships the token families as separate files imported by the shared theme', () => {
    for (const f of ['grid', 'radius', 'type', 'icon', 'chrome', 'z', 'elevation', 'motion', 'state']) {
      expect(tokenFiles).toContain(`${f}.css`)
      expect(token('index.css')).toContain(`@import "./${f}.css";`)
    }
    expect(indexCss).toContain('@import "./tokens/index.css";')
  })

  it('keeps geometry, z, motion and spacing out of index.css (no second source)', () => {
    const root = rootOf(indexCss)
    for (const name of Object.keys(root)) {
      expect(name).not.toMatch(/^--(radius|z-|spacing$|motion-|ease-|control-|chrome-(topbar|rail|control|tab|status|panel|gap)|font-size-base$)/)
    }
    expect(rendererCss).not.toMatch(/--z-index-/)
  })

  it('declares every family named by the spec', () => {
    const root = rootOf(allTokens)
    for (const name of [
      '--font-size-root', '--spacing',
      '--radius-none', '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-full',
      '--icon-rail', '--icon-toolbar', '--icon-inline', '--icon-caption', '--icon-status', '--icon-empty', '--icon-stroke',
      '--control-sm', '--control-md', '--control-lg', '--rail-button', '--row-h', '--row-h-2line',
      '--chrome-topbar-height', '--chrome-panel-header-height', '--chrome-tab-strip-height', '--chrome-rail-width',
      '--shadow-none', '--shadow-overlay', '--ring-focus',
      '--motion-instant', '--motion-fast', '--motion-base', '--motion-slow', '--ease-standard',
      '--state-hover', '--state-pressed', '--state-selected', '--state-selected-strong', '--text-disabled',
      ...LAYERS.map((l) => `--z-${l}`),
    ]) {
      expect(root[name], name).toBeDefined()
    }
    const theme = token('type.css')
    for (const step of ['caption', 'small', 'body', 'reading', 'title-sm', 'title', 'display']) {
      expect(theme).toMatch(new RegExp(`--text-${step}:`))
      expect(theme).toMatch(new RegExp(`--text-${step}--line-height:`))
    }
  })

  it('density swaps values on html[data-density], never class names', () => {
    const comfortable = merge(blocks(token('chrome.css'), 'html[data-density="comfortable"]'))
    expect(Object.keys(comfortable).length).toBeGreaterThan(0)
    const compact = blocks(token('chrome.css'), ':root')[0]!
    for (const [name, value] of Object.entries(comfortable)) {
      expect(compact[name], name).toBeDefined()
      expect(px(value)).toBeGreaterThanOrEqual(px(compact[name]!))
    }
  })

  it('motion collapses to 0 under reduced motion and while resizing', () => {
    const motion = stripComments(token('motion.css'))
    for (const sel of ['html[data-resizing]', '@media (prefers-reduced-motion: reduce)']) {
      const at = motion.indexOf(sel)
      expect(at, sel).toBeGreaterThanOrEqual(0)
      const body = motion.slice(at, motion.indexOf('}', at))
      for (const t of ['--motion-fast', '--motion-base', '--motion-slow']) expect(body).toContain(`${t}: 0ms`)
    }
  })
})

describe('token foundation v2: z layers', () => {
  it('Tailwind z-* utilities exist for the layer names only', () => {
    const names = [...stripComments(allTokens + indexCss + rendererCss).matchAll(/--z-index-([\w-]+)\s*:/g)].map((m) => m[1])
    expect(names.sort()).toEqual([...LAYERS].sort())
  })

  it('layers are strictly ordered as specified', () => {
    const root = rootOf(token('z.css'))
    const values = LAYERS.map((l) => Number(resolve(root[`--z-${l}`]!, root)))
    for (let i = 1; i < values.length; i++) {
      if (LAYERS[i] === 'modal') expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]!)
      else if (LAYERS[i] === 'sash') expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]!)
      else expect(values[i], LAYERS[i]).toBeGreaterThan(values[i - 1]!)
    }
  })

  it('no source uses a retired z utility class', () => {
    const retired = /(?<![-\w])z-(local|titlebar|panel|dropdown|overlay|fullscreen|floating-backdrop|floating-menu|island-overlay)(?![-\w])/
    const offenders: string[] = []
    const glob = new Bun.Glob('{apps/electron/src,packages/ui/src}/**/*.{ts,tsx}')
    for (const file of glob.scanSync({ cwd: repoRoot })) {
      if (file.includes('__tests__') || file.includes('.test.')) continue
      const lines = readFileSync(join(repoRoot, file), 'utf8').split('\n')
      lines.forEach((line, i) => {
        const code = line.replace(/var\(--z-[\w-]+[^)]*\)/g, '')
        const trimmed = code.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        if (retired.test(code)) offenders.push(`${file}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('token foundation v2: radius', () => {
  const SCALE = new Set([0, 4, 6, 8, 12, 9999])

  it('every radius token resolves inside {0,4,6,8,12,9999}', () => {
    const root = rootOf(allTokens)
    const radii = Object.keys(root).filter((n) => n.startsWith('--radius'))
    expect(radii.length).toBeGreaterThan(8)
    for (const name of radii) {
      expect(SCALE.has(px(resolve(root[name]!, root))), `${name} = ${root[name]}`).toBe(true)
    }
  })

  it('UI profiles scale radius only within the scale', () => {
    const root = rootOf(allTokens)
    const profile = merge(blocks(indexCss, 'html[data-ui-profile="super-engineering"]'))
    for (const [name, value] of Object.entries(profile)) {
      if (!/radius/.test(name)) continue
      expect(SCALE.has(px(resolve(value, root))), `${name} = ${value}`).toBe(true)
    }
  })
})
