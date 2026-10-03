import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getBackgroundColor, mergeThemeOverrides, themeToCSS, type ThemeFile } from '../theme'
import { PresetThemeSchema, ThemeOverrideSchema } from '../validators'

const repo = join(import.meta.dir, '../../../../..')
const themes = join(repo, 'apps/electron/resources/themes')
const provenance = JSON.parse(readFileSync(join(repo, 'docs/themes/zed-provenance.json'), 'utf8')) as Array<{
  id: string
  sourceTheme: string
  selectedThemeSnapshot: string
  selectedThemeSnapshotSha256: string
  licenseNotice: string
  licenseNoticeSha256: string
  uiContrastCorrections: Array<{
    role: UiTextRole
    source: string
    adapted: string
    minimumContrast: number
    interpolation: number
  }>
  uiContrastModel: {
    minimumRatio: number
    chromeOpacity: { titlebar: number; navigator: number; toolbar: number }
    backingExtremes: string[]
  }
}>

const uiTextRoles = ['foreground', 'textSecondary', 'textMuted', 'accentText', 'info', 'success', 'destructive'] as const
type UiTextRole = typeof uiTextRoles[number]
type Rgb = [number, number, number]
type Background = { name: string; rgb: Rgb }

function rgb(hex: string): Rgb {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)) as Rgb
}

function over(fill: string, backing: Rgb, opacity = fill.length === 9 ? parseInt(fill.slice(7), 16) / 255 : 1): Rgb {
  return rgb(fill).map((channel, index) => opacity * channel + (1 - opacity) * backing[index]!) as Rgb
}

function loadPreset(id: string): ThemeFile {
  return JSON.parse(readFileSync(join(themes, `${id}.json`), 'utf8'))
}

