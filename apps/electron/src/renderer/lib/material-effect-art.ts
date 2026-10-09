/**
 * Deterministic rasterisers for the generated chat-surface effects.
 *
 * The module is DOM-free at import time: nothing here touches `window`,
 * `document` or `OffscreenCanvas` until `materialEffectDataUrl` is called, and
 * that call degrades to an empty string when no canvas implementation exists.
 * Every pixel decision is a pure function of the parameters (no `Math.random`),
 * so the same `MaterialEffectParams` always yields byte-identical output.
 */

export type MaterialEffectKind = 'gradient' | 'dither' | 'ascii' | 'halftone' | 'scanlines'

/** The effect kinds that are actually generated (everything but the plain gradient). */
type GeneratedMaterialEffectKind = Exclude<MaterialEffectKind, 'gradient'>

export interface MaterialEffectParams {
  kind: GeneratedMaterialEffectKind
  width: number
  height: number
  intensity: number
  scale?: number
  rgb: [number, number, number]
}

/** Ordered 4x4 Bayer thresholds (0..15), row-major. */
const BAYER_4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

const GENERATED_KINDS: Record<GeneratedMaterialEffectKind, true> = {
  dither: true,
  ascii: true,
  halftone: true,
  scanlines: true,
}

/**
 * 8 small 6x8 glyph bitmaps drawn as rects for the `ascii` effect. Each row is a
 * string of `#` (ink) and `.` (void); shapes are deliberately crude so the
 * effect reads as a character raster at a glance.
 */
const ASCII_GLYPHS: readonly (readonly string[])[] = [
  ['......', '.###..', '#...#.', '#...#.', '#...#.', '#...#.', '.###..', '......'],
  ['......', '.####.', '#....#', '#....#', '#....#', '#....#', '.####.', '......'],
  ['......', '..#...', '.##...', '..#...', '..#...', '..#...', '.###..', '......'],
  ['......', '.####.', '#....#', '....#.', '...#..', '..#...', '.####.', '......'],
  ['......', '####..', '#...#.', '#...#.', '####..', '#.....', '#.....', '......'],
  ['......', '.####.', '#.....', '#####.', '#....#', '#....#', '.####.', '......'],
  ['......', '#....#', '#...#.', '#..#..', '####..', '#.....', '#.....', '......'],
  ['......', '.####.', '#....#', '.####.', '#....#', '#....#', '.####.', '......'],
]

/** True for the kinds this module can rasterise; narrows `kind` at call sites. */
export function isGeneratedMaterialEffect(kind: string): kind is GeneratedMaterialEffectKind {
  return GENERATED_KINDS[kind as GeneratedMaterialEffectKind] === true
}

