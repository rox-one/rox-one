import { describe, expect, it } from 'bun:test'
import { MATERIAL_DEFAULTS, MATERIAL_CHAT_EFFECT_KINDS, MATERIAL_TEXTURE_KINDS, type MaterialSettings } from '@rox/shared/config'
import {
  MATERIAL_CHAT_EFFECT_LABELS,
  MATERIAL_CONTENT_PANE_ROWS,
  MATERIAL_PRESETS,
  MATERIAL_SURFACE_ROWS,
  MATERIAL_TEXTURE_LABELS,
  effectiveBlur,
  effectiveChatEffect,
  effectiveDeepGlass,
  effectiveHaze,
  effectiveMattePercent,
  effectiveOpacityPercent,
  effectiveTexture,
  effectiveTint,
  materialEquals,
  parseMaterialImport,
  serializeMaterialExport,
  setChatEffect,
  setDeepGlass,
  setHaze,
  setMaterialEnabled,
  setSurfaceBlur,
  setSurfaceOpacity,
  setTexture,
  setTint,
} from '../material-settings'

describe('material-settings effective values', () => {
  it('falls back to shipped defaults when the setting is absent', () => {
    expect(effectiveBlur(null, 'topbar')).toBe(MATERIAL_DEFAULTS.blur.topbar)
    expect(effectiveBlur({}, 'popover')).toBe(MATERIAL_DEFAULTS.blur.popover)
    expect(effectiveOpacityPercent(null, 'chat')).toBe(Math.round(MATERIAL_DEFAULTS.opacity.chat * 100))
    expect(effectiveMattePercent(null)).toBe(0)
    expect(effectiveDeepGlass(null, 'content')).toBe(false)
    expect(effectiveTint(null)).toEqual({ hue: 0, saturation: 0, lightness: 0 })
    expect(effectiveTexture(null)).toEqual({
      kind: MATERIAL_DEFAULTS.texture.kind,
      intensity: MATERIAL_DEFAULTS.texture.intensity,
      scale: MATERIAL_DEFAULTS.texture.scale,
    })
    expect(effectiveHaze(null)).toEqual({
      enabled: MATERIAL_DEFAULTS.haze.enabled,
      intensity: MATERIAL_DEFAULTS.haze.intensity,
      overlay: MATERIAL_DEFAULTS.haze.overlay,
      emptyOpacity: MATERIAL_DEFAULTS.haze.emptyOpacity,
      activeOpacity: MATERIAL_DEFAULTS.haze.activeOpacity,
    })
    expect(effectiveChatEffect(null)).toEqual({
      kind: MATERIAL_DEFAULTS.chatEffect.kind,
      intensity: MATERIAL_DEFAULTS.chatEffect.intensity,
    })
  })

  it('prefers explicit per-surface values over defaults', () => {
    const material: MaterialSettings = { blur: { chat: 4 }, opacity: { chat: 0.25 } }
    expect(effectiveBlur(material, 'chat')).toBe(4)
    expect(effectiveOpacityPercent(material, 'chat')).toBe(25)
    expect(effectiveMattePercent({ matte: 0.475 })).toBe(48)
  })
})

describe('material-settings immutable patches', () => {
  it('writes a single surface without mutating other surfaces or the input', () => {
    const base: MaterialSettings = { enabled: true, blur: { topbar: 10 } }
    const next = setSurfaceBlur(base, 'rail', 30)
    expect(next).not.toBe(base)
    expect(next.blur).toEqual({ topbar: 10, rail: 30 })
    expect(base.blur).toEqual({ topbar: 10 })

    const withOpacity = setSurfaceOpacity(next, 'chat', 0.4)
    expect(withOpacity.opacity).toEqual({ chat: 0.4 })
    expect(withOpacity.blur).toEqual({ topbar: 10, rail: 30 })
  })

  it('creates a material object from null and merges nested sub-objects', () => {
    const enabled = setMaterialEnabled(null, true)
    expect(enabled).toEqual({ enabled: true })

    const tinted = setTint({ tint: { hue: 5 } }, { saturation: 20 })
    expect(tinted.tint).toEqual({ hue: 5, saturation: 20 })

    const textured = setTexture({ texture: { kind: 'grain' } }, { scale: 2 })
    expect(textured.texture).toEqual({ kind: 'grain', scale: 2 })

    const chatted = setChatEffect({}, { kind: 'dither', intensity: 0.7 })
    expect(chatted.chatEffect).toEqual({ kind: 'dither', intensity: 0.7 })

    const deep = setDeepGlass({ deepGlass: { content: true } }, 'lists', true)
    expect(deep.deepGlass).toEqual({ content: true, lists: true })

    const haze = setHaze({ haze: { enabled: true, intensity: 0.4 } }, { overlay: true, emptyOpacity: 0.24, activeOpacity: 0.5 })
    expect(haze.haze).toEqual({ enabled: true, intensity: 0.4, overlay: true, emptyOpacity: 0.24, activeOpacity: 0.5 })
  })
})

