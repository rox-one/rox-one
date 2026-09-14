import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const MAP_KEY = 'collection.bulk.map'
const MAP_FAILED_KEY = 'collection.bulk.mapFailed'
const LEFTOVER_MAP_REDUCE = 'Map → Reduce'
const LEFTOVER_MAP_FAILED = 'Map не выполнен'

describe('collection.bulk.map leftover English (P35-113)', () => {
  it('Russian copy is not leftover Map → Reduce / Map не выполнен', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const map = i18n.t(MAP_KEY)
    const mapFailed = i18n.t(MAP_FAILED_KEY)
    expect(map).toBe('Сбор → свёртка')
    expect(mapFailed).toBe('Сбор не выполнен: {{message}}')
    expect(map).not.toBe(LEFTOVER_MAP_REDUCE)
    expect(map).not.toContain('Map')
    expect(mapFailed).not.toContain(LEFTOVER_MAP_FAILED)
    expect(mapFailed).not.toMatch(/\bMap\b/)
  })

  it('English locale still uses Map → Reduce / Map failed', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(MAP_KEY)).toBe(LEFTOVER_MAP_REDUCE)
    expect(i18n.t(MAP_FAILED_KEY)).toBe('Map failed: {{message}}')
  })
})
