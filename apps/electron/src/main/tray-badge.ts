/**
 * Menu-bar badge rasterizer — pure, Electron-free.
 *
 * macOS menu-bar apps show unread counts as a small red pill with a white
 * number composited onto the status icon (bottom-right, slightly overhanging).
 * Electron's main process has no canvas, so the pill, its soft shadow and the
 * digits are rasterized here into a premultiplied 32-bit bitmap that the tray
 * turns into a `nativeImage` (one representation per scale factor → Retina).
 *
 * Everything works in premultiplied alpha, which is what `toBitmap()` returns
 * and `createFromBitmap()` expects. Channel order is a parameter because the
 * native order is BGRA on macOS while tests read RGBA.
 */

export type ChannelOrder = 'rgba' | 'bgra'

export interface Bitmap {
  readonly width: number
  readonly height: number
  /** Premultiplied 8-bit pixels, 4 bytes per pixel. */
  readonly data: Uint8Array
}

/** Icon box in points; the menu bar is 22pt tall and status icons are 16–18pt. */
export const TRAY_ICON_POINTS = 18
/** Badge pill height in points. */
export const BADGE_HEIGHT_POINTS = 10
/** How far the pill sticks out past the icon's right edge, in points. */
const BADGE_OVERHANG_POINTS = 2
/** Horizontal padding inside the pill around the text, in points. */
const BADGE_PAD_POINTS = 2
/** Transparent ring cut into the icon around the pill, in points. */
const KNOCKOUT_POINTS = 1
/** Shadow: drop offset and blur radius, in points. */
const SHADOW_OFFSET_POINTS = 0.75
const SHADOW_BLUR_POINTS = 1.25
const SHADOW_ALPHA = 0.4

/** System red (#FF3B30) — the same red macOS uses for badges. */
export const BADGE_RED: readonly [number, number, number] = [0xff, 0x3b, 0x30]

/**
 * Label for a count: hidden at 0 (and for anything that is not a positive
 * finite number), the number itself up to 99, then "99+".
 */
export function badgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null
  const n = Math.floor(count)
  return n > 99 ? '99+' : String(n)
}

/** 5×7 bitmap glyphs; '1' marks an ink cell. */
const GLYPHS: Record<string, readonly string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
}
const GLYPH_W = 5
const GLYPH_H = 7
const GLYPH_GAP = 1

/** Width of a label in glyph cells (before scaling). */
export function labelCells(label: string): number {
  return label.length * GLYPH_W + Math.max(0, label.length - 1) * GLYPH_GAP
}

export interface BadgeLayout {
  /** Canvas size in pixels. */
  readonly width: number
  readonly height: number
  /** Where the icon is drawn (pixels). */
  readonly iconSize: number
  /** Pill rectangle (pixels). */
  readonly pill: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  /** Pixel size of one glyph cell. */
  readonly cell: number
}

/**
 * Fixed canvas (pixels) shared by the plain and the badged icon, so the menu-bar
 * item never changes size or shifts when the badge appears or its label grows.
 */
export function badgeCanvas(scale: number): { readonly width: number; readonly height: number; readonly iconSize: number; readonly shadowPad: number } {
  const s = Math.max(1, Math.round(scale))
  const iconSize = TRAY_ICON_POINTS * s
  const shadowPad = Math.ceil((SHADOW_OFFSET_POINTS + SHADOW_BLUR_POINTS) * s)
  return { width: iconSize + BADGE_OVERHANG_POINTS * s + shadowPad, height: iconSize + shadowPad, iconSize, shadowPad }
}

/** Integer-pixel layout for a label at a scale factor (1 = non-Retina, 2 = Retina). */
export function layoutBadge(label: string, scale: number): BadgeLayout {
  const s = Math.max(1, Math.round(scale))
  const { width, height, iconSize } = badgeCanvas(s)
  const h = BADGE_HEIGHT_POINTS * s
  // At 1× the 7-row glyph fills a 10px pill; at 2× each cell is 2px.
  const cell = s
  const textW = labelCells(label) * cell
  const w = Math.max(h, textW + 2 * BADGE_PAD_POINTS * s)
  const x = Math.max(0, iconSize + BADGE_OVERHANG_POINTS * s - w)
  const y = iconSize - h
  return { width, height, iconSize, pill: { x, y, w, h }, cell }
}

/** The icon placed top-left on the fixed badge canvas, with no badge. */
export function padIcon(icon: Bitmap, scale: number): Bitmap {
  const { width, height, iconSize } = badgeCanvas(scale)
  const out = new Uint8Array(width * height * 4)
  const iw = Math.min(icon.width, iconSize)
  const ih = Math.min(icon.height, iconSize)
  for (let y = 0; y < ih; y++) {
    out.set(icon.data.subarray(y * icon.width * 4, (y * icon.width + iw) * 4), y * width * 4)
  }
  return { width, height, data: out }
}

