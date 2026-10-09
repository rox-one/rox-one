/**
 * material-settings
 *
 * Pure helpers for the Appearance → "Материал и эффекты" (glass) section.
 *
 * Everything here is renderer-agnostic and side-effect free: it maps the
 * optional `MaterialSettings` model onto concrete slider values (falling back
 * to `MATERIAL_DEFAULTS`), applies immutable per-field patches, and
 * serialises/validates the export/import JSON payload.
 */

import {
  MATERIAL_DEFAULTS,
  type MaterialChatEffectKind,
  type MaterialContentPane,
  type MaterialSettings,
  type MaterialSurface,
  type MaterialTextureKind,
} from '@config/theme'
import { MaterialSettingsSchema } from '@config/validators'

/** Ordered surface rows for the opacity/blur groups (i18n label key per row). */
export interface MaterialSurfaceRow {
  surface: MaterialSurface
  labelKey: string
}

export const MATERIAL_SURFACE_ROWS: MaterialSurfaceRow[] = [
  { surface: 'topbar', labelKey: 'settings.appearance.material.surfaceTopbar' },
  { surface: 'rail', labelKey: 'settings.appearance.material.surfaceRail' },
  { surface: 'strip', labelKey: 'settings.appearance.material.surfaceStrip' },
  { surface: 'inspector', labelKey: 'settings.appearance.material.surfaceInspector' },
  { surface: 'sidebar', labelKey: 'settings.appearance.material.surfaceSidebar' },
  { surface: 'navigator', labelKey: 'settings.appearance.material.surfaceNavigator' },
  { surface: 'chat', labelKey: 'settings.appearance.material.surfaceChat' },
  { surface: 'composer', labelKey: 'settings.appearance.material.surfaceComposer' },
  { surface: 'popover', labelKey: 'settings.appearance.material.surfacePopover' },
]

/** Deep-glass panes shown in the advanced group. */
export interface MaterialContentPaneRow {
  pane: MaterialContentPane
  labelKey: string
}

export const MATERIAL_CONTENT_PANE_ROWS: MaterialContentPaneRow[] = [
  { pane: 'content', labelKey: 'settings.appearance.material.deepGlassContent' },
  { pane: 'editor', labelKey: 'settings.appearance.material.deepGlassEditor' },
  { pane: 'lists', labelKey: 'settings.appearance.material.deepGlassLists' },
]

/** Preset chips. `null` (reset) is handled separately by the page. */
export type MaterialPresetId = 'glass' | 'deepGlass' | 'matte'

export interface MaterialPreset {
  id: MaterialPresetId
  labelKey: string
  material: MaterialSettings
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: 'glass',
    labelKey: 'settings.appearance.material.presetGlass',
    material: { enabled: true },
  },
  {
    id: 'deepGlass',
    labelKey: 'settings.appearance.material.presetDeepGlass',
    material: { enabled: true, deepGlass: { content: true, editor: true, lists: true } },
  },
  {
    id: 'matte',
    labelKey: 'settings.appearance.material.presetMatte',
    material: { enabled: true, matte: 1 },
  },
]

/** Texture kind i18n keys for the select. */
export const MATERIAL_TEXTURE_LABELS: Record<MaterialTextureKind, string> = {
  none: 'settings.appearance.material.textureNone',
  grain: 'settings.appearance.material.textureGrain',
  scanlines: 'settings.appearance.material.textureScanlines',
  pinstripe: 'settings.appearance.material.texturePinstripe',
  herringbone: 'settings.appearance.material.textureHerringbone',
}

/** Chat effect kind i18n keys for the select. */
export const MATERIAL_CHAT_EFFECT_LABELS: Record<MaterialChatEffectKind, string> = {
  none: 'settings.appearance.material.chatEffectNone',
  gradient: 'settings.appearance.material.chatEffectGradient',
  dither: 'settings.appearance.material.chatEffectDither',
  ascii: 'settings.appearance.material.chatEffectAscii',
  halftone: 'settings.appearance.material.chatEffectHalftone',
  scanlines: 'settings.appearance.material.chatEffectScanlines',
}

// ============================================
// Effective values (draft -> concrete control value)
// ============================================

export function effectiveBlur(material: MaterialSettings | null, surface: MaterialSurface): number {
  return material?.blur?.[surface] ?? MATERIAL_DEFAULTS.blur[surface]
}

/** Opacity as a 0..100 integer percent for the slider. */
export function effectiveOpacityPercent(material: MaterialSettings | null, surface: MaterialSurface): number {
  const fraction = material?.opacity?.[surface] ?? MATERIAL_DEFAULTS.opacity[surface]
  return Math.round(fraction * 100)
}

export function effectiveTint(material: MaterialSettings | null): Required<NonNullable<MaterialSettings['tint']>> {
  return {
    hue: material?.tint?.hue ?? 0,
    saturation: material?.tint?.saturation ?? 0,
    lightness: material?.tint?.lightness ?? 0,
  }
}

