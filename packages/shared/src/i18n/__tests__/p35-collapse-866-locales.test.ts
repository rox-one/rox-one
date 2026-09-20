import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const localesDirectory = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDirectory, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDirectory, 'ru.json'), 'utf8')) as Record<string, string>

function interpolationVars(value: string): string[] {
  return (value.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.replace(/[{}]/g, '')).sort()
}

/** Collapsed leftover wraps from open fix(i18n) drafts #866–#872. One assertion map, not 7 PRs. */
const WRAPPED_RU: Record<string, string> = {
  'meetings.archiveDenied': 'Импорт заблокирован: нужно разрешение архива',
  'meetings.capabilityDenied': 'Захват заблокирован: нужно разрешение микрофона',
  'meetings.grantRequired': 'Применение заблокировано: нужно разрешение',
  'mindmap.enrichDraftBanner': 'Предпросмотр улучшенной карты — принять (закрепить) или отменить.',
  'settings.appearance.conationShellDesc':
    'Необязательные панели данных Conation в Rox. Все выключены по умолчанию; режима Timeline нет.',
  'settings.cloudRuns.webhookHint': 'Необязательный URL — POST при завершении запуска (уведомления вне приложения)',
  'settings.runtime.llmConnectionsDesc': 'Подключения, модели и поставщики настраиваются в настройках ИИ.',
}

const LEFTOVER: Record<string, string> = {
  'meetings.archiveDenied': 'грант',
  'meetings.capabilityDenied': 'грант',
  'meetings.grantRequired': 'грант',
  'mindmap.enrichDraftBanner': 'превью',
  'settings.appearance.conationShellDesc': 'опциональн',
  'settings.cloudRuns.webhookHint': 'опциональн',
  'settings.runtime.llmConnectionsDesc': 'провайдер',
}

describe('P35 leftover wrap collapse #866-#872', () => {
  it('applies every unique leftover wrap on current Russian catalog keys', () => {
    const keys = Object.keys(WRAPPED_RU)
    expect(keys).toHaveLength(7)
    expect(keys).toEqual([...keys].sort())

    for (const key of keys) {
      expect(en[key], key).toBeTruthy()
      expect(ru[key], key).toBe(WRAPPED_RU[key])
      expect(ru[key], key).not.toBe(en[key])
      expect(interpolationVars(ru[key]!), `${key} interpolation`).toEqual(interpolationVars(en[key]!))
      expect(ru[key]!.toLowerCase(), key).not.toContain(LEFTOVER[key]!)
    }
  })

  it('does not drop #848/#840/#828/#827/#526 connection and settings loadConfig keys', () => {
    for (const key of [
      'connections.create',
      'connections.grant',
      'settings.cloudRuns.loadConfig',
      'settings.messaging.loadConfig',
      'settings.server.loadConfig',
    ]) {
      expect(ru[key], key).toBeTruthy()
      expect(en[key], key).toBeTruthy()
    }
  })
})
