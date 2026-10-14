import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkLayerContrast,
  fixLayerContrast,
  gradientToCSS,
  mergeThemeOverrides,
  resolveContrastInputs,
  themeToCSS,
  type ThemeFile,
  type ThemeLayers,
} from '../theme.ts'
import { PresetThemeSchema, RoxThemeFileSchema, ThemeOverrideSchema } from '../validators.ts'

const themesDir = join(import.meta.dir, '../../../../../apps/electron/resources/themes')
const arc = JSON.parse(readFileSync(join(themesDir, 'arc-glass.json'), 'utf-8')) as ThemeFile

describe('theme layers', () => {
  it('emits no layer tokens for presets without layers', () => {
    for (const file of readdirSync(themesDir).filter(f => f.endsWith('.json') && f !== 'arc-glass.json')) {
      const theme = JSON.parse(readFileSync(join(themesDir, file), 'utf-8')) as ThemeFile
      for (const dark of [false, true]) {
        const css = themeToCSS(theme, dark)
        expect(css).not.toContain('--frame-')
        expect(css).not.toContain('--content-')
        expect(css).not.toContain('--wallpaper')
      }
    }
  })

  it('ships Arc Glass as a valid preset with the radial wallpaper and floating card', () => {
    expect(PresetThemeSchema.safeParse(arc).success).toBe(true)
    const css = themeToCSS(arc, true)
    expect(css).toContain('--wallpaper: radial-gradient(130% 100% at 0% 0%, #1d3b4a 0%, #121a22 45%, #0c0e12 100%);')
    expect(css).toContain('--content-radius: 12px;')
    expect(css).toContain('--glass-intensity: 0.6;')
    expect(css).toContain('--grid-divider: rgba(255,255,255,0.12);')
  })

  it('aliases legacy variables to the layers', () => {
    const layers: ThemeLayers = { frame: { bg: '#101418' }, content: { bg: '#15171b' }, elevation: { 1: '#1d2026' }, accent: '#38bdf8' }
    const css = themeToCSS({ background: '#ffffff', navigator: '#eeeeee', accent: '#000000', dark: { background: '#000000', accent: '#111111' }, layers }, true)
    expect(css).toContain('--navigator: #101418;')
    expect(css).toContain('--surface-titlebar: #101418;')
    expect(css).toContain('--background: #15171b;')
    expect(css).toContain('--paper: #1d2026;')
    expect(css).toContain('--accent: #38bdf8;')
    expect(css).toContain('--frame-fg:')
  })

  it('merges layers per field', () => {
    const merged = mergeThemeOverrides(arc, { layers: { content: { join: 'line' }, glass: 0.2 } })
    expect(merged.layers?.content).toMatchObject({ bg: '#15171b', join: 'line', radius: 12 })
    expect(merged.layers?.glass).toBe(0.2)
    expect(merged.layers?.wallpaper).toEqual(arc.layers!.wallpaper)
  })

  it('accepts layers in theme.json and rejects malformed gradients', () => {
    expect(ThemeOverrideSchema.safeParse({ layers: { glass: 0.5 } }).success).toBe(true)
    expect(ThemeOverrideSchema.safeParse({ layers: { wallpaper: { type: 'linear', stops: [['#000', 0]] } } }).success).toBe(false)
    expect(ThemeOverrideSchema.safeParse({ layers: { glass: 2 } }).success).toBe(false)
  })

  it('round-trips the .rox-theme.json format', () => {
    const file = { version: 1, name: 'Arc', layers: arc.layers }
    expect(RoxThemeFileSchema.safeParse(file).success).toBe(true)
    expect(RoxThemeFileSchema.safeParse({ ...file, version: 2 }).success).toBe(false)
  })

  it('renders linear gradients with sorted stops', () => {
    expect(gradientToCSS({ type: 'linear', angle: 90, stops: [['#fff', 1], ['#000', 0]] })).toBe('linear-gradient(90deg, #000 0%, #fff 100%)')
  })

  it('passes contrast for Arc Glass and fixes a failing pair', () => {
    const inputs = resolveContrastInputs(arc.layers, {})
    expect(checkLayerContrast(inputs).every(r => r.pass)).toBe(true)
    const bad: ThemeLayers = { ...arc.layers, frame: { ...arc.layers!.frame, fg: '#2a2f36' } }
    const badInputs = resolveContrastInputs(bad, {})
    expect(checkLayerContrast(badInputs).find(r => r.id === 'frameText')?.pass).toBe(false)
    const fixed = fixLayerContrast(bad, badInputs, 'frameText')
    expect(checkLayerContrast(resolveContrastInputs(fixed, {})).find(r => r.id === 'frameText')?.pass).toBe(true)
  })
})
