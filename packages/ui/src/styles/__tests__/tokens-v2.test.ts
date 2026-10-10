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

const withoutMedia = (css: string) => stripComments(css).replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
/** Unconditional `:root` declarations (blocks inside @media are ignored). */
const merge = (bs: Record<string, string>[]): Record<string, string> => Object.assign({}, ...bs)
const rootOf = (css: string) => merge(blocks(withoutMedia(css), ':root'))

/** Resolves `var(--x)` chains against `scope` to a final literal. */
function resolve(value: string, scope: Record<string, string>, depth = 0): string {
  if (depth > 20) throw new Error(`cycle resolving ${value}`)
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name: string, fallback?: string) => {
    const next = scope[name] ?? fallback
    if (next === undefined) throw new Error(`unresolved ${name}`)
    return resolve(next, scope, depth + 1)
  })
}

/**
 * Numeric value of a z-index expression. Token substitution happens first, so
 * `calc(var(--z-base) - 1)` reduces to `calc(0 - 1)`; the sum is then evaluated
 * so a token-derived value is judged by the same layer-set rule as a literal.
 */
function numeric(value: string, scope: Record<string, string>): number {
  const resolved = resolve(value, scope).trim()
  const calc = resolved.match(/^calc\((.*)\)$/)
  if (!calc) return Number(resolved)
  let total = 0
  for (const term of calc[1]!.split(/(?=[+-])/)) {
    const n = Number(term.replace(/[()\s]/g, ''))
    if (!Number.isFinite(n)) throw new Error(`unsupported calc term "${term}" in ${value}`)
    total += n
  }
  return total
}

const px = (v: string) => {
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)px$/)
  if (!m) throw new Error(`not a px value: ${v}`)
  return Number(m[1])
}

