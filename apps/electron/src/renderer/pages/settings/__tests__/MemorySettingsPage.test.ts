import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(import.meta.dir, '../MemorySettingsPage.tsx'), 'utf8')
const registry = readFileSync(join(import.meta.dir, '../../../../shared/settings-registry.ts'), 'utf8')
const pages = readFileSync(join(import.meta.dir, '../settings-pages.ts'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

describe('MemorySettingsPage (cognee PR6)', () => {
  it('is registered in settings hub', () => {
    expect(registry).toContain("id: 'memory'")
    expect(pages).toContain("lazy(() => import('./MemorySettingsPage'))")
    expect(pages).toContain('memory: MemorySettingsPage')
  })

  it('uses SettingsToggle and t() keys (no leftover English chrome)', () => {
    expect(page).toContain('SettingsToggle')
    expect(page).toContain("t('settings.memory.title')")
    expect(page).toContain("t('settings.memory.graph')")
    expect(page).not.toContain('<select')
    expect(page).not.toMatch(/defaultValue:\s*['"]/)
  })

  it('has ru/en locale keys for title and sources', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8'))
    const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8'))
    expect(ru['settings.memory.title']).toBe('Память')
    expect(en['settings.memory.title']).toBe('Memory')
    expect(ru['settings.memory.source.mail']).toBe('Почта')
    expect(en['settings.memory.source.lessons']).toBe('Lessons')
  })
})
