import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const renderer = join(import.meta.dir, '../../..')

describe('Issue 04 chrome hygiene', () => {
  it('keeps AppShell on StyledDropdown', () => {
    const src = readFileSync(join(renderer, 'components/app-shell/AppShell.tsx'), 'utf8')
    expect(src).toContain('StyledDropdownMenuContent')
    expect(src).not.toContain('PremiumMenu')
  })

  it('keeps BrowserTabStrip on StyledDropdown', () => {
    const src = readFileSync(join(renderer, 'components/browser/BrowserTabStrip.tsx'), 'utf8')
    expect(src).toContain('StyledDropdownMenuContent')
    expect(src).not.toContain('PremiumMenu')
  })
})
