import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import { defaultNoteCommands } from '../document-ia'

const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')
const source = readFileSync(join(import.meta.dir, '../document-ia.ts'), 'utf8')

const AUTHORING_KEYS = [
  'notes.authoring.newSession',
  'notes.authoring.askAgent',
  'notes.authoring.newTask',
  'notes.authoring.columns2',
  'notes.authoring.columns3',
] as const

function bangLabels(catalog = defaultNoteCommands({
  sessions: [],
  agents: [],
  projects: [],
  tasks: [],
  people: [],
  entities: [],
})) {
  return catalog.filter((item) => item.kind === 'bang').map((item) => item.label)
}

describe('document-ia bang labels are i18n', () => {
  it('resolves bang labels via existing notes.authoring keys', () => {
    expect(source).toContain("i18n.t('notes.authoring.newSession')")
    expect(source).toContain("i18n.t('notes.authoring.askAgent')")
    expect(source).toContain("i18n.t('notes.authoring.newTask')")
    expect(source).toContain("i18n.t('notes.authoring.columns2')")
    expect(source).toContain("i18n.t('notes.authoring.columns3')")
    expect(source).not.toContain("label: 'New session'")
    expect(source).not.toContain("label: 'Ask agent'")
    expect(source).not.toContain("label: 'Create task'")
    expect(source).not.toContain("label: 'Two columns'")
    expect(source).not.toContain("label: 'Three columns'")
  })

  it('English locale keeps the existing bang labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(bangLabels()).toEqual([
      'New session',
      'Ask agent',
      'Create task',
      'Two columns',
      'Three columns',
    ])
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('notes.authoring.newSession')).toBe('Новая сессия')
    expect(i18n.t('notes.authoring.askAgent')).toBe('Спросить агента')
    expect(bangLabels()).toEqual([
      'Новая сессия',
      'Спросить агента',
      'Создать задачу',
      'Две колонки',
      'Три колонки',
    ])
    expect(i18n.t('notes.authoring.newSession')).not.toBe('New session')
  })

  it('all 12 locales already define the wired authoring keys', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of AUTHORING_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
