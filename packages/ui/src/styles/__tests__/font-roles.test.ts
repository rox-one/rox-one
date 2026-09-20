import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, '..', 'index.css'), 'utf8')

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

  it('embeds Rox as the real face for UI and terminal', () => {
    expect(css).toContain('@font-face')
    expect(css).toMatch(/font-family:\s*["']Rox["']/)

    const uiBlock = css.match(/html\[data-font="rox"\]\s*\{[^}]+\}/)?.[0] ?? ''
    expect(uiBlock).toMatch(/["']Rox["']/)

    const terminalBlock = css.match(/html\[data-terminal-font="rox"\]\s*\{[^}]+\}/)?.[0] ?? ''
    expect(terminalBlock).toMatch(/["']Rox["']/)
  })
})
