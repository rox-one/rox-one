import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SHELL_BREAKPOINTS,
  SHELL_EDGE_INSET,
  shellBand,
  shellEdgeInset,
} from '../viewport-band'

const root = join(import.meta.dir, '../../../../../..')
const chrome = readFileSync(join(root, 'packages/ui/src/styles/tokens/chrome.css'), 'utf8')
const css = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const appShell = readFileSync(join(root, 'apps/electron/src/renderer/components/app-shell/AppShell.tsx'), 'utf8')
const hook = readFileSync(join(root, 'apps/electron/src/renderer/hooks/useContainerWidth.ts'), 'utf8')
const uwStart = css.indexOf('/* Rox Engineering ultra-wide / fluid shell.')
const uwEnd = css.indexOf('/* Rox Engineering shell focus rings')
const seBlock = css.slice(uwStart, uwEnd < 0 ? undefined : uwEnd)

describe('SE ultra-wide / fluid shell', () => {
  it('shellBand mirrors SHELL_BREAKPOINTS / --shell-bp-*', () => {
    expect(shellBand(899)).toBe('compact')
    expect(shellBand(900)).toBe('compact')
    expect(shellBand(1279)).toBe('compact')
    expect(shellBand(1280)).toBe('regular')
    expect(shellBand(1599)).toBe('regular')
    expect(shellBand(1600)).toBe('wide')
    expect(shellBand(2559)).toBe('wide')
    expect(shellBand(2560)).toBe('ultra')
    for (const [name, px] of Object.entries(SHELL_BREAKPOINTS)) {
      expect(chrome).toContain(`--shell-bp-${name}: ${px}px;`)
    }
  })

  it('edge inset grows only at wide/ultra and matches CSS tokens', () => {
    expect(SHELL_EDGE_INSET).toEqual({ compact: 0, regular: 0, wide: 12, ultra: 24 })
    expect(shellEdgeInset('wide')).toBe(12)
    expect(shellEdgeInset('ultra')).toBe(24)
    expect(seBlock).toContain('--shell-edge-inset: 12px;')
    expect(seBlock).toContain('--shell-edge-inset: 24px;')
  })

  it('is scoped to Rox Engineering and reuses panel-gutter/measure', () => {
    expect(seBlock).toContain('html[data-ui-profile="super-engineering"]')
    expect(seBlock).toContain('--panel-gutter: calc(var(--spacing) * 10);')
    expect(seBlock).toContain('--panel-gutter: calc(var(--spacing) * 14);')
    expect(seBlock).toContain('--panel-measure: 1120px;')
    expect(seBlock).toContain('--panel-measure: 1280px;')
    expect(seBlock).toContain('--content-inset: 16px;')
    expect(seBlock).toContain('--content-inset: 28px;')
    expect(seBlock).toContain('--shell-paper-max: 1600px;')
    expect(seBlock).toContain('--shell-paper-max: 1800px;')
    expect(seBlock).toContain('[data-content-join="float"]')
    expect(seBlock).toContain('max-inline-size: min(100%, var(--shell-paper-max))')
  })

  it('is static layout: no transitions/animations on the SE ultra-wide block', () => {
    expect(seBlock.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/transition|animation|@keyframes/)
  })

  it('AppShell exposes data-shell-band from border box and applies SE edge inset via padding', () => {
    expect(appShell).toContain('data-shell-band={activeShellBand}')
    expect(hook).toContain('borderBoxSize')
    expect(appShell).toContain('useContainerBorderWidth(shellRef)')
    expect(appShell).toContain('shellBand(shellBorderWidth)')
    expect(appShell).toContain('shellEdgeInset(activeShellBand)')
    expect(appShell).toContain('seProfile && activeShellBand')
  })
})
