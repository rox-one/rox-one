import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, '../index.css'), 'utf8')

describe('Rox graphite token audit', () => {
  it('declares ink/graphite/mint with 6/8px radii and panel elevation', () => {
    const required = [
      '--ink:',
      '--graphite:',
      '--rox-mint:',
      '--rox-radius-sm: 6px',
      '--rox-radius-md: 8px',
      '--rox-gutter:',
      '--rox-elev-panel:',
    ]
    for (const token of required) {
      expect(css.includes(token), `missing ${token}`).toBe(true)
    }
  })

  it('exposes panel and rail chrome classes', () => {
    expect(css).toContain('.rox-panel')
    expect(css).toContain('.rox-rail')
    expect(css).toContain('.rox-card')
  })

  it('declares app-wide high-contrast overrides on html[data-contrast=high]', () => {
    expect(css).toContain('html[data-contrast="high"]')
    expect(css).toContain('--chrome-glass-blur: 0px')
    expect(css).toContain('html[data-contrast="high"] :focus-visible')
  })
})
