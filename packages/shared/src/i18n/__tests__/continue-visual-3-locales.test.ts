import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'apiSetup.noModelsFound',
  'chat.shareSession',
  'chat.sharedSessionOptions',
  'commands.noCommands',
  'common.next',
  'common.pageOf',
  'common.previous',
  'common.totalCount',
  'notes.empty.loading',
  'notes.empty.noNote',
  'notes.empty.noNoteHint',
  'notes.empty.selectWorkspace',
  'notes.menu.copyLink',
  'notes.menu.newInFolder',
  'notes.menu.reveal',
  'notes.save.autosaveHint',
  'notes.save.failed',
  'notes.slash.group.format',
  'notes.slash.heading1',
  'notes.slash.text',
  'notes.toolbar.attachAsset',
  'notes.toolbar.previousDaily',
  'settings.server.notConfigured',
  'sidebar.noMatches',
  'skillsList.noMatching',
  'sourcesList.noMatching',
  'status.noneFound',
]

describe('continue-visual-3 leftover chrome locales', () => {
  it('keeps Russian copy distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBeTruthy()
      expect(ru[key], key).toBeTruthy()
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['notes.empty.noNote']).toBe('Заметка не выбрана')
    expect(ru['notes.toolbar.previousDaily']).toBe('Предыдущая дневная заметка')
    expect(ru['commands.noCommands']).toBe('Команды не найдены')
    expect(ru['sidebar.noMatches']).toBe('Нет совпадений')
    expect(ru['settings.server.notConfigured']).toBe('Не настроено')
    expect(ru['notes.slash.heading1']).toBe('Заголовок 1')
    expect(ru['common.pageOf']).toBe('Страница {{page}} из {{total}}')
  })
})
