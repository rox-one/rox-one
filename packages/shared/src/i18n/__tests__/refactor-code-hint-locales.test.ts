import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'hints.refactorCode' as const

const EN = 'Refactor code in your {folder}, then push to {source:GitHub}'
const RU = 'Переработай код в {folder}, затем отправь в {source:GitHub}'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover English-mixed verbs wrapping in refactor GitHub hint copy', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN)
    expect(en[KEY]).toContain('Refactor')
    expect(en[KEY]).toContain('push')
    expect(en[KEY]).toContain('GitHub')
  })

  it('wraps leftover Отрефактори/запушь as proper Russian around Latin GitHub', () => {
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).not.toContain('Отрефактори')
    expect(ru[KEY]).not.toContain('запушь')
    expect(ru[KEY]).not.toContain('Refactor')
    expect(ru[KEY]).not.toContain('push')
    expect(ru[KEY]).toContain('Переработай')
    expect(ru[KEY]).toContain('отправь')
    expect(ru[KEY]).toContain('{source:GitHub}')
    expect(ru[KEY]).not.toBe(en[KEY])
  })

  it('resolves Russian through setupI18n without leftover English-mixed verbs', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toBe(EN)
    expect(i18n.t(KEY)).not.toContain('Отрефактори')
    expect(i18n.t(KEY)).not.toContain('запушь')
    expect(i18n.t(KEY)).not.toContain('Refactor')
    expect(i18n.t(KEY)).toContain('GitHub')
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('Refactor')
    expect(i18n.t(KEY)).toContain('push to {source:GitHub}')
  })
})
