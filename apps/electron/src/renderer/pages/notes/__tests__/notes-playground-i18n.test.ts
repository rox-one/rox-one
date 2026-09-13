import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const notes = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const planner = readFileSync(
  join(import.meta.dir, '../../../playground/registry/planner.tsx'),
  'utf8',
)
const chat = readFileSync(
  join(import.meta.dir, '../../../playground/registry/chat.tsx'),
  'utf8',
)
const en = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales/en.json'), 'utf8'),
) as Record<string, string>
const ru = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales/ru.json'), 'utf8'),
) as Record<string, string>

describe('notes and playground leftover chrome is i18n', () => {
  it('folder create uses notes.untitled instead of hardcoded English', () => {
    expect(notes).toContain("t('notes.untitled')")
    expect(notes).not.toContain("createNote(activeWorkspaceId, 'Untitled'")
  })

  it('playground planner and chat placeholders go through t()', () => {
    expect(planner).toContain("t('playground.planner.addNotes')")
    expect(planner).not.toContain('placeholder="Add notes..."')
    expect(chat).toContain("t('playground.chat.messagePlaceholder')")
    expect(chat).not.toContain("placeholder=\"Message Craft Agent...\"")
    expect(chat).not.toContain("defaultValue: 'Message Craft Agent...'")
  })

  it('keeps Russian copy distinct from English', () => {
    expect(en['notes.untitled']).toBe('Untitled')
    expect(ru['notes.untitled']).toBe('Без названия')
    expect(ru['playground.planner.addNotes']).toBe('Добавить заметки...')
    expect(ru['playground.chat.messagePlaceholder']).toBe('Сообщение агенту...')
    for (const key of ['notes.untitled', 'playground.planner.addNotes', 'playground.chat.messagePlaceholder']) {
      expect(ru[key], key).not.toBe(en[key])
    }
  })
})
