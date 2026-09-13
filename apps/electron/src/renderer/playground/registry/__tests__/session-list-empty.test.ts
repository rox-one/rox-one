import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const playground = join(import.meta.dir, '..')

describe('session list empty playground', () => {
  it('uses session i18n keys instead of English leaks', () => {
    const source = readFileSync(join(playground, 'session-list.tsx'), 'utf8')
    expect(source).toContain("t('session.noSessionsFound')")
    expect(source).toContain("t('session.noSessionsFoundDesc')")
    expect(source).toContain("t('session.clearSearch')")
    expect(source).toContain("t('common.today')")
    expect(source).not.toContain('No conversations found')
    expect(source).not.toContain('Clear search')
  })
})

describe('playground preset theme mocks', () => {
  it('returns named preset themes so Appearance does not fall back to Select…', () => {
    const source = readFileSync(join(playground, '../mock-utils.ts'), 'utf8')
    expect(source).toContain("id: 'pierre'")
    expect(source).toContain("theme: { name: 'Pierre' }")
    expect(source).not.toContain('loadPresetThemes: async () => []')
  })
})
