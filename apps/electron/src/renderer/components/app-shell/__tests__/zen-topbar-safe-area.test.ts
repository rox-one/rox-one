import { describe, expect, it } from 'bun:test'
import { zenTopBarSafeLeftPx } from '../zen-topbar-safe-area'

describe('zenTopBarSafeLeftPx (ZS-03)', () => {
  it('does not reserve traffic-light space on webui or non-mac', () => {
    expect(zenTopBarSafeLeftPx({ isMac: true, isWebUI: true, zoomPercent: 100, isFullScreen: false })).toBe(8)
    expect(zenTopBarSafeLeftPx({ isMac: false, isWebUI: false, zoomPercent: 150, isFullScreen: false })).toBe(8)
  })

  it('scales the macOS desktop inset at 100/125/150% zoom', () => {
    expect(zenTopBarSafeLeftPx({ isMac: true, isWebUI: false, zoomPercent: 100, isFullScreen: false })).toBe(82)
    expect(zenTopBarSafeLeftPx({ isMac: true, isWebUI: false, zoomPercent: 125, isFullScreen: false })).toBe(103)
    expect(zenTopBarSafeLeftPx({ isMac: true, isWebUI: false, zoomPercent: 150, isFullScreen: false })).toBe(123)
  })

  it('drops the stoplight inset in fullscreen', () => {
    expect(zenTopBarSafeLeftPx({ isMac: true, isWebUI: false, zoomPercent: 150, isFullScreen: true })).toBe(8)
  })
})
