import { describe, expect, it } from 'bun:test'
import { codeToHtml, codeToTokens, createHighlighter } from 'shiki'
import { getSharedHighlighter, parseDiffFromFile, RegisteredCustomThemes, renderDiffWithHighlighter, resolveTheme } from '@pierre/diffs'
import { registerCraftShikiThemes } from '../registerShikiThemes'
import { registerZedShikiLoaders, resolveShikiTheme, ZED_SHIKI_THEMES } from '../zedShikiThemes'

const names = ['rox-nordfox-opaque', 'rox-min-dark-blurred', 'rox-siri-light'] as const
const source = '// comment\nconst name = "hello"\nfunction greet(value: string) { return 42 }'

function luminance(hex: string): number {
  const channels = hex.replace('#', '').match(/../g)!.slice(0, 3).map(channel => {
    const value = parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}

describe('installed Zed syntax adaptations', () => {
  it('renders real grammar tokens with three distinct palettes and identical source', async () => {
    const html: string[] = []
    for (const name of names) {
      const theme = resolveShikiTheme(name)
      const result = await codeToTokens(source, { lang: 'typescript', theme })
      expect(result.tokens.map(line => line.map(token => token.content).join('')).join('\n')).toBe(source)
      html.push(await codeToHtml(source, { lang: 'typescript', theme }))
    }
    expect(html[0]).toContain('rox-nordfox-opaque')
    expect(html[0]).toContain('#B590AF')
    expect(html[1]).toContain('#FA7584')
    expect(html[2]).toContain('#0433FF')
    expect(html[2]).toContain('font-style:italic')
    expect(new Set(html).size).toBe(3)
  })

  it('keeps bundled names intact, and plaintext/unknown languages retain source', async () => {
    expect(resolveShikiTheme('github-dark')).toBe('github-dark')
    expect(resolveShikiTheme('constructor')).toBe('constructor')
    const html = await codeToHtml('<value> & text', { lang: 'text', theme: resolveShikiTheme(names[0]) })
    expect(html).not.toContain('<value>')
    const tokens = await codeToTokens('<value> & text', { lang: 'text', theme: resolveShikiTheme(names[0]) })
    expect(tokens.tokens.flat().map(token => token.content).join('')).toBe('<value> & text')
  })

  it('gives every adapted syntax foreground at least 4.5 contrast on the opaque code surface', () => {
    for (const name of names) {
      const theme = ZED_SHIKI_THEMES[name]!
      const background = luminance(theme.colors!['editor.background']!)
      for (const setting of theme.settings!) {
        const foreground = luminance(setting.settings.foreground!)
        const ratio = (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
        expect(ratio).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('registers Pierre once and renders the same syntax through real diff processing', async () => {
    registerCraftShikiThemes()
    const loaders = names.map(name => RegisteredCustomThemes.get(name))
    registerCraftShikiThemes()
    expect(names.map(name => RegisteredCustomThemes.get(name))).toEqual(loaders)
    const highlighter = await getSharedHighlighter({ themes: [...names], langs: ['typescript'] })
    const diff = parseDiffFromFile(
      { name: 'value.ts', contents: 'const value = "before"\n' },
      { name: 'value.ts', contents: 'const value = "after"\n' },
    )
    for (const name of names) {
      const theme = await resolveTheme(name)
      expect(theme.name).toBe(name)
      const result = renderDiffWithHighlighter(diff, highlighter, { theme: name, lineDiffType: 'word', tokenizeMaxLineLength: 1000 })
      expect(result.baseThemeType).toBe(name === 'rox-siri-light' ? 'light' : 'dark')
      const rendered = JSON.stringify(result.code)
      expect(rendered).toContain('before')
      expect(rendered).toContain('after')
      expect(result.themeStyles.toLowerCase()).toContain(theme.bg.toLowerCase())
    }
  }, 30_000)

  it('loads the custom names using TipTap’s string-loader path', async () => {
    registerZedShikiLoaders()
    registerZedShikiLoaders()
    const highlighter = await createHighlighter({ themes: [...names] as any, langs: ['typescript'] })
    try {
      expect(highlighter.getLoadedThemes()).toEqual(expect.arrayContaining([...names]))
      for (const name of names) expect(highlighter.codeToHtml(source, { lang: 'typescript', theme: name }).length).toBeGreaterThan(source.length)
    } finally {
      highlighter.dispose()
    }
  })
})
