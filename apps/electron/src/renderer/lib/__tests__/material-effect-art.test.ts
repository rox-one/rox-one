import { describe, expect, it } from 'bun:test'
import {
  isGeneratedMaterialEffect,
  materialEffectCacheKey,
  renderMaterialEffectPixels,
  type MaterialEffectKind,
  type MaterialEffectParams,
} from '../material-effect-art'

type GeneratedMaterialEffectKind = Exclude<MaterialEffectKind, 'gradient'>

const GENERATED_KINDS: readonly GeneratedMaterialEffectKind[] = ['dither', 'ascii', 'halftone', 'scanlines']
const RGB: [number, number, number] = [200, 120, 40]
const WIDTH = 24
const HEIGHT = 24

function effect(kind: GeneratedMaterialEffectKind, overrides: Partial<MaterialEffectParams> = {}): MaterialEffectParams {
  return { kind, width: WIDTH, height: HEIGHT, intensity: 1, rgb: RGB, ...overrides }
}

function alphaAt(pixels: Uint8ClampedArray, x: number, y: number, width = WIDTH): number {
  return pixels[(y * width + x) * 4 + 3]
}

function alphaSum(pixels: Uint8ClampedArray): number {
  let sum = 0
  for (let i = 3; i < pixels.length; i += 4) sum += pixels[i]
  return sum
}

describe('isGeneratedMaterialEffect', () => {
  it('accepts every generated kind and rejects gradient and unknown kinds', () => {
    for (const kind of GENERATED_KINDS) expect(isGeneratedMaterialEffect(kind)).toBe(true)
    expect(isGeneratedMaterialEffect('gradient')).toBe(false)
    expect(isGeneratedMaterialEffect('noise')).toBe(false)
    expect(isGeneratedMaterialEffect('toString')).toBe(false)
    expect(isGeneratedMaterialEffect('')).toBe(false)
  })
})

describe('renderMaterialEffectPixels', () => {
  it('allocates RGBA of width * height * 4 with the caller colour on every pixel', () => {
    for (const kind of GENERATED_KINDS) {
      const pixels = renderMaterialEffectPixels(effect(kind))
      expect(pixels.length).toBe(WIDTH * HEIGHT * 4)
      for (let i = 0; i < pixels.length; i += 4) {
        expect(pixels[i]).toBe(RGB[0])
        expect(pixels[i + 1]).toBe(RGB[1])
        expect(pixels[i + 2]).toBe(RGB[2])
      }
    }
  })

  it('is deterministic across repeated calls', () => {
    for (const kind of GENERATED_KINDS) {
      const params = effect(kind, { intensity: 0.6, scale: 2 })
      expect(renderMaterialEffectPixels(params)).toEqual(renderMaterialEffectPixels(params))
    }
  })

  it('yields zero alpha everywhere at intensity 0', () => {
    for (const kind of GENERATED_KINDS) {
      const pixels = renderMaterialEffectPixels(effect(kind, { intensity: 0 }))
      expect(alphaSum(pixels)).toBe(0)
    }
  })

  it('returns an empty buffer for empty dimensions', () => {
    expect(renderMaterialEffectPixels(effect('dither', { width: 0, height: 0 })).length).toBe(0)
  })

  it('paints every third scanline row at intensity 1', () => {
    const pixels = renderMaterialEffectPixels(effect('scanlines'))
    expect(alphaAt(pixels, 5, 0)).toBe(255)
    expect(alphaAt(pixels, 5, 1)).toBe(0)
    expect(alphaAt(pixels, 5, 2)).toBe(0)
    expect(alphaAt(pixels, 5, 3)).toBe(255)
    expect(alphaAt(pixels, 5, 6)).toBe(255)
  })

  it('raises halftone coverage monotonically with intensity', () => {
    const low = alphaSum(renderMaterialEffectPixels(effect('halftone', { intensity: 0.25 })))
    const mid = alphaSum(renderMaterialEffectPixels(effect('halftone', { intensity: 0.5 })))
    const high = alphaSum(renderMaterialEffectPixels(effect('halftone', { intensity: 1 })))
    expect(low).toBeGreaterThan(0)
    expect(mid).toBeGreaterThan(low)
    expect(high).toBeGreaterThan(mid)
  })

  it('renders ascii ink at full intensity with bounded alpha', () => {
    const pixels = renderMaterialEffectPixels(effect('ascii'))
    expect(alphaSum(pixels)).toBeGreaterThan(0)
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBeLessThanOrEqual(255)
  })
})

describe('materialEffectCacheKey', () => {
  it('treats an omitted scale as 1 and distinguishes intensity and kind', () => {
    expect(materialEffectCacheKey(effect('dither'))).toBe(materialEffectCacheKey(effect('dither', { scale: 1 })))
    expect(materialEffectCacheKey(effect('dither'))).not.toBe(materialEffectCacheKey(effect('dither', { scale: 2 })))
    expect(materialEffectCacheKey(effect('dither'))).not.toBe(materialEffectCacheKey(effect('dither', { intensity: 0.5 })))
    expect(materialEffectCacheKey(effect('dither'))).not.toBe(materialEffectCacheKey(effect('ascii')))
  })
})