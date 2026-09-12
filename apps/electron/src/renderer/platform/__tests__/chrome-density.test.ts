import { describe, expect, it } from 'bun:test'
import { CHROME_DENSITY } from '../chrome-density'

describe('CHROME_DENSITY', () => {
  it('keeps a compact desktop chrome scale under prior defaults', () => {
    expect(CHROME_DENSITY.topbarHeight).toBeLessThan(48)
    expect(CHROME_DENSITY.railWidth).toBeLessThanOrEqual(48)
    expect(CHROME_DENSITY.tabStripHeight).toBeLessThan(42)
    expect(CHROME_DENSITY.statusBarHeight).toBeLessThan(28)
    expect(CHROME_DENSITY.panelGap).toBeLessThan(6)
    expect(CHROME_DENSITY.panelEdgeInset).toBeLessThan(6)
  })

  it('keeps control targets usable (>= 24px)', () => {
    expect(CHROME_DENSITY.control).toBeGreaterThanOrEqual(24)
    expect(CHROME_DENSITY.controlLg).toBeGreaterThanOrEqual(CHROME_DENSITY.control)
  })
})
