import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'settings.knowledge.baseUrlHint',
  'settings.knowledge.metrics.automationRuns',
  'settings.knowledge.metrics.g1Note',
  'settings.knowledge.mode.externalLocal',
  'settings.knowledge.mode.managed',
  'settings.knowledge.mode.remote',
] as const

const EN: Record<(typeof keys)[number], string> = {
  'settings.knowledge.baseUrlHint': 'SiYuan kernel API address (external-local mode).',
  'settings.knowledge.metrics.automationRuns': 'Automation cloud runs',
  'settings.knowledge.metrics.g1Note':
    'G1 gate: thresholds TBD — managed kernel blocked until production data + G2 legal decision.',
  'settings.knowledge.mode.externalLocal': 'External-local',
  'settings.knowledge.mode.managed': 'Managed',
  'settings.knowledge.mode.remote': 'Remote',
}

const RU: Record<(typeof keys)[number], string> = {
  'settings.knowledge.baseUrlHint': 'Адрес API ядра SiYuan (режим «Внешний локальный»).',
  'settings.knowledge.metrics.automationRuns': 'Облачные запуски автоматизации',
  'settings.knowledge.metrics.g1Note':
    'Шлюз G1: пороги пока не заданы — управляемое ядро заблокировано до продакшен-данных и юридического решения G2.',
  'settings.knowledge.mode.externalLocal': 'Внешний локальный',
  'settings.knowledge.mode.managed': 'Управляемый',
  'settings.knowledge.mode.remote': 'Удалённый',
}

describe('knowledge mode leftover chrome locales', () => {
  it('keeps Russian copy distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBe(EN[key])
      expect(ru[key], key).toBe(RU[key])
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['settings.knowledge.mode.externalLocal']).toBe('Внешний локальный')
    expect(ru['settings.knowledge.mode.managed']).toBe('Управляемый')
    expect(ru['settings.knowledge.mode.remote']).toBe('Удалённый')
    expect(ru['settings.knowledge.baseUrlHint']).not.toContain('external-local')
    expect(ru['settings.knowledge.metrics.g1Note']).not.toContain('TBD')
    expect(ru['settings.knowledge.metrics.g1Note']).not.toContain('managed-')
    expect(ru['settings.knowledge.metrics.automationRuns']).not.toContain('Cloud-')
  })

  it('setupI18n ru is not English; en stays English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(RU[key])
      expect(i18n.t(key)).not.toBe(EN[key])
    }
    expect(i18n.t('settings.knowledge.mode.externalLocal')).not.toContain('OMP')
    expect(i18n.t('settings.knowledge.mode.managed')).not.toContain('Craft Agents')

    await setupI18n().changeLanguage('en')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(EN[key])
    }
  })
})
