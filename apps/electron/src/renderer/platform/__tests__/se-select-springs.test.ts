import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../../../../..')
const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
const renderer = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const select = readFileSync(
  join(root, 'apps/electron/src/renderer/components/ui/select.tsx'),
  'utf8',
)
const styledCtx = readFileSync(
  join(root, 'apps/electron/src/renderer/components/ui/styled-context-menu.tsx'),
  'utf8',
)

const marker = '/* Rox Engineering: remaining shared overlays.'
const start = ui.indexOf(marker)
const nextTour = ui.indexOf('/* Product tour demo mode', start)
const seBlock = start < 0 ? '' : ui.slice(start, nextTour < 0 ? undefined : nextTour)
const seBare = seBlock.replace(/\/\*[\s\S]*?\*\//g, '')

describe('SE Select + StyledContextMenuSubContent overlay springs', () => {
  it('opts SelectContent into data-overlay-motion (no tw animate-in)', () => {
    expect(select).toContain('data-slot="select-content"')
    expect(select).toContain('data-overlay-motion="true"')
    expect(select).toContain('data-glass-slot="popover"')
    expect(select).not.toContain('animate-in')
  })

  it('allows select animation when data-overlay-motion is set', () => {
    expect(renderer).toContain(
      '[data-radix-select-content]:not([data-overlay-motion])',
    )
  })

  it('opts StyledContextMenuSubContent into overlay-motion (ModeBar chrome)', () => {
    expect(styledCtx).toContain('data-slot="context-menu-sub-content"')
    expect(styledCtx).toContain('data-overlay-motion="true"')
    expect(styledCtx).not.toContain('animate-in')
  })

  it('SE menu spring list includes select-content', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(seBare).toContain('[data-slot="select-content"]')
    expect(seBare).toContain(
      'animation: rox-overlay-in var(--motion-disclosure) var(--ease-spring) both',
    )
    expect(seBare).not.toMatch(/\b\d+ms\b/)
  })
})