/** Stable cache identity; `scale` defaults to 1 so omitted and explicit 1 agree. */
export function materialEffectCacheKey(params: MaterialEffectParams): string {
  return [
    params.kind,
    `${params.width}x${params.height}`,
    params.intensity,
    params.scale ?? 1,
    params.rgb.join(','),
  ].join(':')
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Rasterise `params` into an RGBA byte array of length `width * height * 4`.
 * RGB is always the caller's colour; `intensity` shapes the pattern's coverage
 * (thresholds/radii/line density), while the layer's CSS opacity
 * (`--material-chat-effect-intensity`) is the single strength multiplier — so
 * ink alpha is baked at FULL (255) rather than scaled by `intensity` again.
 * Deterministic for a given parameter set.
 */
export function renderMaterialEffectPixels(params: MaterialEffectParams): Uint8ClampedArray {
  const width = Math.max(0, Math.floor(params.width))
  const height = Math.max(0, Math.floor(params.height))
  const out = new Uint8ClampedArray(width * height * 4)
  const intensity = clamp01(params.intensity)
  const scale = Math.max(1, Math.round(params.scale ?? 1))
  const [r, g, b] = params.rgb

  for (let i = 0; i < out.length; i += 4) {
    out[i] = r
    out[i + 1] = g
    out[i + 2] = b
    out[i + 3] = 0
  }

  const alpha = 255
  if (intensity <= 0 || width === 0 || height === 0) return out

  switch (params.kind) {
    case 'dither':
      renderDither(out, width, height, intensity, scale, alpha)
      break
    case 'scanlines':
      renderScanlines(out, width, height, scale, alpha)
      break
    case 'halftone':
      renderHalftone(out, width, height, intensity, scale, alpha)
      break
    case 'ascii':
      renderAscii(out, width, height, intensity, scale, alpha)
      break
  }

  return out
}

function setAlpha(out: Uint8ClampedArray, width: number, x: number, y: number, alpha: number): void {
  out[(y * width + x) * 4 + 3] = alpha
}

function renderDither(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  intensity: number,
  scale: number,
  alpha: number,
): void {
  const block = 2 * scale
  const threshold = intensity * 16
  for (let y = 0; y < height; y += 1) {
    const by = Math.floor(y / block) % 4
    for (let x = 0; x < width; x += 1) {
      const bx = Math.floor(x / block) % 4
      if (BAYER_4[by * 4 + bx] < threshold) setAlpha(out, width, x, y, alpha)
    }
  }
}

function renderScanlines(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
  alpha: number,
): void {
  const period = 3 * scale
  for (let y = 0; y < height; y += 1) {
    if (y % period !== 0) continue
    for (let x = 0; x < width; x += 1) setAlpha(out, width, x, y, alpha)
  }
}

function renderHalftone(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  intensity: number,
  scale: number,
  alpha: number,
): void {
  const cell = 4 * scale
  const radius = Math.sqrt((intensity * cell * cell) / Math.PI)
  for (let cy = 0; cy < height; cy += cell) {
    const centerY = cy + cell / 2
    for (let cx = 0; cx < width; cx += cell) {
      const centerX = cx + cell / 2
      const maxY = Math.min(cy + cell, height)
      const maxX = Math.min(cx + cell, width)
      for (let y = cy; y < maxY; y += 1) {
        const dy = y + 0.5 - centerY
        for (let x = cx; x < maxX; x += 1) {
          const dx = x + 0.5 - centerX
          if (Math.sqrt(dx * dx + dy * dy) <= radius) setAlpha(out, width, x, y, alpha)
        }
      }
    }
  }
}

function renderAscii(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  intensity: number,
  scale: number,
  alpha: number,
): void {
  const cellW = 6 * scale
  const cellH = 8 * scale
  for (let cy = 0; cy < height; cy += cellH) {
    const row = Math.floor(cy / cellH)
    for (let cx = 0; cx < width; cx += cellW) {
      const col = Math.floor(cx / cellW)
      const luma = 0.5 + 0.5 * Math.sin(cx * 0.031 + cy * 0.017)
      if (luma > intensity) continue
      const glyph = ASCII_GLYPHS[((col * 31 + row * 17) >>> 0) % ASCII_GLYPHS.length]
      for (let gy = 0; gy < glyph.length; gy += 1) {
        const line = glyph[gy]
        for (let gx = 0; gx < line.length; gx += 1) {
          if (line[gx] !== '#') continue
          const maxY = Math.min(cy + gy * scale + scale, height)
          const maxX = Math.min(cx + gx * scale + scale, width)
          for (let y = cy + gy * scale; y < maxY; y += 1) {
            for (let x = cx + gx * scale; x < maxX; x += 1) setAlpha(out, width, x, y, alpha)
          }
        }
      }
    }
  }
}

/**
 * Bounded LRU of generated art URLs. The key includes intensity/scale/viewport,
 * so a slider drag can mint a fresh entry per step; the cap (plus revocation of
 * evicted blob URLs) keeps the resident set sane instead of leaking one PNG per
 * change for the lifetime of the window.
 */
const DATA_URL_CACHE_MAX = 12
const dataUrlCache = new Map<string, string>()

/** Read a cached URL, refreshing its LRU position. */
function readCachedDataUrl(key: string): string | undefined {
  const cached = dataUrlCache.get(key)
  if (cached === undefined) return undefined
  dataUrlCache.delete(key)
  dataUrlCache.set(key, cached)
  return cached
}

/** Insert a URL and evict the least-recently-used entries (revoking blobs). */
function writeCachedDataUrl(key: string, url: string): void {
  dataUrlCache.delete(key)
  dataUrlCache.set(key, url)
  while (dataUrlCache.size > DATA_URL_CACHE_MAX) {
    const oldestKey = dataUrlCache.keys().next().value
    if (oldestKey === undefined) break
    const stale = dataUrlCache.get(oldestKey)
    dataUrlCache.delete(oldestKey)
    if (stale?.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(stale)
    }
  }
}

type Canvas2DContext = {
  createImageData: (w: number, h: number) => { data: Uint8ClampedArray }
  putImageData: (image: unknown, dx: number, dy: number) => void
}

/**
 * Encode the effect as a `data:`/blob URL. Prefers `OffscreenCanvas` (worker
 * friendly), falls back to an HTML canvas, and returns `''` when neither is
 * available. Successful results are memoised per `materialEffectCacheKey`.
 */
export async function materialEffectDataUrl(params: MaterialEffectParams): Promise<string> {
  const key = materialEffectCacheKey(params)
  const cached = readCachedDataUrl(key)
  if (cached) return cached

  const width = Math.max(0, Math.floor(params.width))
  const height = Math.max(0, Math.floor(params.height))
  if (width === 0 || height === 0) return ''

  const pixels = renderMaterialEffectPixels(params)
  let url = ''

  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d') as unknown as Canvas2DContext | null
      if (ctx) {
        const image = ctx.createImageData(width, height)
        image.data.set(pixels)
        ctx.putImageData(image, 0, 0)
        const blob = await canvas.convertToBlob()
        if (blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          url = URL.createObjectURL(blob)
        }
      }
    }
  } catch {
    url = ''
  }

  if (!url && typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d') as unknown as Canvas2DContext | null
      if (ctx) {
        const image = ctx.createImageData(width, height)
        image.data.set(pixels)
        ctx.putImageData(image, 0, 0)
        url = canvas.toDataURL('image/png')
      }
    } catch {
      url = ''
    }
  }

  if (url) writeCachedDataUrl(key, url)
  return url
}