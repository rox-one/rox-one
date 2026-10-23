import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../../../../..')
const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
const renderer = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const dropdown = readFileSync(
  join(root, 'apps/electron/src/renderer/components/ui/dropdown-menu.tsx'),
  'utf8',
)
const context = readFileSync(
  join(root, 'apps/electron/src/renderer/components/ui/context-menu.tsx'),
  'utf8',
)
const drawer = readFileSync(join(root, 'packages/ui/src/components/ui/drawer.tsx'), 'utf8')
const styled = readFileSync(
  join(root, 'packages/ui/src/components/ui/StyledDropdown.tsx'),
  'utf8',
)
const simple = readFileSync(
  join(root, 'packages/ui/src/components/ui/SimpleDropdown.tsx'),
  'utf8',
)

const marker = '/* Rox Engineering: remaining shared overlays.'
const start = ui.indexOf(marker)
const nextTour = ui.indexOf('/* Product tour demo mode', start)
const seBlock = start < 0 ? '' : ui.slice(start, nextTour < 0 ? undefined : nextTour)
const seBare = seBlock.replace(/\/\*[\s\S]*?\*\//g, '')

describe('SE remaining overlay springs (menus / drawer / tooltip)', () => {
  it('opts DropdownMenu and ContextMenu into data-overlay-motion (no tw animate-in)', () => {
    expect(dropdown).toContain('data-overlay-motion="true"')
    expect(dropdown).toContain('data-slot="dropdown-menu-content"')
    expect(dropdown).toContain('data-slot="dropdown-menu-sub-content"')
    expect(dropdown).not.toContain('animate-in')
    expect(context).toContain('data-overlay-motion="true"')
    expect(context).toContain('data-slot="context-menu-content"')
    expect(context).toContain('data-slot="context-menu-sub-content"')
    expect(context).not.toContain('animate-in')
    expect(styled).toContain('data-overlay-motion="true"')
    expect(simple).toContain('data-overlay-motion="true"')
    expect(simple).toContain('data-state="open"')
    expect(simple).toContain('data-slot="dropdown-menu-content"')
    expect(simple).not.toContain('duration-100')
    expect(simple).not.toContain('animate-in')
  })

  it('allows context-menu animation when data-overlay-motion is set', () => {
    expect(renderer).toContain(
      '[data-radix-context-menu-content]:not([data-overlay-motion])',
    )
    expect(renderer).toContain(
      '[data-radix-dropdown-menu-content]:not([data-overlay-motion])',
    )
  })

  it('DrawerOverlay opts into overlay-motion; content slide stays with vaul', () => {
    expect(drawer).toContain('data-slot="drawer-overlay"')
    expect(drawer).toContain('data-overlay-motion="true"')
    expect(drawer).not.toMatch(/drawer-overlay[\s\S]{0,200}animate-in/)
    expect(seBare).not.toContain('drawer-content')
  })

  it('SE menus use lighter disclosure spring; drawer overlay uses modal spring', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(seBare).toContain(
      'animation: rox-overlay-in var(--motion-disclosure) var(--ease-spring) both',
    )
    expect(seBare).toContain(
      'animation: rox-overlay-in var(--motion-base) var(--ease-spring) both',
    )
    expect(seBare).toContain(
      'animation: rox-opacity-in var(--motion-spring) var(--ease-spring) both',
    )
    expect(seBare).toContain(
      'animation: rox-overlay-out var(--motion-spring-exit) var(--ease-exit) both',
    )
    expect(seBare).not.toMatch(/\b\d+ms\b/)
    expect(seBare).not.toContain('var(--motion-fast)')
    expect(seBare).not.toContain('backdrop-filter')
  })
})
