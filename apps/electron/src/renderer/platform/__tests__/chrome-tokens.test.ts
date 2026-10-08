import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHROME_TOKENS_TS,
  parseChromeBlock,
  readChromeTokens,
  renderChromeTokens,
} from '../../../../../../scripts/generate-chrome-tokens'
import { CHROME_DENSITY } from '../chrome-density'
import { CHROME_TOKENS, CHROME_TOKENS_COMFORTABLE } from '../chrome-tokens'
import * as panel from '../../components/app-shell/panel-constants'

const platformDir = join(import.meta.dir, '..')
const densitySrc = readFileSync(join(platformDir, 'chrome-density.ts'), 'utf8')
const panelSrc = readFileSync(join(platformDir, '..', 'components', 'app-shell', 'panel-constants.ts'), 'utf8')

describe('chrome tokens (UI-A1: one source of truth for chrome numbers)', () => {
  it('chrome-tokens.ts is generated from tokens/chrome.css and up to date', () => {
    expect(readFileSync(CHROME_TOKENS_TS, 'utf8')).toBe(renderChromeTokens())
  })

  it('CHROME_DENSITY reads every number from the generated tokens', () => {
    expect(CHROME_DENSITY).toEqual({
      topbarHeight: CHROME_TOKENS.chromeTopbarHeight,
      railWidth: CHROME_TOKENS.chromeRailWidth,
      railExpandedWidth: CHROME_TOKENS.chromeRailExpandedWidth,
      control: CHROME_TOKENS.chromeControl,
      controlLg: CHROME_TOKENS.chromeControlLg,
      tabStripHeight: CHROME_TOKENS.chromeTabStripHeight,
      statusBarHeight: CHROME_TOKENS.chromeStatusHeight,
      panelHeaderHeight: CHROME_TOKENS.chromePanelHeaderHeight,
      panelGap: CHROME_TOKENS.panelGap,
      panelEdgeInset: CHROME_TOKENS.panelEdgeInset,
    })
    // No literal numbers left in the hand-written modules.
    expect(densitySrc).not.toMatch(/:\s*-?\d+(\.\d+)?\s*,/)
    expect(panelSrc).not.toMatch(/export const [A-Z_]+ = -?\d/)
  })

  it('panel constants are the chrome token values', () => {
    expect(panel.PANEL_GAP).toBe(CHROME_TOKENS.panelGap)
    expect(panel.PANEL_EDGE_INSET).toBe(CHROME_TOKENS.panelEdgeInset)
    expect(panel.PANEL_MIN_WIDTH).toBe(CHROME_TOKENS.panelMinWidth)
    expect(panel.PANEL_GRID_MIN_WIDTH).toBe(CHROME_TOKENS.panelGridMinWidth)
    expect(panel.PANEL_GRID_MIN_HEIGHT).toBe(CHROME_TOKENS.panelGridMinHeight)
    expect(panel.CENTER_MIN_WIDTH).toBe(CHROME_TOKENS.centerMinWidth)
    expect(panel.PANEL_STACK_VERTICAL_OVERFLOW).toBe(CHROME_TOKENS.panelStackVerticalOverflow)
    expect(panel.PANEL_STACK_TOP_INSET).toBe(CHROME_TOKENS.panelStackTopInset)
    expect(panel.PANEL_STACK_BOTTOM_INSET).toBe(CHROME_TOKENS.panelStackBottomInset)
    expect(panel.PANEL_SASH_HIT_WIDTH).toBe(CHROME_TOKENS.panelSashHitWidth)
    expect(panel.PANEL_SASH_HIT_WIDTH_COARSE).toBe(CHROME_TOKENS.panelSashHitWidthCoarse)
    expect(panel.PANEL_SASH_LINE_WIDTH).toBe(CHROME_TOKENS.panelSashLineWidth)
    expect(panel.PANEL_SASH_HALF_HIT_WIDTH).toBe(CHROME_TOKENS.panelSashHitWidth / 2)
  })

  it('the JS gap/inset agree with the pane constants (no divergent copies)', () => {
    expect(CHROME_DENSITY.panelGap).toBe(panel.PANEL_GAP)
    expect(CHROME_DENSITY.panelEdgeInset).toBe(panel.PANEL_EDGE_INSET)
  })

  it('comfortable density only grows sizes and keeps every compact key', () => {
    expect(Object.keys(CHROME_TOKENS_COMFORTABLE).sort()).toEqual(Object.keys(CHROME_TOKENS).sort())
    for (const key of Object.keys(CHROME_TOKENS) as (keyof typeof CHROME_TOKENS)[]) {
      expect(CHROME_TOKENS_COMFORTABLE[key]).toBeGreaterThanOrEqual(CHROME_TOKENS[key])
    }
  })

  it('comfortable var() aliases resolve against the comfortable values (cascade order)', () => {
    // --chrome-control: var(--control-sm) is declared on :root; on <html
    // data-density="comfortable"> the browser resolves it with the overridden
    // --control-sm, so the generated numbers must do the same.
    expect(CHROME_TOKENS.chromeControl).toBe(CHROME_TOKENS.controlSm)
    expect(CHROME_TOKENS.chromeControlLg).toBe(CHROME_TOKENS.controlMd)
    expect(CHROME_TOKENS_COMFORTABLE.chromeControl).toBe(CHROME_TOKENS_COMFORTABLE.controlSm)
    expect(CHROME_TOKENS_COMFORTABLE.chromeControlLg).toBe(CHROME_TOKENS_COMFORTABLE.controlMd)
    expect(CHROME_TOKENS_COMFORTABLE.chromeControl).toBe(28)
    expect(CHROME_TOKENS_COMFORTABLE.chromeControlLg).toBe(32)

    const css = ':root { --a: 4px; --b: var(--a); --c: var(--b); } html[data-density="comfortable"] { --a: 8px; }'
    expect(readChromeTokens(css)).toEqual({
      compact: { a: 4, b: 4, c: 4 },
      comfortable: { a: 8, b: 8, c: 8 },
    })
  })

  it('compact sizes follow the 4px grid where the spec defines them', () => {
    for (const key of ['controlSm', 'controlMd', 'controlLg', 'railButton', 'rowH', 'rowH2line', 'chromeTopbarHeight'] as const) {
      expect(CHROME_TOKENS[key] % 4).toBe(0)
    }
  })

  it('the generator rejects values it cannot represent as px numbers', () => {
    expect(() => parseChromeBlock('--a: 1rem;')).toThrow()
    expect(() => parseChromeBlock('--a: var(--missing);')).toThrow()
    expect(parseChromeBlock('--a: 4px; --b: var(--a);')).toEqual({ a: 4, b: 4 })
    expect(() => readChromeTokens(':root { --a: 4px; } html[data-density="comfortable"] { --b: 8px; }')).toThrow()
    expect(() => parseChromeBlock('--a: var(--b); --b: var(--a);')).toThrow()
  })
})
