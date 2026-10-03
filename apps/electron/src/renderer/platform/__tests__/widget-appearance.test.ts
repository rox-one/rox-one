import { describe, expect, it } from 'bun:test'
import {
  HOME_WIDGET_IDS,
  HOME_WIDGET_SIZES,
  cloneLayout,
  isSupportedHomeLayout,
  normalizeHomeLayout,
  persistHomeLayout,
  resizeWidget,
  setWidgetAppearance,
} from '../home/dashboard-layout'
import { WIDGET_DESIGN_PRESETS, isWidgetAppearance, matchingWidgetPreset, widgetAppearanceStyle } from '../home/widget-appearance'

describe('per-widget designs', () => {
  it('restores every preset for every widget and size, with independent placement preferences', () => {
    const layout = normalizeHomeLayout({ version: 2, widgets: HOME_WIDGET_IDS.map((id) => ({ id, size: 'S' })) })
    for (const id of HOME_WIDGET_IDS) {
      for (const size of HOME_WIDGET_SIZES) {
        for (const preset of WIDGET_DESIGN_PRESETS) {
          const designed = setWidgetAppearance(resizeWidget(layout, id, size), id, preset.appearance)
          const stored = persistHomeLayout(designed, 'owner-a', 'revision-a')
          expect(isSupportedHomeLayout(stored)).toBe(true)
          const restored = normalizeHomeLayout(JSON.parse(JSON.stringify(stored)))
          expect(restored.widgets.find((widget) => widget.id === id)).toEqual({ id, size, appearance: preset.appearance })
          expect(restored.widgets.filter((widget) => widget.id !== id)).toEqual(layout.widgets.filter((widget) => widget.id !== id))
        }
      }
    }
  })

  it('isolates draft and persisted nested appearances, including reset, reorder and resize', () => {
    const appearance = { palette: 'mint', saturation: 13, contrast: 96 } as const
    const layout = setWidgetAppearance(normalizeHomeLayout({ version: 2, widgets: [{ id: 'notes', size: 'M' }, { id: 'calendar', size: 'L' }] }), 'notes', appearance)
    const draft = cloneLayout(layout)
    draft.widgets[0]!.appearance!.contrast = 10
    expect(layout.widgets[0]!.appearance!.contrast).toBe(96)
    const record = persistHomeLayout(layout, 'owner-a', 'revision-a')
    record.widgets[0]!.appearance!.saturation = 99
    expect(layout.widgets[0]!.appearance!.saturation).toBe(13)
    const reset = setWidgetAppearance(layout, 'notes')
    expect(reset.widgets[0]).toEqual({ id: 'notes', size: 'M' })
    expect(reset.widgets[1]).toBe(layout.widgets[1])
    expect(layout.widgets[0]!.appearance).toEqual(appearance)
    expect(resizeWidget(layout, 'notes', 'L').widgets[0]!.appearance).toEqual(appearance)
  })

  it('rejects unsupported or malformed designs without silently rewriting a saved layout', () => {
    const base = { palette: 'mint', saturation: 50, contrast: 50 }
    for (const appearance of [null, {}, { ...base, palette: 'unknown' }, { ...base, saturation: -1 }, { ...base, contrast: 101 }, { ...base, saturation: NaN }, { ...base, contrast: Infinity }, { ...base, customCss: 'url(...)' }]) {
      expect(isWidgetAppearance(appearance)).toBe(false)
      expect(isSupportedHomeLayout({ version: 2, widgets: [{ id: 'notes', size: 'S', appearance }] })).toBe(false)
    }
    expect(isWidgetAppearance(base)).toBe(true)
  })

  it('keeps custom slider values separate from named presets and never filters text or content', () => {
    for (const preset of WIDGET_DESIGN_PRESETS) {
      expect(matchingWidgetPreset(preset.appearance)).toBe(preset.id)
      expect(matchingWidgetPreset({ ...preset.appearance, saturation: preset.appearance.saturation + 1 })).toBeUndefined()
      const style = widgetAppearanceStyle(preset.appearance)
      expect(Object.keys(style).sort()).toEqual(['--widget-border', '--widget-surface'])
      expect(style['--widget-surface']).toContain('var(--widget-base, var(--background))')
    }
    expect(widgetAppearanceStyle()).toEqual({})
  })
})
