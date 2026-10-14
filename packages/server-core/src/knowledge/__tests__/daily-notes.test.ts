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
  planDailyNoteWrite,
  stripLegacySessionsBlock,
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

  test('notes RPC seeds daily notes from install day and today without storing sessions', () => {
    // Sessions are a live overlay in the Notes view (pages/notes/daily-sessions.ts);
    // writing them into the body moved the revision under an open editor.
    const source = readFileSync(join(import.meta.dir, '../../handlers/rpc/notes.ts'), 'utf8')
    expect(source).toContain('ensureDailyNotes')
    expect(source).toContain('INSTALL_DAY_FILE')
    expect(source).toContain('planDailyNoteWrite')
    expect(source).not.toContain('sessionsFromDeps')
    expect(source).not.toContain('mergeSessionsBlock')
  })
})

describe('planDailyNoteWrite', () => {
  test('creates a missing note from the template without a stored sessions block', () => {
    const created = planDailyNoteWrite({ date: '2026-10-14', existing: null, template: '' })
    expect(created).toContain('# 2026-10-14')
    expect(created).not.toContain(DAILY_SESSIONS_START)
  })

  test('never rewrites an existing (possibly open) note, so its revision stays put', () => {
    const existing = buildDailyNoteMarkdown({ date: '2026-10-14' })
    expect(planDailyNoteWrite({ date: '2026-10-14', existing })).toBeNull()
    expect(planDailyNoteWrite({ date: '2026-10-14', existing: `${existing}\nmy edits` })).toBeNull()
  })
})

describe('stripLegacySessionsBlock', () => {
  test('drops the stored block and its heading, keeping user text around it', () => {
    const legacy = buildDailyNoteMarkdown({ date: '2026-10-14', sessions: [{ id: 's', name: 'Старая', createdAt: new Date(2026, 9, 14, 9).getTime() }] })
    const withEdits = `${legacy}\nмои заметки\n`
    const cleaned = stripLegacySessionsBlock(withEdits)!
    expect(cleaned).not.toContain(DAILY_SESSIONS_START)
    expect(cleaned).not.toContain('## Sessions')
    expect(cleaned).not.toContain('Старая')
    expect(cleaned).toContain('# 2026-10-14')
    expect(cleaned).toContain('мои заметки')
    expect(stripLegacySessionsBlock(cleaned)).toBeNull()
  })

  test('keeps user lines written inside the block, and the heading above them', () => {
    const note = `# 2026-10-14\n\n## Sessions\n\n${DAILY_SESSIONS_START}\n- Давайте познакомимся\n- [ ] позвонить\nсвоя мысль\n- [[Проект]]\n- [док](https://example.com)\n${DAILY_SESSIONS_END}\n\nниже\n`
    expect(stripLegacySessionsBlock(note)).toBe('# 2026-10-14\n\n## Sessions\n\n- [ ] позвонить\nсвоя мысль\n- [[Проект]]\n- [док](https://example.com)\n\nниже\n')
  })

  test('is a no-op for notes without a complete block', () => {
    expect(stripLegacySessionsBlock('# 2026-10-14\n')).toBeNull()
    expect(stripLegacySessionsBlock(`x\n${DAILY_SESSIONS_START}\nno end`)).toBeNull()
  })

  test('only the explicit open path cleans up, with the current revision', () => {
    const source = readFileSync(join(import.meta.dir, '../../handlers/rpc/notes.ts'), 'utf8')
    expect(source).toContain("expectedRevision: markdownRevision(existing), content: cleaned")
    expect(source).toMatch(/upsertDailyNote\(notesRoot, date \|\| formatDateId\(new Date\(\)\), [^\n]*, true, /)
    expect(source).toContain('await upsertDailyNote(notesRoot, date, writeNative)\n')
    // Open copies everywhere are told to re-read (editors ignore 'save' events).
    const start = source.indexOf('RPC_CHANNELS.notes.GET_DAILY_NOTE, async')
    const handler = source.slice(start, source.indexOf('RPC_CHANNELS.notes.IMPORT_ASSET', start))
    expect(handler).toContain("if (cleaned) changed({ workspaceId, reason: 'external', noteId: id })")
    expect(handler.indexOf("reason: 'external'")).toBeLessThan(handler.indexOf('return readNote(notesRoot, id)'))
  })
})
