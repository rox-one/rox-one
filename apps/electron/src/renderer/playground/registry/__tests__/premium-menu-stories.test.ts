import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const stories = readFileSync(join(import.meta.dir, '..', 'premium-menu.tsx'), 'utf8')

describe('premium menu playground stories', () => {
  it('ships 5 / 50 / 1000 item stories plus narrow and typeahead', () => {
    expect(stories).toContain("id: 'premium-menu-5'")
    expect(stories).toContain("id: 'premium-menu-50'")
    expect(stories).toContain("id: 'premium-menu-1000'")
    expect(stories).toContain("id: 'premium-menu-narrow'")
    expect(stories).toContain("id: 'premium-menu-typeahead'")
    expect(stories).toContain('count: 1000')
    expect(stories).toContain('selectedIndex: 42')
    expect(stories).toContain('narrow: true')
    expect(stories).toContain('searchable: false')
    expect(stories).toContain('PremiumMenuSelect')
  })
})
