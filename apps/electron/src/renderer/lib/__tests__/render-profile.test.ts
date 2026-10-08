/**
 * PERF-07 (#1566): low-power rendering profile, glass only on chrome,
 * opaque overlays. Renderer side: the DOM attribute, the CSS contract and
 * an overlay source guard (stand-in for `rox/no-backdrop-on-overlay` until
 * UI-A2 lands the lint rule).
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { applyRenderProfile } from '../render-profile-dom'

const renderer = join(import.meta.dir, '../..')
const repo = join(renderer, '../../../..')
const css = readFileSync(join(renderer, 'index.css'), 'utf8')
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '')

function fakeRoot() {
  const attrs = new Map<string, string>()
  return {
    attrs,
    setAttribute: (name: string, value: string) => { attrs.set(name, value) },
    removeAttribute: (name: string) => { attrs.delete(name) },
  } as unknown as HTMLElement & { attrs: Map<string, string> }
}

/** Rule bodies whose selector contains `needle`. */
function rulesFor(needle: string): string[] {
  const out: string[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (const m of cssRules.matchAll(re)) {
    if (m[1].includes(needle)) out.push(`${m[1].trim()} { ${m[2].trim()} }`)
  }
  return out
}

describe('applyRenderProfile', () => {
  it('mirrors performance on <html> and clears it otherwise', () => {
    const root = fakeRoot()
    applyRenderProfile(root, { renderProfile: 'performance' })
    expect(root.attrs.get('data-render-profile')).toBe('performance')
    applyRenderProfile(root, { renderProfile: 'standard' })
    expect(root.attrs.has('data-render-profile')).toBe(false)
    applyRenderProfile(root, { renderProfile: 'performance' })
    applyRenderProfile(root, {})
    expect(root.attrs.has('data-render-profile')).toBe(false)
    applyRenderProfile(root, null)
    expect(root.attrs.has('data-render-profile')).toBe(false)
  })

  it('is applied from the main-owned shell snapshot', () => {
    const hook = readFileSync(join(renderer, 'hooks/useShellAppearance.ts'), 'utf8')
    expect(hook).toContain('applyRenderProfile(root, snapshot)')
  })
})

describe('CSS: glass only on chrome, never over native material', () => {
  it('does not layer a CSS backdrop blur over vibrancy or Mica', () => {
    const blurRules = [...cssRules.matchAll(/([^{}]+)\{([^{}]*backdrop-filter:\s*blur[^{}]*)\}/g)]
    expect(blurRules.length).toBeGreaterThan(0)
    for (const [, selector] of blurRules) {
      expect(selector).not.toMatch(/data-shell-material="(vibrancy|mica)"/)
      expect(selector).not.toContain('data-shell-runtime="electron"')
    }
  })

  it('keeps the translucent shell tints so the native material still shows on chrome', () => {
    expect(css).toMatch(/html\[data-shell-runtime="electron"\]:is\(\[data-shell-material="vibrancy"\], \[data-shell-material="mica"\]\) \{\s*--shell-glass-topbar: color-mix/)
  })
})

describe('CSS: low-power profile', () => {
  const rootRule = rulesFor('html[data-render-profile="performance"] ').concat(rulesFor('html[data-render-profile="performance"]\n'))
  const all = rulesFor('[data-render-profile="performance"]').join('\n')

  it('removes every CSS backdrop blur', () => {
    expect(all).toMatch(/html\[data-render-profile="performance"\] \*,[\s\S]*?\*::after \{[^}]*backdrop-filter: none !important;[^}]*-webkit-backdrop-filter: none !important;/)
    expect(all).toContain('--shell-glass-blur: 0px')
    expect(all).toContain('--chrome-glass-blur: 0px')
  })

  it('uses solid shell tints', () => {
    for (const token of ['--shell-glass-topbar', '--shell-glass-rail', '--shell-glass-strip', '--shell-glass-inspector']) {
      expect(all).toMatch(new RegExp(`${token}: rgb\\(from [^;]+ r g b / 1\\) !important;`))
    }
    expect(all).toContain('--shell-backdrop-tint: var(--surface-elevated) !important')
    expect(rootRule.length).toBeGreaterThan(0)
  })

  it('reduces motion without looping finite animations', () => {
    for (const token of ['--motion-fast: 0ms', '--motion-normal: 0ms', '--motion-slow: 0ms']) expect(all).toContain(token)
    expect(all).toContain('transition-duration: 0.01ms !important')
    expect(all).toContain('animation-iteration-count: 1 !important')
  })
})

describe('CSS: overlays are opaque', () => {
  it('never blurs popovers, menus, tooltips, toasts or dialogs', () => {
    const net = css.slice(css.indexOf('OPAQUE OVERLAYS'))
    const block = net.slice(0, net.indexOf('}') + 1)
    for (const target of ['[data-sonner-toast]', '[data-slot="tooltip-content"]', '[data-slot="popover-content"]', '[data-slot="dropdown-menu-content"]', '[data-slot="context-menu-content"]', '[data-slot="select-content"]', '[data-slot="dialog-content"]', '[role="tooltip"]', '[role="menu"]', '[role="dialog"]']) {
      expect(block).toContain(target)
    }
    expect(block).toContain('backdrop-filter: none !important')
  })

  it('paints toasts with an opaque popover fill', () => {
    const toast = rulesFor('[data-sonner-toast]').find(rule => rule.startsWith('[data-sonner-toast] {'))
    expect(toast).toBeDefined()
    expect(toast).toContain('oklch(from var(--popover) l c h / 1) !important')
    const sonner = readFileSync(join(renderer, 'components/ui/sonner.tsx'), 'utf8')
    expect(sonner).not.toContain('backdrop-blur')
  })
})

// Overlay call sites: no backdrop blur and no translucent fill. Matches the
// UI-A2 lint rule's intent; the baseline below lists known exceptions.
const OVERLAY_MARKERS = /role="(menu|tooltip|dialog|alertdialog)"|<(PopoverContent|TooltipContent|HoverCardContent|DropdownMenuContent|ContextMenuContent|DialogContent)\b|toastOptions/
const TRANSLUCENT = /backdrop-blur|\bbg-(background|popover|card|paper)\/\d+|bg-\[color-mix\(in_oklch,var\(--paper\)_\d+%,transparent\)\]/
// SessionWorkflowEditor's node menu: the same line is restyled by the open
// UI-A1 branch (#1567); fold it in after that merges.
const BASELINE = new Set(['apps/electron/src/renderer/components/session-workbench/SessionWorkflowEditor.tsx'])

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'playground') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* sources(path)
    else if (name.endsWith('.tsx') && !name.includes('.test.') && !name.includes('.playground.')) yield path
  }
}

