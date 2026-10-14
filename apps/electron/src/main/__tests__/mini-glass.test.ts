import { describe, expect, it } from 'bun:test'
import { resolveMiniGlassOrigin, MINI_GLASS_COLLAPSED } from '../mini-glass-geometry'

const primary = { x: 0, y: 0, width: 1440, height: 875 }

describe('resolveMiniGlassOrigin', () => {
  it('defaults to the bottom-right of the primary work area', () => {
    expect(resolveMiniGlassOrigin(null, MINI_GLASS_COLLAPSED, [primary], primary)).toEqual({
      x: 1440 - MINI_GLASS_COLLAPSED.width - 24,
      y: 875 - MINI_GLASS_COLLAPSED.height - 24,
    })
  })

  it('keeps a remembered position that is still on a display', () => {
    const second = { x: 1440, y: 0, width: 1920, height: 1080 }
    expect(resolveMiniGlassOrigin({ x: 2000, y: 300 }, MINI_GLASS_COLLAPSED, [primary, second], primary)).toEqual({ x: 2000, y: 300 })
  })

  it('drops a remembered position whose display is gone', () => {
    const origin = resolveMiniGlassOrigin({ x: 3000, y: 300 }, MINI_GLASS_COLLAPSED, [primary], primary)
    expect(origin.x).toBeLessThan(1440)
  })
})