export function effectiveTexture(
  material: MaterialSettings | null,
): Required<NonNullable<MaterialSettings['texture']>> {
  return {
    kind: material?.texture?.kind ?? MATERIAL_DEFAULTS.texture.kind,
    intensity: material?.texture?.intensity ?? MATERIAL_DEFAULTS.texture.intensity,
    scale: material?.texture?.scale ?? MATERIAL_DEFAULTS.texture.scale,
  }
}

export function effectiveHaze(
  material: MaterialSettings | null,
): Required<NonNullable<MaterialSettings['haze']>> {
  return {
    enabled: material?.haze?.enabled ?? MATERIAL_DEFAULTS.haze.enabled,
    intensity: material?.haze?.intensity ?? MATERIAL_DEFAULTS.haze.intensity,
  }
}

/** Matte strength as a 0..100 integer percent. */
export function effectiveMattePercent(material: MaterialSettings | null): number {
  return Math.round((material?.matte ?? 0) * 100)
}

export function effectiveChatEffect(
  material: MaterialSettings | null,
): Required<NonNullable<MaterialSettings['chatEffect']>> {
  return {
    kind: material?.chatEffect?.kind ?? MATERIAL_DEFAULTS.chatEffect.kind,
    intensity: material?.chatEffect?.intensity ?? MATERIAL_DEFAULTS.chatEffect.intensity,
  }
}

export function effectiveDeepGlass(material: MaterialSettings | null, pane: MaterialContentPane): boolean {
  return material?.deepGlass?.[pane] ?? false
}

// ============================================
// Immutable patches
// ============================================

function base(material: MaterialSettings | null): MaterialSettings {
  return material ? { ...material } : {}
}

export function setMaterialEnabled(material: MaterialSettings | null, enabled: boolean): MaterialSettings {
  return { ...base(material), enabled }
}

export function setSurfaceBlur(
  material: MaterialSettings | null,
  surface: MaterialSurface,
  value: number,
): MaterialSettings {
  return { ...base(material), blur: { ...material?.blur, [surface]: value } }
}

export function setSurfaceOpacity(
  material: MaterialSettings | null,
  surface: MaterialSurface,
  value: number,
): MaterialSettings {
  return { ...base(material), opacity: { ...material?.opacity, [surface]: value } }
}

export function setTint(
  material: MaterialSettings | null,
  patch: NonNullable<MaterialSettings['tint']>,
): MaterialSettings {
  return { ...base(material), tint: { ...material?.tint, ...patch } }
}

export function setTexture(
  material: MaterialSettings | null,
  patch: NonNullable<MaterialSettings['texture']>,
): MaterialSettings {
  return { ...base(material), texture: { ...material?.texture, ...patch } }
}

export function setHaze(
  material: MaterialSettings | null,
  patch: NonNullable<MaterialSettings['haze']>,
): MaterialSettings {
  return { ...base(material), haze: { ...material?.haze, ...patch } }
}

export function setMatte(material: MaterialSettings | null, value: number): MaterialSettings {
  return { ...base(material), matte: value }
}

export function setChatEffect(
  material: MaterialSettings | null,
  patch: NonNullable<MaterialSettings['chatEffect']>,
): MaterialSettings {
  return { ...base(material), chatEffect: { ...material?.chatEffect, ...patch } }
}

export function setDeepGlass(
  material: MaterialSettings | null,
  pane: MaterialContentPane,
  value: boolean,
): MaterialSettings {
  return { ...base(material), deepGlass: { ...material?.deepGlass, [pane]: value } }
}

// ============================================
// Equality (for suppressing self-echo syncs)
// ============================================

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

/** Key-order-insensitive deep equality for material settings (null = cleared). */
export function materialEquals(
  a: MaterialSettings | null | undefined,
  b: MaterialSettings | null | undefined,
): boolean {
  return stableStringify(a ?? null) === stableStringify(b ?? null)
}

// ============================================
// Export / import
// ============================================

/** Shape written by the export action: the material object plus a display name. */
export interface MaterialExportPayload {
  name: string
  material: MaterialSettings
}

export function serializeMaterialExport(material: MaterialSettings | null, name: string): string {
  const payload: MaterialExportPayload = { name, material: material ?? {} }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export type MaterialImportResult =
  | { ok: true; material: MaterialSettings }
  | { ok: false }

/**
 * Parse and validate an imported material JSON document. Accepts either the
 * export wrapper (`{ name, material }`) or a bare material object. Invalid or
 * out-of-range documents fail the schema and return `{ ok: false }`.
 */
export function parseMaterialImport(text: string): MaterialImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false }
  const record = raw as Record<string, unknown>
  const candidate = 'material' in record && record.material !== null && typeof record.material === 'object'
    ? record.material
    : record
  const parsed = MaterialSettingsSchema.safeParse(candidate)
  if (!parsed.success) return { ok: false }
  return { ok: true, material: parsed.data }
}