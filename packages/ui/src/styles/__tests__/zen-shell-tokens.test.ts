import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const uiCss = readFileSync(join(import.meta.dir, '../index.css'), 'utf8')
const rendererCss = readFileSync(
  join(import.meta.dir, '../../../../../apps/electron/src/renderer/index.css'),
  'utf8',
)

describe('Zen Shell visual tokens (ZS-02)', () => {
  it('declares semantic shell tokens only under data-shell-style=zen', () => {
    const required = [
      '--shell-backdrop-tint',
      '--shell-border',
      '--shell-content',
      '--shell-hover',
      '--shell-selected',
      '--shell-focus',
      '--shell-sash',
      '--shell-motion-fast: 120ms',
      '--shell-motion-disclosure: 180ms',
    ]
    for (const token of required) {
      expect(uiCss.includes(token), `missing ${token}`).toBe(true)
    }
    expect(uiCss).toContain('html[data-shell-style="zen"]')
    expect(uiCss).toContain('[data-shell-role="content"]')
    expect(uiCss).toContain('[data-shell-role="chrome"]')
  })

  it('does not rewrite the leftover high-contrast block', () => {
    expect(uiCss).toContain('HIGH CONTRAST (issue 07 leftover')
    expect(uiCss).toContain('html[data-contrast="high"][data-scenic]::before')
  })

  it('keeps --shell-content opaque (no alpha in the zen content token)', () => {
    const block = uiCss.slice(uiCss.indexOf('html[data-shell-style="zen"] {'))
    const contentLine = block.split('\n').find((line) => line.includes('--shell-content:'))
    expect(contentLine).toBeTruthy()
    expect(contentLine).not.toMatch(/\/\s*0\.\d+/)
    expect(contentLine).not.toContain('transparent')
  })

  it('stops scenic translucent --background from painting zen documents', () => {
    expect(rendererCss).toContain('html[data-shell-style="zen"][data-scenic] [data-shell-role="content"]')
    expect(rendererCss).toContain('--background: var(--shell-content)')
  })
})
