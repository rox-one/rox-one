import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dailySessionsFor } from '../notes/daily-sessions'

const at = (hour: number, day = 14) => new Date(2026, 9, day, hour).getTime()

describe('daily note sessions overlay', () => {
  test('lists that local day\'s sessions in creation order with readable names', () => {
    expect(dailySessionsFor([
      { id: 'other-ws', workspaceId: 'w2', name: 'чужой', createdAt: at(10) },
      { id: 'b', workspaceId: 'w1', name: '  Второй \n чат ', createdAt: at(15) },
      { id: 'a', workspaceId: 'w1', name: 'Давайте познакомимся', createdAt: at(9) },
      { id: 'c', workspaceId: 'w1', preview: 'по превью', lastMessageAt: at(20) },
      { id: 'other-day', workspaceId: 'w1', name: 'вчера', createdAt: at(12, 13) },
      { id: 'no-time', workspaceId: 'w1', name: 'без даты' },
      { id: 'hidden', workspaceId: 'w1', name: 'скрытая', createdAt: at(10), hidden: true },
      { id: 'archived', workspaceId: 'w1', name: 'архив', createdAt: at(11), isArchived: true },
    ], '2026-10-14', 'w1')).toEqual([
      { id: 'a', name: 'Давайте познакомимся' },
      { id: 'b', name: 'Второй чат' },
      { id: 'c', name: 'по превью' },
    ])
  })

  test('shows nothing without an active workspace', () => {
    expect(dailySessionsFor([{ id: 's', workspaceId: 'w1', createdAt: at(8) }], '2026-10-14', null)).toEqual([])
  })

  test('falls back to the id when a session has no name or preview', () => {
    expect(dailySessionsFor([{ id: 's1', workspaceId: 'w1', name: ' ', createdAt: at(8) }], '2026-10-14', 'w1')).toEqual([{ id: 's1', name: 's1' }])
  })

  test('the page renders the overlay from live session state, not from the note body', () => {
    const page = readFileSync(join(import.meta.dir, '../NotesPage.tsx'), 'utf8')
    expect(page).toContain('dailySessionsFor(sessionMetaMap.values(), dailyDate, activeWorkspaceId)')
    expect(page).toContain('data-testid="notes-daily-sessions"')
  })

  test('opening the daily note re-reads an already-open clean copy after cleanup', () => {
    const page = readFileSync(join(import.meta.dir, '../NotesPage.tsx'), 'utf8')
    const handler = page.slice(page.indexOf('const handleDaily = async'), page.indexOf('const handleDailyShift'))
    expect(handler.indexOf('getDailyNote')).toBeLessThan(handler.indexOf('await openNote(note.id)'))
    expect(handler).toContain('activeNoteIdRef.current === note.id && !dirtyRef.current')
  })
})
