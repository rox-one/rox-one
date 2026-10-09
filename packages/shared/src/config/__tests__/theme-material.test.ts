import { describe, expect, it } from 'bun:test'
import {
  MATERIAL_DEFAULTS,
  ZED_BLURRED_MATERIAL,
  effectiveMaterialSettings,
  mergeMaterialSettings,
  mergeThemeOverrides,
  resolveMaterial,
  themeToCSS,
  type MaterialSettings,
  type ThemeOverrides,
} from '../theme'
import { MaterialSurfaceHintsSchema, PresetThemeSchema, ThemeOverrideSchema } from '../validators'

describe('material settings schema', () => {
  it('accepts a full material block in overrides and presets', () => {
    const material = {
      enabled: true,
      blur: { topbar: 24, rail: 0, chat: 64 },
      opacity: { topbar: 0.8, sidebar: 0.5 },
      tint: { hue: 12, saturation: -20, lightness: 4 },
      texture: { kind: 'grain', intensity: 0.2, scale: 1.5 },
      haze: { enabled: true, intensity: 0.3 },
      matte: 0.4,
      deepGlass: { content: true, lists: false },
      chatEffect: { kind: 'scanlines', intensity: 0.6 },
    }
    expect(ThemeOverrideSchema.safeParse({ material }).success).toBe(true)
    expect(PresetThemeSchema.safeParse({ name: 'Glass', background: '#101010', material }).success).toBe(true)
  })

  it('rejects unknown surfaces, unknown keys and out-of-range values', () => {
    expect(ThemeOverrideSchema.safeParse({ material: { blur: { wallpaper: 10 } } }).success).toBe(false)
    expect(ThemeOverrideSchema.safeParse({ material: { blur: { topbar: 80 } } }).success).toBe(false)
    expect(ThemeOverrideSchema.safeParse({ material: { opacity: { chat: 1.5 } } }).success).toBe(false)
    expect(ThemeOverrideSchema.safeParse({ material: { texture: { kind: 'noise' } } }).success).toBe(false)
    expect(ThemeOverrideSchema.safeParse({ material: { chatEffect: { kind: 'dither', extra: 1 } } }).success).toBe(false)
  })

  it('keeps presets without material valid (backward compatibility)', () => {
    expect(PresetThemeSchema.safeParse({ name: 'Plain', background: '#ffffff' }).success).toBe(true)
  })
})

describe('material merge and resolution', () => {
  it('deep-merges material sub-objects and keeps untouched surfaces', () => {
    const base: MaterialSettings = { enabled: true, blur: { topbar: 24, rail: 10 }, opacity: { chat: 0.4 }, tint: { hue: 10 } }
    const merged = mergeMaterialSettings(base, { blur: { rail: 32 }, tint: { saturation: 5 } })
    expect(merged?.blur).toEqual({ topbar: 24, rail: 32 })
    expect(merged?.opacity).toEqual({ chat: 0.4 })
    expect(merged?.tint).toEqual({ hue: 10, saturation: 5 })
  })

  it('merges material through mergeThemeOverrides', () => {
    const base: ThemeOverrides = { material: { enabled: true, blur: { topbar: 24 } } }
    const merged = mergeThemeOverrides(base, { material: { opacity: { topbar: 0.5 } } })
    expect(merged.material).toEqual({ enabled: true, blur: { topbar: 24 }, opacity: { topbar: 0.5 } })
  })

  it('forces solid under reduce-transparency and high contrast', () => {
    const material: MaterialSettings = { enabled: true }
    const reduced = resolveMaterial(material, { reduceTransparency: true })
    expect(reduced.enabled).toBe(false)
    expect(reduced.disabledReason).toBe('reduce-transparency')
    expect(resolveMaterial(material, { highContrast: true }).enabled).toBe(false)
    const off = resolveMaterial(undefined)
    expect(off.enabled).toBe(false)
    expect(off.disabledReason).toBe('off')
  })

  it('keeps the tint but zeroes blur on the performance profile', () => {
    const resolved = resolveMaterial({ enabled: true, tint: { hue: 5 } }, { renderProfile: 'performance' })
    expect(resolved.enabled).toBe(true)
    expect(resolved.blur.topbar).toBe(0)
    expect(resolved.blur.popover).toBe(0)
    expect(resolved.tint).toEqual({ hue: 5 })
  })

  it('clamps defensive values beyond the schema ranges', () => {
    const resolved = resolveMaterial({ enabled: true, blur: { topbar: 999 }, opacity: { chat: -1 }, matte: 3 })
    expect(resolved.blur.topbar).toBe(64)
    expect(resolved.opacity.chat).toBe(0)
    expect(resolved.matte).toBe(1)
  })
})

