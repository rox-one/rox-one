/**
 * PERF-07 (#1566): low-power rendering profile, glass only on chrome,
 * opaque overlays. Renderer side: the DOM attribute, the CSS contract and
 * an overlay source guard (stand-in for `rox/no-backdrop-on-overlay` until
 * UI-A2 lands the lint rule).
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { applyRenderProfile, seedRenderProfile, startRenderProfileSync } from '../render-profile-dom'
import { prefersReducedMotionNow, readRenderProfile, reducedMotionFor } from '../render-profile-motion'
import { lowPowerStatusKey } from '../render-profile-status'
import type { ZenShellSnapshot } from '../../../shared/shell-appearance'

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
    hasAttribute: (name: string) => attrs.has(name),
    getAttribute: (name: string) => attrs.get(name) ?? null,
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

describe('motion/react follows the profile', () => {
  it('reads the profile from <html> and maps it to MotionConfig.reducedMotion', () => {
    expect(readRenderProfile({ getAttribute: () => 'performance' })).toBe('performance')
    expect(readRenderProfile({ getAttribute: () => null })).toBe('standard')
    expect(readRenderProfile({ getAttribute: () => 'standard' })).toBe('standard')
    expect(readRenderProfile(null)).toBe('standard')
    expect(reducedMotionFor('performance')).toBe('always')
    expect(reducedMotionFor('standard')).toBe('user')
  })

  it('wraps the renderer root and re-renders on attribute changes', () => {
    const main = readFileSync(join(renderer, 'main.tsx'), 'utf8')
    expect(main).toMatch(/<RenderProfileMotionConfig>[\s\S]*\{app\}[\s\S]*<\/RenderProfileMotionConfig>/)
    const motion = readFileSync(join(renderer, 'lib/render-profile-motion.tsx'), 'utf8')
    expect(motion).toContain("from 'motion/react'")
    expect(motion).toContain("attributeFilter: [ATTRIBUTE]")
    expect(motion).toContain('useSyncExternalStore(subscribe, snapshot')
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

  it('stops every infinite shimmer', () => {
    const shimmer = rulesFor('[data-render-profile="performance"]').find(rule => rule.includes('.animate-shimmer::after'))
    expect(shimmer).toBeDefined()
    for (const selector of ['.animate-shimmer-loading', '.animate-shimmer-text', '.animate-shimmer::after']) expect(shimmer).toContain(selector)
    expect(shimmer).toContain('animation: none !important')
    const tiptap = readFileSync(join(repo, 'packages/ui/src/components/markdown/tiptap-editor.css'), 'utf8')
    expect(tiptap).toMatch(/html\[data-render-profile="performance"\] \.tiptap-editor \.tiptap-prose img\[data-loading='true'\] \{\s*animation: none;/)
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
    // Only the blur goes; the column-settings popover stays forced-dark.
    expect(kanban).toMatch(/PopoverContent[\s\S]{0,200}className="dark w-64 /)
    expect(kanban).not.toContain('backdrop-blur')
    expect(read('packages/ui/src/components/annotations/AnnotationIslandMenu.tsx')).not.toContain('backdrop-blur')
    expect(read('apps/electron/src/renderer/components/workspace/WorktreeHoverCard.tsx')).not.toContain('backdrop-blur')
  })
})

describe('Settings → Appearance → Low-power mode', () => {
  it('is a three-state Automatic / On / Off choice persisted as renderProfile', () => {
    const page = readFileSync(join(renderer, 'pages/settings/ZenShellSettings.tsx'), 'utf8')
    expect(page).toContain("t('settings.appearance.lowPowerMode')")
    expect(page).toContain("snapshot.renderProfilePreference ?? 'auto'")
    expect(page).toContain("{ value: 'auto', label: t('settings.appearance.lowPowerModeAuto') }")
    expect(page).toContain("{ value: 'performance', label: t('settings.appearance.lowPowerModeOn') }")
    expect(page).toContain("{ value: 'standard', label: t('settings.appearance.lowPowerModeOff') }")
    expect(page).toContain('if (isRenderProfilePreference(value)) void persist({ renderProfile: value })')
    for (const locale of readdirSync(join(repo, 'packages/shared/src/i18n/locales'))) {
      const strings = JSON.parse(readFileSync(join(repo, 'packages/shared/src/i18n/locales', locale), 'utf8'))
      for (const key of ['lowPowerMode', 'lowPowerModeDesc', 'lowPowerModeAuto', 'lowPowerModeOn', 'lowPowerModeOff']) {
        expect(typeof strings[`settings.appearance.${key}`]).toBe('string')
      }
    }
  })

  it('a profile-only patch does not pin Zen defaults or write twice', () => {
    const handler = readFileSync(join(renderer, '../main/handlers/settings.ts'), 'utf8')
    expect(handler).toContain('if (Object.keys(shellPatch).length > 0) setZenShellPreference(shellPatch)')
    expect(handler).toContain('if (renderProfile !== undefined) setRenderProfilePreference(renderProfile)')
  })
})

function rendererSources(dir = renderer): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...rendererSources(path))
    else if (/\.(tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

describe('reduced motion everywhere follows the profile', () => {
  it('prefersReducedMotionNow() is true for the low-power profile or the OS setting', () => {
    const g = globalThis as Record<string, unknown>
    const saved = { document: g.document, window: g.window }
    let profile: string | null = null
    let osReduce = false
    g.document = { documentElement: { getAttribute: () => profile } }
    g.window = { matchMedia: () => ({ matches: osReduce }) }
    try {
      expect(prefersReducedMotionNow()).toBe(false)
      profile = 'performance'
      expect(prefersReducedMotionNow()).toBe(true)
      profile = null
      osReduce = true
      expect(prefersReducedMotionNow()).toBe(true)
    } finally {
      g.document = saved.document
      g.window = saved.window
    }
  })

  it('no renderer code reads motion/react useReducedMotion or the raw media query directly', () => {
    const offenders: string[] = []
    for (const file of rendererSources()) {
      if (file.endsWith('render-profile-motion.tsx')) continue
      const src = readFileSync(file, 'utf8')
      if (/\buseReducedMotion\s*\(/.test(src) || /matchMedia\([^)]*prefers-reduced-motion/.test(src)) {
        offenders.push(relative(repo, file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('inline reduced-motion style blocks also honour the low-power profile', () => {
    for (const file of ['pages/TasksPage.tsx', 'pages/meetings/MeetingsSidebar.tsx', 'pages/notes/NotesNavigationSidebar.tsx']) {
      expect(readFileSync(join(renderer, file), 'utf8')).toContain('html[data-render-profile="performance"]')
    }
  })
})

describe('CSS: low-power pulses', () => {
  it('stops skeleton and motion-safe pulses but not spinners or live indicators', () => {
    const rule = rulesFor('.animate-pulse').find(r => r.includes('data-render-profile="performance"'))
    expect(rule).toBeDefined()
    expect(rule).toContain('motion-safe\\:animate-pulse')
    expect(rule).toContain(':not([data-live-indicator])')
    expect(rule).toContain('animation: none !important')
    expect(rulesFor('animate-spin').filter(r => r.includes('data-render-profile'))).toEqual([])
  })

  it('recording and running indicators opt out explicitly', () => {
    for (const file of [
      'components/meetings/MeetingRecordingIndicator.tsx',
      'pages/MeetingsPage.tsx',
      'pages/meetings/LocalMeetingDetail.tsx',
      'components/session-workbench/SceneNode.tsx',
      'components/app-shell/kanban/SubtaskProgress.tsx',
    ]) {
      expect(readFileSync(join(renderer, file), 'utf8')).toContain('data-live-indicator')
    }
  })
})

describe('root-level profile sync', () => {
  const electron = { getRuntimeEnvironment: () => 'electron' as const }

  it('seeds Windows desktop windows low-power before the first snapshot', () => {
    const win = fakeRoot()
    seedRenderProfile(win, electron, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/39')
    expect(win.attrs.get('data-render-profile')).toBe('performance')
    const mac = fakeRoot()
    seedRenderProfile(mac, electron, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/39')
    expect(mac.attrs.has('data-render-profile')).toBe(false)
    const web = fakeRoot()
    seedRenderProfile(web, { getRuntimeEnvironment: () => 'web' as const }, 'Mozilla/5.0 (Windows NT 10.0)')
    expect(web.attrs.has('data-render-profile')).toBe(false)
  })

  it('applies every snapshot and keeps a single subscription across restarts', async () => {
    const listeners = new Set<(s: ZenShellSnapshot) => void>()
    const api = {
      ...electron,
      getShellSnapshot: async () => ({ renderProfile: 'performance' }) as ZenShellSnapshot,
      onShellChanged: (cb: (s: ZenShellSnapshot) => void) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    }
    const root = fakeRoot()
    startRenderProfileSync(api, root)
    const stop = startRenderProfileSync(api, root)
    expect(listeners.size).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(root.attrs.get('data-render-profile')).toBe('performance')
    for (const cb of listeners) cb({ renderProfile: 'standard' } as ZenShellSnapshot)
    expect(root.attrs.has('data-render-profile')).toBe(false)
    stop()
    expect(listeners.size).toBe(0)
  })

  it('is started in main.tsx before the first React render, outside AppShell', () => {
    const main = readFileSync(join(renderer, 'main.tsx'), 'utf8')
    const start = main.indexOf('startRenderProfileSync(window.electronAPI')
    expect(start).toBeGreaterThan(-1)
    expect(main.indexOf('seedRenderProfile(document.documentElement')).toBeLessThan(start)
    expect(start).toBeLessThan(main.indexOf('ReactDOM.createRoot('))
  })
})

describe('Settings: Automatic shows the current state', () => {
  it('maps the snapshot reason to a status line only for Automatic', () => {
    expect(lowPowerStatusKey({ renderProfilePreference: 'auto', renderProfile: 'performance', renderProfileReason: 'windows' }))
      .toBe('settings.appearance.lowPowerModeAutoOnWindows')
    expect(lowPowerStatusKey({ renderProfilePreference: 'auto', renderProfile: 'performance', renderProfileReason: 'weak-hardware' }))
      .toBe('settings.appearance.lowPowerModeAutoOnWeakHardware')
    expect(lowPowerStatusKey({ renderProfilePreference: 'auto', renderProfile: 'performance', renderProfileReason: 'software-compositing' }))
      .toBe('settings.appearance.lowPowerModeAutoOnNoGpu')
    expect(lowPowerStatusKey({ renderProfilePreference: 'auto', renderProfile: 'standard', renderProfileReason: 'default' }))
      .toBe('settings.appearance.lowPowerModeAutoOff')
    expect(lowPowerStatusKey({ renderProfile: 'standard' })).toBe('settings.appearance.lowPowerModeAutoOff')
    expect(lowPowerStatusKey({ renderProfilePreference: 'performance', renderProfile: 'performance', renderProfileReason: 'user-performance' })).toBeNull()
    expect(lowPowerStatusKey({ renderProfilePreference: 'standard', renderProfile: 'standard', renderProfileReason: 'user-standard' })).toBeNull()
    expect(lowPowerStatusKey({ renderProfilePreference: 'auto' })).toBeNull()
    expect(lowPowerStatusKey(null)).toBeNull()
  })

  it('is appended to the row description and translated in every locale', () => {
    const settings = readFileSync(join(renderer, 'pages/settings/ZenShellSettings.tsx'), 'utf8')
    expect(settings).toContain('lowPowerStatusKey(snapshot)')
    expect(settings).toContain('description={lowPowerDescription}')
    const localesDir = join(repo, 'packages/shared/src/i18n/locales')
    const locales = readdirSync(localesDir).filter(name => name.endsWith('.json'))
    expect(locales.length).toBe(12)
    for (const name of locales) {
      const strings = JSON.parse(readFileSync(join(localesDir, name), 'utf8')) as Record<string, string>
      for (const key of ['lowPowerModeAutoOff', 'lowPowerModeAutoOnNoGpu', 'lowPowerModeAutoOnWeakHardware', 'lowPowerModeAutoOnWindows']) {
        expect(strings[`settings.appearance.${key}`]?.length ?? 0).toBeGreaterThan(0)
      }
    }
  })
})
