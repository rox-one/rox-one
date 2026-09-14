import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const OPEN_COMPAT = 'knowledge.openCompat'
const SIYUAN_OPEN_COMPAT = 'siyuan.openCompat'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-183 leftover compatibility view wrapping in openCompat', () => {
  it('wraps leftover compatibility view to sibling compat-mode copy in Russian', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[OPEN_COMPAT]).toBe('Открыть режим совместимости')
    expect(ru[SIYUAN_OPEN_COMPAT]).toBe('Открыть режим совместимости SiYuan')
    expect(ru[OPEN_COMPAT]).not.toMatch(/compatibility view/i)
    expect(ru[SIYUAN_OPEN_COMPAT]).not.toMatch(/compatibility view/i)
    expect(ru[OPEN_COMPAT]).toContain('режим совместимости')
    expect(ru[SIYUAN_OPEN_COMPAT]).toContain('режим совместимости')
    expect(ru[SIYUAN_OPEN_COMPAT]).toContain('SiYuan')
    expect(ru['knowledge.surface.compatHint']).toMatch(/режим совместимости/i)
    expect(ru['knowledge.browserHint.railTooltip']).toContain('режиме совместимости')
  })

  it('keeps English compatibility view as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(OPEN_COMPAT)).toBe('Open compatibility view')
    expect(i18n.t(SIYUAN_OPEN_COMPAT)).toBe('Open SiYuan compatibility view')
    expect(i18n.t(OPEN_COMPAT)).toContain('compatibility view')
    expect(i18n.t(SIYUAN_OPEN_COMPAT)).toContain('compatibility view')
    expect(i18n.t(OPEN_COMPAT)).not.toContain('режим совместимости')
    expect(i18n.t(SIYUAN_OPEN_COMPAT)).not.toContain('режим совместимости')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(OPEN_COMPAT)).toBe('Открыть режим совместимости')
    expect(i18n.t(SIYUAN_OPEN_COMPAT)).toBe('Открыть режим совместимости SiYuan')
    expect(i18n.t(OPEN_COMPAT)).not.toMatch(/compatibility view/i)
    expect(i18n.t(SIYUAN_OPEN_COMPAT)).not.toMatch(/compatibility view/i)
    expect(i18n.t(OPEN_COMPAT)).not.toBe(i18n.t(OPEN_COMPAT, { lng: 'en' }))
    expect(i18n.t(SIYUAN_OPEN_COMPAT)).not.toBe(i18n.t(SIYUAN_OPEN_COMPAT, { lng: 'en' }))
    expect(i18n.t(OPEN_COMPAT)).not.toBe('Open compatibility view')
    expect(i18n.t(OPEN_COMPAT)).not.toBe('Открыть compatibility view')
    expect(i18n.t(SIYUAN_OPEN_COMPAT)).not.toBe('Открыть compatibility view SiYuan')
  })

  it('defines the keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      expect(locale[OPEN_COMPAT]?.length, file).toBeGreaterThan(0)
      expect(locale[SIYUAN_OPEN_COMPAT]?.length, file).toBeGreaterThan(0)
    }
  })
})