describe('material CSS emission', () => {
  it('emits nothing when the layer is absent or disabled', () => {
    expect(themeToCSS({})).not.toContain('--material-')
    expect(themeToCSS({ material: { enabled: false, blur: { topbar: 10 } } })).not.toContain('--material-')
  })

  it('emits per-surface defaults and overrides when enabled', () => {
    const css = themeToCSS({ material: { enabled: true, blur: { topbar: 30 }, opacity: { chat: 0.25 } } })
    expect(css).toContain('--material-blur-topbar: 30px;')
    expect(css).toContain(`--material-blur-rail: ${MATERIAL_DEFAULTS.blur.rail}px;`)
    expect(css).toContain('--material-opacity-chat: 25%;')
    expect(css).toContain('--material-opacity-topbar: 84%;')
  })

  it('emits texture, haze, matte and chat effect variables only when active', () => {
    const css = themeToCSS({
      material: {
        enabled: true,
        texture: { kind: 'grain', intensity: 0.2 },
        haze: { enabled: true, intensity: 0.4 },
        matte: 0.3,
        chatEffect: { kind: 'dither' },
      },
    })
    expect(css).toContain('--material-texture-kind: grain;')
    expect(css).toContain('--material-texture-intensity: 0.2;')
    expect(css).toContain('--material-haze-intensity: 0.4;')
    expect(css).toContain('--material-matte: 0.3;')
    expect(css).toContain('--material-chat-effect: dither;')
    const plain = themeToCSS({ material: { enabled: true } })
    expect(plain).not.toContain('--material-texture-kind')
    expect(plain).not.toContain('--material-haze-intensity')
    expect(plain).not.toContain('--material-chat-effect:')
  })

  it('clamps out-of-range raw values on emission', () => {
    const css = themeToCSS({
      material: { enabled: true, blur: { topbar: 999 }, opacity: { chat: 5 }, matte: 7, tint: { hue: 400 } },
    })
    expect(css).toContain('--material-blur-topbar: 64px;')
    expect(css).toContain('--material-opacity-chat: 100%;')
    expect(css).toContain('--material-matte: 1;')
    expect(css).toContain('--material-tint-hue: 180;')
  })
})

