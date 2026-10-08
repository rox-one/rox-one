import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, '..', 'index.css'), 'utf8')
const interFaces = readFileSync(
  join(import.meta.dir, '..', 'inter-font-face.css'),
  'utf8',
)

describe('font role CSS', () => {
  it('defines independent UI, chat, and terminal stacks', () => {
    expect(css).toContain('--font-chat:')
    expect(css).toContain('html[data-font="rox"]')
    expect(css).toContain('html[data-font="system"]')
    expect(css).toContain('html[data-chat-font="inter"]')
    expect(css).toContain('html[data-terminal-font="jetbrains"]')
    expect(css).toContain('html[data-terminal-font="rox"]')
    expect(css).toContain('[data-focus-zone="chat"]')
  })

  it('uses bundled Inter for UI/chat and keeps embedded Rox mono for the terminal', () => {
    expect(css).toContain('@font-face')
    expect(css).toMatch(/font-family:\s*["']Rox["']/)

    // The legacy Arial Narrow UI token is gone; Inter and the OS stack are inline.
    expect(css).not.toContain('Arial Narrow')
    expect(css).not.toContain('--font-ui-narrow')

    const rootSans = css.match(/--font-sans:\s*([^;]+);/)?.[1] ?? ''
    expect(rootSans.trim().startsWith('"Inter"')).toBe(true)
    expect(rootSans).toContain('system-ui')

    const uiBlock = css.match(/html\[data-font="rox"\]\s*\{[^}]+\}/)?.[0] ?? ''
    expect(uiBlock).toContain('"Inter"')
    expect(uiBlock).not.toMatch(/["']Rox["']/)

    const chatBlock = css.match(/html\[data-chat-font="rox"\]\s*\{[^}]+\}/)?.[0] ?? ''
    expect(chatBlock).toContain('"Inter"')

    const rootMono = css.match(/--font-mono:\s*([^;]+);/)?.[1] ?? ''
    expect(rootMono).toMatch(/^["']Rox["'].*monospace$/)

    const terminalBlock = css.match(/html\[data-terminal-font="rox"\]\s*\{[^}]+\}/)?.[0] ?? ''
    expect(terminalBlock).toMatch(/["']Rox["']/)
  })

  it('renders Inter from the local bundle instead of the Google CDN', () => {
    // The shared theme must not import or reference the Google font CDN.
    expect(css).not.toContain('fonts.googleapis.com')
    expect(css).not.toContain('fonts.gstatic.com')
    expect(css).toContain('@import "./inter-font-face.css"')

    // Inter @font-face declarations resolve to the bundled woff2 files only.
    expect(interFaces).toMatch(/font-family:\s*["']Inter["']/)
    const sources = [...interFaces.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)].map(
      (m) => m[1],
    )
    expect(sources.length).toBe(8)
    for (const src of sources) {
      expect(src).toMatch(/^\.\.\/fonts\/inter\/Inter-.+\.woff2$/)
    }
    expect(sources).toContain('../fonts/inter/Inter-latin.woff2')
    expect(sources).toContain('../fonts/inter/Inter-cyrillic.woff2')
    expect(sources).toContain('../fonts/inter/Inter-latin-italic.woff2')

    // The "inter" preference resolves to Inter for both UI and chat.
    const interUiBlock = css.match(/html\[data-font="inter"\]\s*\{[^}]+\}/)?.[0] ?? ''
    expect(interUiBlock).toMatch(/--font-sans:\s*["']Inter["']/)

    const interChatBlock = css.match(/html\[data-chat-font="inter"\]\s*\{[^}]+\}/)?.[0] ?? ''
    expect(interChatBlock).toMatch(/--font-chat:\s*["']Inter["']/)
  })
})