import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'workspace.connectRemote',
  'workspace.reconnectHint',
  'workspace.serverUrl',
  'workspace.tokenLabel',
  'workspace.testConnection',
  'workspace.createAndConnect',
  'workspace.createOnServer',
  'kanban.editorFailed',
  'kanban.boardFailed',
  'ssh.placeholder.label',
  'automations.cronCommonSchedules',
  'automations.cronPresetEveryMinute',
  'automations.cronEveryMinute',
  'common.enterValue',
  'common.minutesAgoShort',
  'labels.numberPlaceholder',
  'labels.urlPlaceholder',
  'labels.valuePlaceholder',
]

describe('finish-visual leftover chrome locales', () => {
  it('keeps Russian copy distinct from English for leftover chrome', () => {
    for (const key of keys) {
      expect(en[key], key).toBeTruthy()
      expect(ru[key], key).toBeTruthy()
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['workspace.connectRemote']).toBe('Подключиться к удалённому серверу')
    expect(ru['kanban.backToBoard']).toBe('Назад к доске')
    expect(ru['automations.cronCommonSchedules']).toBe('Готовые расписания')
    expect(ru['labels.numberPlaceholder']).toBe('Введите число…')
  })
})