function luminance(color: string | Rgb): number {
  const values = (typeof color === 'string' ? rgb(color) : color).map(channel => channel / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722
}

function contrast(a: string | Rgb, b: string | Rgb): number {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return (high! + .05) / (low! + .05)
}

/** Simulate the rendered backing, retaining fractional channels until luminance.
 * Chrome uses opaque source RGB before its material opacity; tabs keep their
 * own source alpha and are painted over the resulting chrome surface. */
function contrastBackgrounds(preset: ThemeFile): Background[] {
  const solidRoles = ['background', 'paper', 'navigator', 'input', 'popover', 'titlebar', 'toolbar',
    'tabBar', 'tabActive', 'tabInactive', 'elementHover', 'elementSelected'] as const
  const backgrounds: Background[] = solidRoles.map(role => ({ name: `opaque ${role}`, rgb: rgb(preset[role]!) }))
  for (const backing of ['#000000', '#ffffff']) {
    for (const [role, opacity] of [['titlebar', .84], ['navigator', .82], ['toolbar', .88]] as const) {
      const glass = over(preset[role]!, rgb(backing), opacity)
      backgrounds.push({ name: `${role} glass over ${backing}`, rgb: glass })
      if (role === 'navigator') continue
      const tabBar = over(preset.tabBar!, glass)
      backgrounds.push({ name: `tabBar over ${role} over ${backing}`, rgb: tabBar })
      for (const tab of ['tabActive', 'tabInactive'] as const) {
        const tabSurface = over(preset[tab]!, tabBar)
        backgrounds.push({ name: `${tab} over tabBar over ${role} over ${backing}`, rgb: tabSurface })
        for (const rowState of ['elementHover', 'elementSelected'] as const) {
          backgrounds.push({ name: `${rowState} over ${tab} over ${role} over ${backing}`, rgb: over(preset[rowState]!, tabSurface) })
        }
      }
    }
  }
  return backgrounds
}

describe('Zed preset contract', () => {
  it('keeps every old bundled preset valid alongside the new roles', () => {
    for (const file of readdirSync(themes).filter(file => file.endsWith('.json'))) {
      const result = PresetThemeSchema.safeParse(JSON.parse(readFileSync(join(themes, file), 'utf8')))
      expect(result.success, file).toBe(true)
    }
  })

  it('validates state/surface roles and rejects misspelled ANSI keys in overrides and dark variants', () => {
    expect(ThemeOverrideSchema.safeParse({ titlebar: '#202020', accentText: '#ffffff', terminalAnsi: { brightRed: '#ff0000' } }).success).toBe(true)
    expect(ThemeOverrideSchema.safeParse({ dark: { toolbar: '#202020', terminalAnsi: { dimBlue: '#0000ff' } } }).success).toBe(true)
    expect(ThemeOverrideSchema.safeParse({ terminalAnsi: { brightred: '#ff0000' } }).success).toBe(false)
    expect(ThemeOverrideSchema.safeParse({ dark: { terminalAnsi: { orange: '#ff0000' } } }).success).toBe(false)
  })

  it('deep merges individual ANSI entries and dark overrides without discarding the preset', () => {
    const merged = mergeThemeOverrides({
      foreground: '#ffffff', terminalAnsi: { red: '#cc0000', blue: '#0000cc' },
      dark: { titlebar: '#121212', terminalAnsi: { brightRed: '#ff0000', dimBlue: '#000044' } },
    }, {
      terminalAnsi: { red: '#dd0000' },
      dark: { terminalAnsi: { brightRed: '#ee0000' } },
    })
    expect(merged.terminalAnsi).toEqual({ red: '#dd0000', blue: '#0000cc' })
    expect(merged.dark).toEqual({ titlebar: '#121212', terminalAnsi: { brightRed: '#ee0000', dimBlue: '#000044' } })
    const css = themeToCSS(merged, true)
    expect(css).toContain('--terminal-ansi-red: #dd0000;')
    expect(css).toContain('--terminal-ansi-blue: #0000cc;')
    expect(css).toContain('--terminal-ansi-bright-red: #ee0000;')
    expect(css).toContain('--terminal-ansi-dim-blue: #000044;')
    expect(css).toContain('--surface-titlebar: #121212;')
  })

  it('uses input as a surface while preserving the UI control-border token', () => {
    const css = themeToCSS({ input: '#121212', borderSubtle: '#555555' })
    expect(css).toContain('--input-surface: #121212;')
    expect(css).toContain('--border-subtle: #555555;')
    expect(css).not.toMatch(/--input:/)
  })

  it('emits separate opaque RGB surfaces without changing custom hexadecimal alpha', () => {
    const css = themeToCSS({ background: '#1234', paper: '#AbC', navigator: '#abcdef12', input: '#13579088',
      titlebar: '#def0', toolbar: '#102030' })
    expect(css).toContain('--background: #1234;')
    expect(css).toContain('--navigator: #abcdef12;')
    expect(css).toContain('--surface-titlebar: #def0;')
    expect(css).toContain('--canvas-opaque: #112233;')
    expect(css).toContain('--paper-opaque: #aabbcc;')
    expect(css).toContain('--navigator-opaque: #abcdef;')
    expect(css).toContain('--input-surface-opaque: #135790;')
    expect(css).toContain('--surface-titlebar-opaque: #ddeeff;')
    expect(css).toContain('--surface-toolbar-opaque: #102030;')
  })

  it('normalizes simple numeric RGB and HSL surfaces to opaque hex independently of browser syntax', () => {
    const css = themeToCSS({ background: 'rgba(10, 20, 30, .1)', paper: 'rgb(10% 20% 30% / 50%)',
      navigator: 'hsla(120, 100%, 50%, 0)', input: 'hsl(-.25turn 100% 50% / 20%)',
      titlebar: 'rgb(-10, 128, 300)', toolbar: 'hsl(3.141592653589793rad 100% 50%)' })
    expect(css).toContain('--background: rgba(10, 20, 30, .1);')
    expect(css).toContain('--canvas-opaque: #0a141e;')
    expect(css).toContain('--paper-opaque: #1a334d;')
    expect(css).toContain('--navigator-opaque: #00ff00;')
    expect(css).toContain('--input-surface-opaque: #8000ff;')
    expect(css).toContain('--surface-titlebar-opaque: #0080ff;')
    expect(css).toContain('--surface-toolbar-opaque: #00ffff;')
  })

  it('normalizes numeric OKLCH, including percentage chroma, without changing the original declaration', () => {
    const css = themeToCSS({ background: 'oklch(65% 37.5% 270 / .25)', paper: 'oklch(1 0 0 / 0)',
      navigator: 'oklch(0 0 0)', input: 'oklch(.6279553606 .2576833077 29.2338851923)' })
    expect(css).toContain('--background: oklch(65% 37.5% 270 / .25);')
    // CSS Color 4's documented in-gamut example: oklch(65% .15 270) = #6c88ea.
    expect(css).toContain('--canvas-opaque: #6c88ea;')
    expect(css).toContain('--paper-opaque: #ffffff;')
    expect(css).toContain('--navigator-opaque: #000000;')
    expect(css).toContain('--input-surface-opaque: #ff0000;')
  })

  it('uses the opaque chosen canvas, then mode base, for unknown or invalid surface expressions', () => {
    for (const surface of ['color-mix(in srgb, red, transparent)', 'var(--custom-color)', 'rgb(from red r g b / .2)',
      'rgb(1 2 3 / bad)', 'rgba(1, 2%, 3, .2)', 'rgb(1 2 3; background: transparent)',
      'hsl(120 50 50)', 'oklch(.5 .2 0 /)', 'oklch(1e999 .2 0)']) {
      const css = themeToCSS({ background: '#01020380', titlebar: surface })
      expect(css).toContain(`--surface-titlebar: ${surface};`)
      expect(css).toContain('--surface-titlebar-opaque: #010203;')
    }
    for (const dark of [false, true]) {
      const css = themeToCSS({ background: 'var(--custom)', dark: { background: 'color(display-p3 1 0 0 / .1)' } }, dark)
      for (const role of ['canvas', 'paper', 'navigator', 'input-surface', 'surface-titlebar', 'surface-toolbar']) {
        expect(css).toContain(`--${role}-opaque: ${getBackgroundColor(dark)};`)
      }
    }
    expect(themeToCSS({ background: '#ffffff', dark: { background: '#123456aa', toolbar: 'rgba(40, 50, 60, .2)' } }, true))
      .toContain('--surface-toolbar-opaque: #28323c;')
  })

  for (const entry of provenance) {
    it(`${entry.id} retains source accent/ANSI colors, opaque central surfaces and exact notices`, () => {
      const preset = loadPreset(entry.id)
      const snapshot = readFileSync(join(repo, 'docs/themes', entry.selectedThemeSnapshot))
      expect(createHash('sha256').update(snapshot).digest('hex')).toBe(entry.selectedThemeSnapshotSha256)
      const source = JSON.parse(snapshot.toString()) as { name: string; appearance: 'dark' | 'light'; style: Record<string, string | null> }
      expect(source.name).toBe(entry.sourceTheme)
      expect(preset.accent?.toLowerCase()).toBe(source.style['text.accent']?.slice(0, 7).toLowerCase())
      expect(preset.background).toMatch(/^#[\da-f]{6}$/i)
      expect(preset.paper).toMatch(/^#[\da-f]{6}$/i)
      expect(preset.supportedModes).toEqual([source.appearance])
      expect(preset.shikiTheme?.[source.appearance]).toBe(`rox-${entry.id}`)
      expect(Object.keys(preset.terminalAnsi ?? {})).toHaveLength(entry.id === 'siri-light' ? 16 : 24)
      for (const [key, color] of Object.entries(preset.terminalAnsi ?? {})) {
        const sourceKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
        expect(color).toBe(source.style[`terminal.ansi.${sourceKey}`]!)
      }
      expect(preset.terminalAnsi?.red as string).toBe(source.style['terminal.ansi.red']!)
      for (const [role, sourceKey] of [
        ['terminalForeground', 'terminal.foreground'],
        ['terminalBrightForeground', 'terminal.bright_foreground'],
        ['terminalDimForeground', 'terminal.dim_foreground'],
      ] as const) {
        expect(preset[role]).toBe(source.style[sourceKey] ?? undefined)
      }
      const notice = readFileSync(join(repo, 'docs/themes', entry.licenseNotice))
      expect(createHash('sha256').update(notice).digest('hex')).toBe(entry.licenseNoticeSha256)
      expect(readFileSync(join(themes, entry.licenseNotice))).toEqual(notice)
      expect(notice.toString()).toContain('MIT License')
    })

    it(`${entry.id} gives active UI text at least 4.5:1 on its surfaces and row states`, () => {
      const preset = loadPreset(entry.id)
      const backgrounds = [preset.background, preset.paper, preset.navigator, preset.input, preset.popover,
        preset.titlebar, preset.toolbar, preset.tabBar, preset.tabActive, preset.tabInactive,
        preset.elementHover, preset.elementSelected].filter((color): color is string => Boolean(color))
      for (const role of uiTextRoles) {
        for (const background of backgrounds) {
          expect(contrast(preset[role]!, background), `${entry.id}: ${role} on ${background}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${entry.id} keeps active text readable over glass extremes, layered tabs and row states`, () => {
      const preset = loadPreset(entry.id)
      expect(entry.uiContrastModel.minimumRatio).toBe(4.5)
      expect(entry.uiContrastModel.chromeOpacity).toEqual({ titlebar: .84, navigator: .82, toolbar: .88 })
      expect(entry.uiContrastModel.backingExtremes).toEqual(['#000000', '#ffffff'])
      const backgrounds = contrastBackgrounds(preset)
      for (const role of uiTextRoles) {
        for (const background of backgrounds) {
          expect(contrast(preset[role]!, background.rgb), `${entry.id}: ${role} on ${background.name}`).toBeGreaterThanOrEqual(4.5)
        }
      }
      const source = JSON.parse(readFileSync(join(repo, 'docs/themes', entry.selectedThemeSnapshot), 'utf8'))
      // Negative control: the original foreground fails on glass for all three
      // themes, so checking only their opaque source surfaces misses the defect.
      expect(Math.min(...backgrounds.map(background => contrast(source.style.text, background.rgb)))).toBeLessThan(4.5)
    })

    it(`${entry.id} documents every UI correction and stops at the first readable RGB`, () => {
      const preset = loadPreset(entry.id)
      const source = JSON.parse(readFileSync(join(repo, 'docs/themes', entry.selectedThemeSnapshot), 'utf8'))
      const originalColors: Record<UiTextRole, string> = {
        foreground: source.style.text,
        textSecondary: source.style['text.muted'],
        textMuted: source.style['text.muted'],
        accentText: source.style['text.accent'],
        info: source.style.warning,
        success: source.style.success ?? source.style.created,
        destructive: source.style.error ?? source.style.deleted ?? source.style.conflict,
      }
      const backgrounds = contrastBackgrounds(preset)
      for (const role of uiTextRoles) {
        const correction = entry.uiContrastCorrections.find(item => item.role === role)
        if (!correction) {
          expect(preset[role]?.toLowerCase()).toBe(originalColors[role].slice(0, 7).toLowerCase())
          continue
        }
        expect(correction.source).toBe(originalColors[role])
        expect(correction.adapted).toBe(preset[role]!)
        const minimum = Math.min(...backgrounds.map(background => contrast(correction.adapted, background.rgb)))
        expect(minimum).toBeGreaterThanOrEqual(4.5)
        expect(minimum).toBeCloseTo(correction.minimumContrast, 6)
        const target = source.appearance === 'dark' ? 255 : 0
        const previous = rgb(correction.source).map(channel => Math.round(channel + (target - channel) * (correction.interpolation - .0001))) as Rgb
        expect(Math.min(...backgrounds.map(background => contrast(previous, background.rgb)))).toBeLessThan(4.5)
      }
    })
  }
})
