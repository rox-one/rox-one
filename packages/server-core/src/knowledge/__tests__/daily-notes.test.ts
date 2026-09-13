import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertDailyDate,
  buildDailyNoteMarkdown,
  DAILY_SESSIONS_END,
  DAILY_SESSIONS_START,
  DAILY_TAG,
  datesToEnsure,
  dailyNoteId,
  ensureDailyTag,
  formatDateId,
  mergeSessionsBlock,
  sessionFallsOnDate,
  sessionsForDate,
} from '../daily-notes'

describe('daily notes', () => {
  test('auto-creates install day and today (deduped)', () => {
    expect(datesToEnsure('2026-09-01', '2026-09-13')).toEqual(['2026-09-01', '2026-09-13'])
    expect(datesToEnsure('2026-09-13', '2026-09-13')).toEqual(['2026-09-13'])
    expect(dailyNoteId('2026-09-13')).toBe('daily/2026-09-13')
    expect(assertDailyDate(undefined, new Date('2026-09-13T15:00:00'))).toBe(formatDateId(new Date('2026-09-13T15:00:00')))
  })

  test('pulls that day\'s sessions and auto-tags', () => {
    const day = formatDateId(new Date('2026-09-13T12:00:00'))
    const sessions = [
      { id: 's-today', name: 'Ship notes', createdAt: new Date('2026-09-13T09:00:00').getTime() },
      { id: 's-other', name: 'Prior day planning', createdAt: new Date('2026-09-12T09:00:00').getTime() },
    ]
    expect(sessionsForDate(sessions, day).map((item) => item.id)).toEqual(['s-today'])
    expect(sessionFallsOnDate(sessions[1]!, day)).toBe(false)
    expect(ensureDailyTag(['journal'])).toEqual(['journal', DAILY_TAG])

    const markdown = buildDailyNoteMarkdown({ date: day, sessions })
    expect(markdown).toContain(`tags:\n  - ${DAILY_TAG}`)
    expect(markdown).toContain('# ' + day)
    expect(markdown).toContain('Ship notes')
    expect(markdown).not.toContain('Prior day planning')
    expect(markdown).toContain(DAILY_SESSIONS_START)
    expect(markdown).toContain(DAILY_SESSIONS_END)
  })

  test('merges session block without duplicating it', () => {
    const first = mergeSessionsBlock('# 2026-09-13\n', [{ id: 'a', name: 'Alpha' }])
    const second = mergeSessionsBlock(first, [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }])
    expect(second.split(DAILY_SESSIONS_START).length).toBe(2)
    expect(second).toContain('Beta')
    expect(second.match(/## Sessions/g)?.length).toBe(1)
  })

  test('notes RPC seeds daily notes from install day, today, and sessions', () => {
    const source = readFileSync(join(import.meta.dir, '../../handlers/rpc/notes.ts'), 'utf8')
    expect(source).toContain('ensureDailyNotes')
    expect(source).toContain('sessionsFromDeps')
    expect(source).toContain('INSTALL_DAY_FILE')
  })
})