describe('blurred auto-glass', () => {
  it('activates the Zed-parity profile for a blurred theme with no override', () => {
    const effective = effectiveMaterialSettings(undefined, { mode: 'blurred' })
    expect(effective?.enabled).toBe(true)
    expect(effective?.opacity).toEqual(ZED_BLURRED_MATERIAL.opacity)
    // Solid themes without an override stay inert.
    expect(effectiveMaterialSettings(undefined, { mode: 'solid' })).toBeUndefined()
    expect(effectiveMaterialSettings(undefined)).toBeUndefined()
  })

  it('never overrides an explicit enabled decision (user override wins)', () => {
    const off = effectiveMaterialSettings({ enabled: false }, { mode: 'blurred' })
    expect(off?.enabled).toBe(false)
    const on = effectiveMaterialSettings({ enabled: true, opacity: { topbar: 0.4 } }, { mode: 'blurred' })
    expect(on?.enabled).toBe(true)
    expect(on?.opacity).toEqual({ topbar: 0.4 })
  })

  it('lets preset surface hints refine the profile and merges user fields on top', () => {
    const effective = effectiveMaterialSettings({ blur: { topbar: 4 } }, {
      mode: 'blurred',
      surfaces: { navigatorOpacity: 0.7, topbarOpacity: 0.6 },
    })
    expect(effective?.enabled).toBe(true)
    expect(effective?.opacity?.navigator).toBe(0.7)
    expect(effective?.opacity?.topbar).toBe(0.6)
    // Untouched surfaces keep the profile value; user blur merges in.
    expect(effective?.opacity?.chat).toBe(ZED_BLURRED_MATERIAL.opacity?.chat)
    expect(effective?.blur).toEqual({ topbar: 4 })
  })

  it('resolves and emits the profile through resolveMaterial/themeToCSS', () => {
    const resolved = resolveMaterial(undefined, { mode: 'blurred' })
    expect(resolved.enabled).toBe(true)
    expect(resolved.opacity.topbar).toBe(ZED_BLURRED_MATERIAL.opacity!.topbar!)
    const css = themeToCSS({ mode: 'blurred' })
    expect(css).toContain('--theme-mode: blurred;')
    expect(css).toContain(`--material-opacity-topbar: ${Math.round(ZED_BLURRED_MATERIAL.opacity!.topbar! * 1000) / 10}%;`)
    // Solid themes still emit nothing material.
    expect(themeToCSS({ mode: 'solid' })).not.toContain('--material-')
  })

  it('keeps a11y gates authoritative over auto-activation', () => {
    expect(resolveMaterial(undefined, { mode: 'blurred', reduceTransparency: true }).enabled).toBe(false)
    expect(resolveMaterial(undefined, { mode: 'blurred', reduceTransparency: true }).disabledReason).toBe('reduce-transparency')
    expect(resolveMaterial(undefined, { mode: 'blurred', highContrast: true }).enabled).toBe(false)
    // Settings are retained for when the gate lifts.
    expect(resolveMaterial(undefined, { mode: 'blurred', highContrast: true }).opacity.topbar)
      .toBe(ZED_BLURRED_MATERIAL.opacity!.topbar!)
  })
})

describe('material surface hints + haze overlay', () => {
  it('validates strict, clamped surface hints in presets and overrides', () => {
    const hint = { navigatorOpacity: 0.7, topbarOpacity: 0.6 }
    expect(MaterialSurfaceHintsSchema.safeParse(hint).success).toBe(true)
    expect(PresetThemeSchema.safeParse({ name: 'Blur', background: '#000', surfaces: hint }).success).toBe(true)
    expect(ThemeOverrideSchema.safeParse({ surfaces: hint }).success).toBe(true)
    // Unknown keys, unknown surfaces and out-of-range values are rejected.
    expect(MaterialSurfaceHintsSchema.safeParse({ navigatorOpacity: 1.4 }).success).toBe(false)
    expect(MaterialSurfaceHintsSchema.safeParse({ wallpaperOpacity: 0.5 }).success).toBe(false)
    expect(PresetThemeSchema.safeParse({ name: 'Blur', background: '#000', surfaces: { extraOpacity: 1 } }).success).toBe(false)
  })

  it('merges surface hints through mergeThemeOverrides (override wins per key)', () => {
    const merged = mergeThemeOverrides(
      { surfaces: { navigatorOpacity: 0.7, topbarOpacity: 0.6 } },
      { surfaces: { navigatorOpacity: 0.8 } },
    )
    expect(merged.surfaces).toEqual({ navigatorOpacity: 0.8, topbarOpacity: 0.6 })
  })

  it('validates and emits the haze overlay pair', () => {
    const material = { enabled: true, haze: { enabled: true, overlay: true, emptyOpacity: 0.24, activeOpacity: 0.5 } }
    expect(ThemeOverrideSchema.safeParse({ material }).success).toBe(true)
    expect(ThemeOverrideSchema.safeParse({ material: { haze: { overlay: true, emptyOpacity: 2 } } }).success).toBe(false)
    expect(ThemeOverrideSchema.safeParse({ material: { haze: { overlay: 'yes' } } }).success).toBe(false)
    const css = themeToCSS({ material })
    expect(css).toContain('--material-haze-overlay-empty: 0.24;')
    expect(css).toContain('--material-haze-overlay-active: 0.5;')
    // The pair is omitted when the overlay is off.
    expect(themeToCSS({ material: { enabled: true, haze: { enabled: true } } })).not.toContain('--material-haze-overlay-')
  })
})