describe('material-settings presets and rows', () => {
  it('ships glass, zed-blurred, deep-glass, and matte presets that keep the layer enabled', () => {
    expect(MATERIAL_PRESETS.map(preset => preset.id)).toEqual(['glass', 'zedBlurred', 'deepGlass', 'matte'])
    for (const preset of MATERIAL_PRESETS) {
      expect(preset.material.enabled).toBe(true)
      expect(preset.labelKey.startsWith('settings.appearance.material.preset')).toBe(true)
    }
    // Zed parity: chrome/panels translucent, reading surfaces opaque.
    const zed = MATERIAL_PRESETS.find(preset => preset.id === 'zedBlurred')?.material
    expect(zed?.opacity).toEqual({
      topbar: 0.82, rail: 0.82, strip: 0.86, inspector: 0.84,
      sidebar: 0.82, navigator: 0.82, chat: 0.55, composer: 0.7, popover: 0.88,
    })
    expect(zed?.deepGlass).toBeUndefined()
    expect(MATERIAL_PRESETS.find(preset => preset.id === 'deepGlass')?.material.deepGlass).toEqual({
      content: true,
      editor: true,
      lists: true,
    })
    expect(MATERIAL_PRESETS.find(preset => preset.id === 'matte')?.material.matte).toBe(1)
  })

  it('exposes every surface and every deep-glass pane exactly once', () => {
    expect(MATERIAL_SURFACE_ROWS.map(row => row.surface)).toEqual([
      'topbar', 'rail', 'strip', 'inspector', 'sidebar', 'navigator', 'chat', 'composer', 'popover',
    ])
    expect(MATERIAL_CONTENT_PANE_ROWS.map(row => row.pane)).toEqual(['content', 'editor', 'lists'])
  })

  it('labels every texture and chat-effect kind', () => {
    expect(Object.keys(MATERIAL_TEXTURE_LABELS).sort()).toEqual([...MATERIAL_TEXTURE_KINDS].sort())
    expect(Object.keys(MATERIAL_CHAT_EFFECT_LABELS).sort()).toEqual([...MATERIAL_CHAT_EFFECT_KINDS].sort())
    for (const key of [...Object.values(MATERIAL_TEXTURE_LABELS), ...Object.values(MATERIAL_CHAT_EFFECT_LABELS)]) {
      expect(key.startsWith('settings.appearance.material.')).toBe(true)
    }
  })
})

describe('material-settings equality', () => {
  it('ignores key order, treats null/undefined as cleared, and detects changes', () => {
    expect(materialEquals({ enabled: true, tint: { hue: 1, saturation: 2 } }, { tint: { saturation: 2, hue: 1 }, enabled: true })).toBe(true)
    expect(materialEquals(null, undefined)).toBe(true)
    expect(materialEquals({}, null)).toBe(false)
    expect(materialEquals({ matte: 1 }, { matte: 0 })).toBe(false)
  })
})

describe('material-settings export/import', () => {
  it('round-trips the exported payload through the schema', () => {
    const material: MaterialSettings = { enabled: true, blur: { chat: 8 }, matte: 0.5 }
    const text = serializeMaterialExport(material, 'Rox material')
    const result = parseMaterialImport(text)
    expect(result).toEqual({ ok: true, material })
  })

  it('accepts a bare material object', () => {
    const result = parseMaterialImport(JSON.stringify({ enabled: true, texture: { kind: 'grain' } }))
    expect(result).toEqual({ ok: true, material: { enabled: true, texture: { kind: 'grain' } } })
  })

  it('rejects malformed, non-object, unknown-key, and out-of-range documents', () => {
    expect(parseMaterialImport('not json')).toEqual({ ok: false })
    expect(parseMaterialImport('null')).toEqual({ ok: false })
    expect(parseMaterialImport('[]')).toEqual({ ok: false })
    expect(parseMaterialImport(JSON.stringify({ enabled: true, mystery: 1 }))).toEqual({ ok: false })
    expect(parseMaterialImport(JSON.stringify({ blur: { chat: 999 } }))).toEqual({ ok: false })
    expect(parseMaterialImport(JSON.stringify({ texture: { kind: 'sparkle' } }))).toEqual({ ok: false })
  })
})