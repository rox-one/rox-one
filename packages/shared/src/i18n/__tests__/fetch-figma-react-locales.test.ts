import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'hints.fetchFigmaDesigns' as const

const EN = 'Fetch {source:Figma} designs and generate React components in your {folder}'
const RU = 'Забери дизайны из {source:Figma} и сгенерируй компоненты React в {folder}'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover React hyphen wrapping in Figma hint copy', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN)
    expect(en[KEY]).toContain('React components')
  })

  it('wraps leftover React-компоненты as компоненты React and keeps React Latin', () => {
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).not.toContain('React-компоненты')
    expect(ru[KEY]).not.toContain('components')
    expect(ru[KEY]).toContain('компоненты')
    expect(ru[KEY]).toContain('React')
    expect(ru[KEY]).toContain('{source:Figma}')
    expect(ru[KEY]).not.toBe(en[KEY])
  })

  it('resolves Russian through setupI18n without leftover English hyphen mix', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toBe(EN)
    expect(i18n.t(KEY)).not.toContain('React-компоненты')
    expect(i18n.t(KEY)).not.toContain('components')
    expect(i18n.t(KEY)).toContain('React')
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('React components')
  })
})