describe('overlay call sites (rox/no-backdrop-on-overlay baseline)', () => {
  it('have no translucent fill or backdrop blur', () => {
    const offenders: string[] = []
    for (const root of [renderer, join(repo, 'packages/ui/src/components')]) {
      for (const file of sources(root)) {
        const lines = readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, index) => {
          if (!OVERLAY_MARKERS.test(line)) return
          const window = lines.slice(Math.max(0, index - 4), index + 6).join('\n')
          if (TRANSLUCENT.test(window)) offenders.push(`${relative(repo, file)}:${index + 1}`)
        })
      }
    }
    const unexpected = offenders.filter(entry => !BASELINE.has(entry.split(':')[0]))
    expect(unexpected).toEqual([])
  })

  it('cover the components named in the issue', () => {
    const read = (path: string) => readFileSync(join(repo, path), 'utf8')
    expect(read('apps/electron/src/renderer/components/app-shell/ProfileStrip.tsx')).not.toContain('backdrop-blur')
    const kanban = read('apps/electron/src/renderer/components/app-shell/kanban/KanbanColumn.tsx')
    expect(kanban).not.toMatch(/PopoverContent[\s\S]{0,200}className="dark /)
    expect(kanban).not.toContain('backdrop-blur')
    expect(read('packages/ui/src/components/annotations/AnnotationIslandMenu.tsx')).not.toContain('backdrop-blur')
    expect(read('apps/electron/src/renderer/components/workspace/WorktreeHoverCard.tsx')).not.toContain('backdrop-blur')
  })
})

describe('Settings → Appearance → Low-power mode', () => {
  it('persists the toggle through SET_ZEN_SHELL as renderProfile', () => {
    const page = readFileSync(join(renderer, 'pages/settings/ZenShellSettings.tsx'), 'utf8')
    expect(page).toContain("t('settings.appearance.lowPowerMode')")
    expect(page).toContain("snapshot.renderProfile === 'performance'")
    expect(page).toContain("persist({ renderProfile: checked ? 'performance' : 'standard' })")
    const handler = readFileSync(join(renderer, '../main/handlers/settings.ts'), 'utf8')
    expect(handler).toContain('setRenderProfilePreference(renderProfile)')
    for (const locale of readdirSync(join(repo, 'packages/shared/src/i18n/locales'))) {
      const strings = JSON.parse(readFileSync(join(repo, 'packages/shared/src/i18n/locales', locale), 'utf8'))
      expect(typeof strings['settings.appearance.lowPowerMode']).toBe('string')
      expect(typeof strings['settings.appearance.lowPowerModeDesc']).toBe('string')
    }
  })
})