/** Signed distance from a pixel centre to a horizontal capsule (negative inside). */
function capsuleDistance(px: number, py: number, x: number, y: number, w: number, h: number): number {
  const r = h / 2
  const cy = y + r
  const x0 = x + r
  const x1 = x + w - r
  const nx = px < x0 ? x0 : px > x1 ? x1 : px
  return Math.hypot(px - nx, py - cy) - r
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Premultiplied source-over of a solid colour with coverage `a` onto pixel `i`. */
function over(out: Uint8Array, i: number, order: ChannelOrder, rgb: readonly [number, number, number], a: number): void {
  if (a <= 0) return
  const [r, g, b] = rgb
  const inv = 1 - a
  const ri = order === 'rgba' ? 0 : 2
  const bi = order === 'rgba' ? 2 : 0
  out[i + ri] = Math.round(r * a + out[i + ri]! * inv)
  out[i + 1] = Math.round(g * a + out[i + 1]! * inv)
  out[i + bi] = Math.round(b * a + out[i + bi]! * inv)
  out[i + 3] = Math.round(255 * a + out[i + 3]! * inv)
}

/**
 * Composite a red count badge onto an icon bitmap.
 *
 * `icon` must be `iconSize × iconSize` for the scale (see `layoutBadge`) and
 * premultiplied in `order`. When the count is hidden the icon is only padded
 * onto the same fixed canvas (see `badgeCanvas`).
 */
export function compositeBadge(icon: Bitmap, count: number, scale: number, order: ChannelOrder = 'bgra'): Bitmap {
  const label = badgeLabel(count)
  if (!label) return padIcon(icon, scale)
  const layout = layoutBadge(label, scale)
  const { width, height, pill, cell, iconSize } = layout
  const s = Math.max(1, Math.round(scale))
  const out = new Uint8Array(width * height * 4)

  // 1. Icon, with a transparent ring knocked out around the pill so the badge
  //    reads on any icon and any menu-bar colour.
  const iw = Math.min(icon.width, iconSize)
  const ih = Math.min(icon.height, iconSize)
  const knock = KNOCKOUT_POINTS * s
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const src = (y * icon.width + x) * 4
      const dst = (y * width + x) * 4
      const d = capsuleDistance(x + 0.5, y + 0.5, pill.x, pill.y, pill.w, pill.h)
      const keep = clamp01(d - knock + 0.5)
      for (let c = 0; c < 4; c++) out[dst + c] = Math.round(icon.data[src + c]! * keep)
    }
  }

  // 2. Soft drop shadow, 3. red pill (anti-aliased edge).
  const off = SHADOW_OFFSET_POINTS * s
  const blur = SHADOW_BLUR_POINTS * s
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const ds = capsuleDistance(x + 0.5, y + 0.5 - off, pill.x, pill.y, pill.w, pill.h)
      const shadow = SHADOW_ALPHA * clamp01(1 - (ds + 0.5) / blur)
      over(out, i, order, [0, 0, 0], shadow)
      const d = capsuleDistance(x + 0.5, y + 0.5, pill.x, pill.y, pill.w, pill.h)
      over(out, i, order, BADGE_RED, clamp01(0.5 - d))
    }
  }

  // 4. White digits, centred in the pill.
  const textW = labelCells(label) * cell
  const textH = GLYPH_H * cell
  const tx = pill.x + Math.round((pill.w - textW) / 2)
  const ty = pill.y + Math.round((pill.h - textH) / 2)
  let gx = tx
  for (const ch of label) {
    const rows = GLYPHS[ch]
    if (rows) {
      for (let row = 0; row < GLYPH_H; row++) {
        for (let col = 0; col < GLYPH_W; col++) {
          if (rows[row]![col] !== '1') continue
          for (let dy = 0; dy < cell; dy++) {
            for (let dx = 0; dx < cell; dx++) {
              const x = gx + col * cell + dx
              const y = ty + row * cell + dy
              if (x < 0 || y < 0 || x >= width || y >= height) continue
              over(out, (y * width + x) * 4, order, [255, 255, 255], 1)
            }
          }
        }
      }
    }
    gx += (GLYPH_W + GLYPH_GAP) * cell
  }

  return { width, height, data: out }
}

/** Size of the recording indicator image, in points. */
export const RECORDING_DOT_POINTS = 16

/** A solid red dot (8pt) centred in a 16pt square — the recording tray item. */
export function renderRecordingDot(scale: number, order: ChannelOrder = 'bgra'): Bitmap {
  const s = Math.max(1, Math.round(scale))
  const size = RECORDING_DOT_POINTS * s
  const out = new Uint8Array(size * size * 4)
  const c = size / 2
  const r = 4 * s
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) - r
      over(out, (y * size + x) * 4, order, BADGE_RED, clamp01(0.5 - d))
    }
  }
  return { width: size, height: size, data: out }
}

/** "m:ss" under an hour, "h:mm:ss" after. Negative/NaN reads as 0:00. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
