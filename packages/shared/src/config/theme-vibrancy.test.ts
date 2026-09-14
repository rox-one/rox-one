import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_HEX, DEFAULT_THEME, shouldSetThemeOverride, themeToCSS, type ThemeFile } from './theme'

function loadBundledTheme(id: string): ThemeFile {
  const path = join(import.meta.dir, '../../../../apps/electron/resources/themes', `${id}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as ThemeFile
}

describe('shouldSetThemeOverride', () => {
  it('keeps vibrancy on the default theme', () => {
    expect(shouldSetThemeOverride('default', false)).toBe(true)
    expect(shouldSetThemeOverride(null, false)).toBe(true)
  })

  it('keeps the scenic attribute so wallpaper CSS still binds', () => {
    expect(shouldSetThemeOverride('haze', true)).toBe(true)
  })

  it('skips vibrancy on GitHub, Ghostty, and Pierre', () => {
    expect(shouldSetThemeOverride('github', false)).toBe(false)
    expect(shouldSetThemeOverride('ghostty', false)).toBe(false)
    expect(shouldSetThemeOverride('pierre', false)).toBe(false)
  })
})

describe('GitHub and Ghostty palettes', () => {
  it('emit Primer dark #0d1117 for GitHub dark', () => {
    const css = themeToCSS(loadBundledTheme('github'), true)
    expect(css).toContain('--background: #0d1117;')
  })

  it('emit Ghostty StyleDark #292c33', () => {
    const css = themeToCSS(loadBundledTheme('ghostty'), true)
    expect(css).toContain('--background: #292c33;')
  })
})

describe('semantic theme surfaces', () => {
  it('applies a custom input fill without replacing the input border token', () => {
    const css = themeToCSS({ background: '#fafafa', input: '#eeeeee' })
    expect(css).toContain('--input-surface: #eeeeee;')
    expect(css).not.toContain('--input:')
  })

  it('keeps semantic RGB aliases in sync with the selected dark palette', () => {
    const css = themeToCSS({ accent: '#123456', dark: { accent: '#abcdef', success: '#408060' } }, true)
    expect(css).toContain('--accent: #abcdef;')
    expect(css).toContain('--accent-rgb: 171, 205, 239;')
    expect(css).toContain('--success-rgb: 64, 128, 96;')
  })

  it('uses the same default colors in the preset, renderer, and native window', () => {
    const preset = loadBundledTheme('default')
    const css = readFileSync(join(import.meta.dir, '../../../ui/src/styles/index.css'), 'utf8')
    for (const role of ['background', 'foreground', 'accent', 'info', 'success', 'destructive'] as const) {
      expect(preset[role]).toBe(DEFAULT_THEME[role])
      expect(preset.dark?.[role]).toBe(DEFAULT_THEME.dark?.[role])
      expect(css).toContain(`--${role}: ${DEFAULT_THEME[role]};`)
      expect(css).toContain(`--${role}: ${DEFAULT_THEME.dark?.[role]};`)
    }
    expect(preset.background).toBe(BACKGROUND_HEX.light)
    expect(preset.dark?.background).toBe(BACKGROUND_HEX.dark)
  })
})

describe('ThemeProvider wiring', () => {
  it('gates data-theme-override on shouldSetThemeOverride', () => {
    const source = readFileSync(
      join(import.meta.dir, '../../../../apps/electron/src/renderer/context/ThemeContext.tsx'),
      'utf8',
    )
    expect(source).toContain('shouldSetThemeOverride(effectiveColorTheme, isScenic)')
  })

  it('paints opaque html/body/chrome when the overlay attribute is absent', () => {
    const css = readFileSync(
      join(import.meta.dir, '../../../../apps/electron/src/renderer/index.css'),
      'utf8',
    )
    expect(css).toContain('html[data-theme]:not([data-scenic]):not([data-theme-override])')
    expect(css).toContain('html[data-theme]:not([data-scenic]):not([data-theme-override]) body')
    expect(css).toContain('html[data-theme]:not([data-scenic]):not([data-theme-override]) .chrome-rail')
  })
})
