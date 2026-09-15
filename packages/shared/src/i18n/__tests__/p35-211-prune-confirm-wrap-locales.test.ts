import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'skills.pruneConfirm' as const

const EN_VALUE = 'Archive {{count}} never-used skills?'
const RU_VALUE = 'Архивировать {{count}} неиспользуемых навыков?'
const RU_LEFTOVER = 'Архивировать {{count}} неиспользуемых скиллов?'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover Russian скилл wrapping in ru skills.pruneConfirm', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('{{count}}')
    expect(en[KEY]).toContain('skill')
  })

  it('wraps leftover скилл as sibling навык on the same family', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toBe(RU_LEFTOVER)
    expect(ru[KEY]).not.toContain('скилл')
    expect(ru[KEY]).toContain('навык')
    expect(ru[KEY]).toContain('{{count}}')
    expect(ru[KEY]).not.toBe(en[KEY])
  })

  it("resolves Russian through setupI18n without leftover calque скилл", async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY, { count: 3 })).toBe('Архивировать 3 неиспользуемых навыков?')
    expect(i18n.t(KEY)).not.toContain('скилл')
    expect(i18n.t(KEY)).toContain('навык')
    expect(i18n.t(KEY)).toContain('{{count}}')
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY, { count: 3 })).toBe('Archive 3 never-used skills?')
    expect(i18n.t(KEY)).toContain('skill')
    expect(i18n.t(KEY)).not.toContain('навык')
    expect(i18n.t(KEY)).toContain('{{count}}')
  })
})