const LAYERS = [
  'base', 'raised', 'sticky', 'chrome', 'sash', 'tour-vignette', 'popover', 'scrim', 'modal',
  'toast', 'fullscreen', 'menu-backdrop', 'island', 'island-popover', 'tooltip', 'splash',
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

  it('coarse-pointer hit-target floors win over data-density', () => {
    // Specificity [ids, classes/attrs/pseudo-classes, types] of a simple selector.
    const specificity = (sel: string): [number, number, number] => {
      const s = sel.replace(/\[[^\]]*\]/g, () => ' .a ')
      return [
        (s.match(/#/g) ?? []).length,
        (s.match(/\.[\w-]+|:(?!:)[\w-]+/g) ?? []).length,
        (s.replace(/\.[\w-]+|:[\w-]+/g, ' ').match(/(^|\s)[a-z][\w-]*/g) ?? []).length,
      ]
    }
    const beats = (a: number[], b: number[]) => a[0]! !== b[0]! ? a[0]! > b[0]! : a[1]! !== b[1]! ? a[1]! > b[1]! : a[2]! > b[2]!
    const css = stripComments(token('chrome.css'))
    const media = css.slice(css.indexOf('@media (pointer: coarse)'))
    const block = media.match(/\{\s*([^{}]+)\{([^{}]*)\}/)!
    const selectors = block[1]!.split(',').map((x) => x.trim())
    const floors = Object.keys(merge(blocks(`x{${block[2]}}`, 'x')))
    // Every unconditional density block that touches a floor must lose to a coarse selector.
    let checked = 0
    for (const m of withoutMedia(token('chrome.css') + indexCss).matchAll(/([^{};]*\[data-density[^{]*)\{([^{}]*)\}/g)) {
      const densitySel = m[1]!.trim()
      const overridden = floors.filter((f) => m[2]!.includes(`${f}:`))
      if (overridden.length === 0) continue
      checked++
      const wins = selectors.some((sel) => beats(specificity(sel), specificity(densitySel)))
      expect(wins, `${densitySel} overrides ${overridden.join(', ')}`).toBe(true)
    }
    expect(checked).toBeGreaterThan(0)
    expect(selectors).toContain(':root[data-density]')
    for (const f of ['--control-hit-min', '--chrome-control', '--chrome-topbar-height', '--chrome-panel-header-height']) {
      expect(floors).toContain(f)
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

  it('layers have the adopted values, strictly ordered', () => {
    const root = rootOf(token('z.css'))
    const values = Object.fromEntries(LAYERS.map((l) => [l, Number(resolve(root[`--z-${l}`]!, root))]))
    expect(values).toEqual({
      base: 0, raised: 1, sticky: 10, chrome: 20, sash: 30, 'tour-vignette': 90, popover: 100, scrim: 200, modal: 210,
      toast: 300, fullscreen: 350, 'menu-backdrop': 390, island: 400, 'island-popover': 410, tooltip: 450, splash: 600,
    })
    const ordered = LAYERS.map((l) => values[l]!)
    for (let i = 1; i < ordered.length; i++) expect(ordered[i], LAYERS[i]).toBeGreaterThan(ordered[i - 1]!)
  })

  it('every shell z-index value (incl. deprecated aliases) is in the layer set', () => {
    const root = rootOf(allTokens)
    const layerValues = new Set(LAYERS.map((l) => Number(resolve(root[`--z-${l}`]!, root))))
    const zVars = Object.keys(root).filter((n) => n.startsWith('--z-'))
    expect(zVars.length).toBeGreaterThan(LAYERS.length)
    for (const name of zVars) {
      expect(layerValues.has(Number(resolve(root[name]!, root))), `${name} = ${root[name]}`).toBe(true)
    }
    // Literal z-index declarations in the shared and renderer CSS use the layer set.
    for (const css of [indexCss, rendererCss]) {
      for (const m of stripComments(css).matchAll(/z-index:\s*([^;]+);/g)) {
        const raw = m[1]!.trim()
        const value = numeric(raw, root)
        if (value < 0) continue // behind-content pseudo layers (scenic wallpaper)
        expect(layerValues.has(value), `z-index: ${raw} = ${value}`).toBe(true)
      }
    }
  })

  it('keeps floating menus above modals and their backdrops between the two', () => {
    const root = rootOf(token('z.css'))
    const z = (n: string) => Number(resolve(`var(--z-${n})`, root))
    expect(z('floating-menu')).toBeGreaterThan(z('modal'))
    expect(z('floating-menu')).toBeGreaterThan(z('fullscreen'))
    expect(z('floating-backdrop')).toBeGreaterThan(z('fullscreen'))
    expect(z('floating-backdrop')).toBeLessThan(z('floating-menu'))
    expect(z('island-overlay')).toBeLessThan(z('island'))
    expect(z('scrim')).toBeLessThan(z('modal'))
  })

  it('puts fullscreen overlays above the dialog scrim/modal/toast step (main parity) and below menus and tooltips', () => {
    const root = rootOf(token('z.css'))
    const z = (n: string) => Number(resolve(`var(--z-${n})`, root))
    // An overlay opened from a drawer/popover covers its launcher; dialogs
    // opened from inside an overlay portal into its root instead.
    expect(z('fullscreen')).toBe(350)
    expect(z('fullscreen')).toBeGreaterThan(z('scrim'))
    expect(z('fullscreen')).toBeGreaterThan(z('modal'))
    expect(z('fullscreen')).toBeGreaterThan(z('toast'))
    expect(z('fullscreen')).toBeLessThan(z('menu-backdrop'))
    // Tooltips and in-overlay menus (island) stay visible inside the overlay.
    expect(z('tooltip')).toBeGreaterThan(z('fullscreen'))
    expect(z('island')).toBeGreaterThan(z('fullscreen'))
    // Still above app chrome and regular popovers.
    expect(z('fullscreen')).toBeGreaterThan(z('chrome'))
    expect(z('fullscreen')).toBeGreaterThan(z('popover'))
    // Legacy name for the same layer.
    expect(z('overlay')).toBe(z('fullscreen'))
  })

  it('inline var(--z-*, n) fallbacks match the token value (no stale fallbacks)', () => {
    const root = rootOf(token('z.css'))
    const stale: string[] = []
    const glob = new Bun.Glob('{apps/electron/src,packages/ui/src,packages/ui/eslint-rules,apps/electron/eslint-rules}/**/*.{ts,tsx,css,cjs}')
    for (const file of glob.scanSync({ cwd: repoRoot })) {
      if (file.includes('__tests__') || file.includes('.test.')) continue
      const text = readFileSync(join(repoRoot, file), 'utf8')
      for (const m of text.matchAll(/var\((--z-[\w-]+),\s*(-?\d+)\)/g)) {
        if (!(m[1]! in root)) continue
        if (Number(resolve(`var(${m[1]})`, root)) !== Number(m[2])) stale.push(`${file}: ${m[0]}`)
      }
    }
    expect(stale).toEqual([])
  })

  it('fullscreen overlays and their in-overlay menus use the right layers', () => {
    const src = (f: string) => readFileSync(join(repoRoot, f), 'utf8')
    expect(src('packages/ui/src/components/overlay/FullscreenOverlayBase.tsx')).toContain("const Z_FULLSCREEN = 'var(--z-fullscreen, 350)'")
    const header = src('packages/ui/src/components/overlay/FullscreenOverlayBaseHeader.tsx')
    expect(header).toMatch(/contextMenuContentClasses = cn\(\s*'popover-styled z-island /)
    // The path dropdown takes StyledDropdownMenuContent's z-island default; no deprecated alias inline.
    expect(header).not.toMatch(/--z-floating-menu|zIndex:/)
    expect(src('packages/ui/src/components/ui/InlineMenuSurface.ts')).toContain("options.zIndex ?? 'var(--z-popover, 100)'")
  })

  it('tooltips are the topmost transient layer; menus sit above dialogs, fullscreen and their backdrops', () => {
    const root = rootOf(token('z.css'))
    const z = (n: string) => Number(resolve(`var(--z-${n})`, root))
    // No tooltip can be hidden under the surface its trigger lives in.
    for (const below of ['popover', 'fullscreen', 'scrim', 'modal', 'toast', 'menu-backdrop', 'island', 'island-popover']) {
      expect(z('tooltip'), below).toBeGreaterThan(z(below))
    }
    expect(z('tooltip')).toBeLessThan(z('splash'))
    expect(z('island')).toBeGreaterThan(z('modal'))
    expect(z('island')).toBeGreaterThan(z('toast'))
    expect(z('island-popover')).toBeGreaterThan(z('island'))
    // Click-catching backdrops: menu-backdrop (main's 390), above fullscreen
    // (a menu inside an overlay closes on an outside click), below the menu.
    expect(z('menu-backdrop')).toBe(390)
    expect(z('menu-backdrop')).toBeGreaterThan(z('fullscreen'))
    expect(z('menu-backdrop')).toBeLessThan(z('island'))
    expect(z('floating-backdrop')).toBe(z('menu-backdrop'))
    expect(z('island-overlay')).toBe(z('menu-backdrop'))
  })

  it('no tooltip carries a per-site z override (the layer handles it)', () => {
    const offenders: string[] = []
    const glob = new Bun.Glob('{apps/electron/src,packages/ui/src}/**/*.tsx')
    for (const file of glob.scanSync({ cwd: repoRoot })) {
      if (file.includes('__tests__') || file.includes('.test.')) continue
      const text = readFileSync(join(repoRoot, file), 'utf8')
      for (const m of text.matchAll(/<TooltipContent\b[^>]*>/g)) {
        if (/(?<![-\w])z-[a-z]|zIndex/.test(m[0])) offenders.push(`${file}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('shared Radix menu primitives default to z-island, never z-popover', () => {
    const files: Record<string, number> = {
      'apps/electron/src/renderer/components/ui/select.tsx': 1,
      'apps/electron/src/renderer/components/ui/dropdown-menu.tsx': 2,
      'apps/electron/src/renderer/components/ui/popover.tsx': 1,
      'apps/electron/src/renderer/components/ui/context-menu.tsx': 2,
      'apps/electron/src/renderer/components/ui/styled-context-menu.tsx': 1,
      'packages/ui/src/components/ui/StyledDropdown.tsx': 2,
      'packages/ui/src/components/ui/SimpleDropdown.tsx': 1,
    }
    for (const [f, n] of Object.entries(files)) {
      const text = readFileSync(join(repoRoot, f), 'utf8')
      expect(text, f).not.toMatch(/(?<![-\w])z-popover(?![-\w])/)
      expect((text.match(/(?<![-\w])z-island(?![-\w])/g) ?? []).length, f).toBe(n)
    }
  })

  it('EditPopover is a chrome-level surface on z-popover (its menus and tooltips portal above)', () => {
    const text = readFileSync(join(repoRoot, 'apps/electron/src/renderer/components/ui/EditPopover.tsx'), 'utf8')
    expect(text).toContain('className="p-0 z-popover"')
    expect(text).toContain('className="fixed inset-0 bg-black/5 z-sticky"')
  })

  it('menu click-catching backdrops use the menu-backdrop step, not the menu or toast layer', () => {
    for (const f of [
      'apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx',
      'packages/ui/src/components/ui/FilterableSelectPopover.tsx',
      'packages/ui/src/components/ui/PremiumMenu.tsx',
    ]) {
      const text = readFileSync(join(repoRoot, f), 'utf8')
      expect(text, f).toMatch(/fixed inset-0 z-menu-backdrop/)
      expect(text, f).not.toMatch(/fixed inset-0 z-toast/)
      expect(text, f).not.toMatch(/fixed inset-0 z-island/)
    }
  })

  it('FullscreenOverlayBase callers pass no z class (the inline layer always wins)', () => {
    for (const f of [
      'apps/electron/src/renderer/components/workspace/WorkspaceCreationScreen.tsx',
      'apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx',
    ]) {
      const text = readFileSync(join(repoRoot, f), 'utf8')
      const at = text.indexOf('<FullscreenOverlayBase')
      expect(at, f).toBeGreaterThanOrEqual(0)
      expect(text.slice(at, text.indexOf('>', at)), f).not.toMatch(/(?<![-\w])z-[a-z]/)
    }
  })

  it('content inside a fullscreen overlay uses local layers, not the fullscreen layer', () => {
    // The overlay is its own stacking context: z-fullscreen inside it means
    // nothing relative to the page and only competes with the overlay's own
    // portal root (dialogs/drawers).
    const text = readFileSync(join(repoRoot, 'apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx'), 'utf8')
    const body = text.slice(text.indexOf('<FullscreenOverlayBase'), text.indexOf('</FullscreenOverlayBase>'))
    expect(body).not.toMatch(/(?<![-\w])z-fullscreen(?![-\w])/)
  })

  it('the AI-settings API-setup close button stacks above the wizard titlebar drag strip and is no-drag', () => {
    // OnboardingWizard (rendered inside the same overlay, no stacking context of
    // its own) paints a fixed titlebar drag strip over the top 50px; the close
    // control must sit above it or its clicks land on the drag region.
    const root = rootOf(token('z.css'))
    const zv = (n: string) => Number(resolve(`var(--z-${n})`, root))
    const wizard = readFileSync(join(repoRoot, 'apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx'), 'utf8')
    const strip = wizard.match(/className="titlebar-drag-region fixed top-0 left-0 right-0 h-\[50px\] (z-[\w-]+)"/)
    expect(strip?.[1]).toBe('z-chrome')
    const stripZ = zv(strip![1]!.slice(2))

    const text = readFileSync(join(repoRoot, 'apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx'), 'utf8')
    const body = text.slice(text.indexOf('<FullscreenOverlayBase'), text.indexOf('</FullscreenOverlayBase>'))
    expect(body).toContain('<OnboardingWizard')
    const close = body.slice(body.lastIndexOf('<div', body.indexOf('onClick={handleCloseApiSetup}')), body.indexOf('onClick={handleCloseApiSetup}'))
    expect(close).toContain('className="titlebar-no-drag fixed top-0 right-0 h-[50px]')
    expect(close).not.toMatch(/(?<![-\w])z-[a-z]/) // no low/fullscreen utility competing with the inline layer
    const z = close.match(/zIndex: 'calc\(var\(--z-([\w-]+)\) \+ (\d+)\)'/)
    expect(z).not.toBeNull()
    expect(zv(z![1]!) + Number(z![2])).toBeGreaterThan(stripZ)
    expect(zv(z![1]!) + Number(z![2])).toBeLessThan(zv('fullscreen'))
  })

  it('no source uses a retired z utility class', () => {
    const retired = /(?<![-\w])z-(local|titlebar|panel|dropdown|overlay|floating-backdrop|floating-menu|island-overlay)(?![-\w])/
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

  it('menus, popovers, controls and inner cards do not use the overlay radius role', () => {
    const menus = [
      'apps/electron/src/renderer/pages/tasks/MoveDialog.tsx',
      'apps/electron/src/renderer/components/app-shell/collection/CollectionDisplayPopover.tsx',
      'apps/electron/src/renderer/pages/notes/NotesDialogs.tsx',
      'packages/ui/src/components/markdown/MarkdownSpreadsheetBlock.tsx',
      'packages/ui/src/components/markdown/MarkdownDatatableBlock.tsx',
      'apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx',
      'packages/ui/src/components/ui/FilterableSelectPopover.tsx',
      'packages/ui/src/components/ui/SimpleDropdown.tsx',
      'packages/ui/src/components/ui/premium-menu-model.ts',
      'packages/ui/src/components/markdown/tiptap-editor.css',
      'apps/electron/src/renderer/components/ui/session-status-menu.tsx',
      'apps/electron/src/renderer/components/ui/skill-mention-menu.tsx',
      'apps/electron/src/renderer/components/ui/slash-command-menu.tsx',
      'apps/electron/src/renderer/components/ui/mention-menu.tsx',
      'apps/electron/src/renderer/components/ui/label-menu.tsx',
      'apps/electron/src/renderer/components/ui/EditPopover.tsx',
      'apps/electron/src/renderer/components/app-shell/input/WorkingDirectorySelector.tsx',
      'apps/electron/src/renderer/components/app-shell/SessionInfoPopover.tsx',
      'apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx',
      'apps/electron/src/renderer/pages/notes/NotesDocumentChrome.tsx',
    ]
    for (const f of menus) expect(readFileSync(join(repoRoot, f), 'utf8'), f).not.toContain('--radius-overlay')
  })

  it('legacy --rox-radius-* alias the radius tokens (single source)', () => {
    const root = rootOf(indexCss)
    expect(root['--rox-radius-sm']).toBe('var(--radius-sm)')
    expect(root['--rox-radius-md']).toBe('var(--radius-md)')
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

describe('token foundation v2: values (step 2)', () => {
  const root = rootOf(allTokens)
  const v = (name: string) => resolve(root[name]!, root)

  it('uses a fixed 16px root and a 4px spacing grid', () => {
    expect(v('--font-size-root')).toBe('16px')
    expect(v('--spacing')).toBe('4px')
    expect(stripComments(indexCss)).toMatch(/html\s*\{\s*font-size:\s*var\(--font-size-root\);/)
    const profile = blocks(indexCss, 'html[data-ui-profile="super-engineering"]')[0]!
    expect(profile['--font-size-root']).toBeUndefined()
  })

  it('maps radius roles and legacy Tailwind steps onto the scale', () => {
    expect([v('--radius-none'), v('--radius-xs'), v('--radius-sm'), v('--radius-md'), v('--radius-lg'), v('--radius-full')])
      .toEqual(['0px', '4px', '6px', '8px', '12px', '9999px'])
    expect(root['--radius-control']).toBe('var(--radius-sm)')
    expect(root['--radius-card']).toBe('var(--radius-md)')
    expect(root['--radius-overlay']).toBe('var(--radius-lg)')
    // rounded-xl (and 2xl/3xl/4xl) resolve to --radius-lg.
    for (const step of ['xl', '2xl', '3xl', '4xl']) expect(root[`--radius-${step}`]).toBe('var(--radius-lg)')
  })

  it('remaps text-xs…xl onto caption/small/body/reading/title', () => {
    const theme = merge(blocks(token('type.css'), '@theme'))
    const pairs: Record<string, [string, string]> = {
      caption: ['11px', '14px'], small: ['12px', '16px'], body: ['13px', '20px'], reading: ['15px', '24px'],
      'title-sm': ['15px', '20px'], title: ['18px', '24px'], display: ['24px', '32px'],
    }
    // Line heights are unitless ratios that resolve to the listed px on the element.
    const ratio = (v: string) => {
      const m = v.match(/^calc\((\d+(?:\.\d+)?) \/ (\d+(?:\.\d+)?)\)$/)
      if (!m) throw new Error(`not a unitless calc ratio: ${v}`)
      return Number(m[1]) / Number(m[2])
    }
    for (const [step, [size, lh]] of Object.entries(pairs)) {
      expect(theme[`--text-${step}`], step).toBe(size)
      expect(ratio(theme[`--text-${step}--line-height`]!) * px(size), step).toBeCloseTo(px(lh), 6)
    }
    for (const [name, value] of Object.entries(theme)) {
      if (name.endsWith('--line-height')) expect(value, name).not.toMatch(/px/)
    }
    expect(stripComments(indexCss)).toMatch(/body\s*\{[^}]*line-height:\s*var\(--text-body--line-height\);/)
    const remap = { xs: 'caption', sm: 'small', base: 'body', lg: 'reading', xl: 'title' }
    for (const [tw, step] of Object.entries(remap)) {
      expect(theme[`--text-${tw}`], tw).toBe(theme[`--text-${step}`])
      expect(theme[`--text-${tw}--line-height`], tw).toBe(theme[`--text-${step}--line-height`])
    }
    for (const size of Object.values(theme).filter((x) => /px$/.test(x))) expect(px(size)).toBeGreaterThanOrEqual(11)
  })

  it('sets the lucide stroke in CSS and sizes icons 20-in-36 / 16-in-28', () => {
    expect(stripComments(token('icon.css'))).toMatch(/svg\.lucide\s*\{\s*stroke-width:\s*var\(--icon-stroke,\s*1\.75\);/)
    expect(v('--icon-stroke')).toBe('1.75')
    expect(v('--icon-rail')).toBe('20px')
    expect(v('--rail-button')).toBe('36px')
    expect(v('--icon-toolbar')).toBe('16px')
    expect(v('--control-md')).toBe('28px')
    expect(v('--chrome-rail-width')).toBe('48px')
    expect(v('--chrome-panel-header-height')).toBe('32px')
    expect(v('--chrome-tab-strip-height')).toBe('32px')
  })

  it('shadow-sm|md|lg resolve to real elevation values (no self-reference)', () => {
    const theme = merge(blocks(token('elevation.css'), '@theme inline'))
    expect(theme['--shadow-sm']).toBe('var(--shadow-popover)')
    expect(theme['--shadow-md']).toBe('var(--shadow-popover)')
    expect(theme['--shadow-lg']).toBe('var(--shadow-overlay)')
    for (const [name, value] of Object.entries(theme)) expect(value, name).not.toContain(`var(${name})`)
    expect(stripComments(indexCss)).not.toMatch(/--shadow-(2xs|xs|sm|md|lg|xl|2xl)?:\s*var\(--shadow(-2xs|-xs|-sm|-md|-lg|-xl|-2xl)?\)/)
    for (const name of ['--shadow-popover', '--shadow-overlay']) {
      // G8: one ring colour for both modes (--elev-ring) + two-layer depth.
      expect(root[name]).toMatch(
        /^0 0 0 1px var\(--elev-ring\), 0 \d+px \d+px -\d+px rgb\(0 0 0 \/ 0\.\d+\), 0 \d+px \d+px -\d+px rgb\(0 0 0 \/ 0\.\d+\)$/,
      )
    }
    const dark = merge(blocks(token('elevation.css'), '.dark'))
    expect(dark['--shadow-popover']).toContain('0.5')
    expect(dark['--shadow-overlay']).toContain('0.6')
  })

  it('uses the adopted motion and state values', () => {
    expect([v('--motion-instant'), v('--motion-fast'), v('--motion-base'), v('--motion-slow')]).toEqual(['0ms', '120ms', '180ms', '240ms'])
    expect(v('--ease-standard')).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
    expect(root['--state-hover']).toContain('var(--foreground) 4%')
    expect(root['--state-pressed']).toContain('var(--foreground) 8%')
    expect(root['--state-selected']).toContain('var(--accent) 12%')
    // Hover is neutral: no accent in the hover state.
    expect(root['--state-hover']).not.toContain('--accent')
  })

  it('keeps literal radii in the shared CSS on the scale', () => {
    const SCALE = new Set([0, 4, 6, 8, 12, 9999])
    for (const m of stripComments(indexCss + rendererCss).matchAll(/border-radius:\s*(-?\d+(?:\.\d+)?)px\s*;/g)) {
      expect(SCALE.has(Number(m[1])), `border-radius: ${m[1]}px`).toBe(true)
    }
  })
})
