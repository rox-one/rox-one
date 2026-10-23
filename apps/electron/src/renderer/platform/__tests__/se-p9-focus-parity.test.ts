import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')
const css = readFileSync(join(root, 'index.css'), 'utf8')

describe('P9.3 SE focus parity — reuse #2211 token', () => {
  it('PanelHeaderCenterButton keeps panel-header-btn; no second Tailwind ring', () => {
    const src = readFileSync(join(root, 'components/ui/PanelHeaderCenterButton.tsx'), 'utf8')
    expect(src).toContain('panel-header-btn')
    expect(src.includes('focus-visible:ring-ring')).toBe(false)
  })

  it('LeftSidebar drops ring-ring; CSS applies --se-shell-focus-ring on data-sidebar-link-id', () => {
    const src = readFileSync(join(root, 'components/app-shell/LeftSidebar.tsx'), 'utf8')
    expect(src.includes('focus-visible:ring-ring')).toBe(false)
    expect(css).toContain('[data-sidebar-link-id]:focus-visible')
    expect(css).toContain('var(--se-shell-focus-ring)')
  })
})

describe('P9.4 SE rail fill tokens', () => {
  it('se-icon-map uses foreground opacity, not bg-white/N', () => {
    const src = readFileSync(join(import.meta.dir, '../../lib/se-icon-map.ts'), 'utf8')
    expect(src.includes('bg-white/')).toBe(false)
    expect(src).toContain('bg-foreground/[0.06]')
    expect(src).toContain('hover:bg-foreground/[0.04]')
  })
})
