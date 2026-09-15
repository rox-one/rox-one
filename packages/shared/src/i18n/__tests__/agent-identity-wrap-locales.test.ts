import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const DESC_KEY = 'settings.identity.nameDesc' as const
const PLACEHOLDER_KEY = 'settings.identity.namePlaceholder' as const

const DESC_EN = 'Shown as this agent on new sessions. Default is Agent Rox#001.'
const DESC_RU = 'Так агент представляется в новых сессиях. По умолчанию Агент Rox#001.'
const PLACEHOLDER_EN = 'Agent Rox#001'
const PLACEHOLDER_RU = 'Агент Rox#001'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover English Agent wrapping in ru identity copy', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[DESC_KEY]).toBe(DESC_EN)
    expect(en[PLACEHOLDER_KEY]).toBe(PLACEHOLDER_EN)
    expect(en[DESC_KEY]).toContain('Agent Rox#001')
    expect(en[PLACEHOLDER_KEY]).toBe('Agent Rox#001')
  })

  it('wraps leftover Agent as Russian around the Latin Rox identifier', () => {
    expect(ru[DESC_KEY]).toBe(DESC_RU)
    expect(ru[PLACEHOLDER_KEY]).toBe(PLACEHOLDER_RU)
    expect(ru[DESC_KEY]).not.toMatch(/\bAgent\b/)
    expect(ru[PLACEHOLDER_KEY]).not.toMatch(/\bAgent\b/)
    expect(ru[DESC_KEY]).toContain('Агент Rox#001')
    expect(ru[PLACEHOLDER_KEY]).toBe('Агент Rox#001')
    expect(ru[DESC_KEY]).toContain('Rox')
    expect(ru[PLACEHOLDER_KEY]).toContain('Rox')
    expect(ru[DESC_KEY]).not.toBe(en[DESC_KEY])
    expect(ru[PLACEHOLDER_KEY]).not.toBe(en[PLACEHOLDER_KEY])
  })

  it("resolves Russian through setupI18n without leftover English Agent", async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(DESC_KEY)).toBe(DESC_RU)
    expect(i18n.t(PLACEHOLDER_KEY)).toBe(PLACEHOLDER_RU)
    expect(i18n.t(DESC_KEY)).not.toBe(DESC_EN)
    expect(i18n.t(PLACEHOLDER_KEY)).not.toBe(PLACEHOLDER_EN)
    expect(i18n.t(DESC_KEY)).not.toMatch(/\bAgent\b/)
    expect(i18n.t(PLACEHOLDER_KEY)).not.toMatch(/\bAgent\b/)
    expect(i18n.t(DESC_KEY)).toContain('Rox')
    expect(i18n.t(PLACEHOLDER_KEY)).toContain('Rox')
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(DESC_KEY)).toBe(DESC_EN)
    expect(i18n.t(PLACEHOLDER_KEY)).toBe(PLACEHOLDER_EN)
    expect(i18n.t(DESC_KEY)).toContain('Agent Rox#001')
    expect(i18n.t(PLACEHOLDER_KEY)).toBe('Agent Rox#001')
  })
})
