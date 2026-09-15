import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.input.sttCloudRoxDesc' as const
const FISH = 'settings.input.ttsFishSpeech' as const

const EN = 'Sends audio to Rox speech. Retention is shown before use.'
const RU = 'Аудио уходит в облачную речь Rox. Политика хранения видна до использования.'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover Rox Speech wrapping in STT cloud copy', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN)
    expect(en[KEY]).toContain('Rox speech')
    expect(en[FISH]).toBe('Fish Speech (local)')
  })

  it('wraps leftover Speech as речь and keeps Rox', () => {
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).not.toContain('Speech')
    expect(ru[KEY]).not.toContain('speech')
    expect(ru[KEY]).toContain('Rox')
    expect(ru[KEY]).toMatch(/речь/i)
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru[FISH]).toBe('Fish Speech (локально)')
  })

  it('resolves Russian through setupI18n without leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toBe(EN)
    expect(i18n.t(KEY)).not.toContain('Speech')
    expect(i18n.t(KEY)).not.toContain('speech')
    expect(i18n.t(FISH)).toContain('Fish Speech')
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('Rox speech')
    expect(i18n.t(FISH)).toBe('Fish Speech (local)')
  })
})
