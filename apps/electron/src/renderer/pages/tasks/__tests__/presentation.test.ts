import { describe, expect, it } from 'bun:test'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import { clearTaskDraftField, parseTaskTagDraft, type TaskDrafts } from '../drafts'
import { parseTaskImport, taskDateFromInput, taskDateInputValue } from '../presentation'

describe('task editing drafts', () => {
  it('parses tags at commit time without losing a delimiter while the user is typing', () => {
    const draft = { tags: 'alpha, ' }
    expect(parseTaskTagDraft(draft.tags)).toEqual(['alpha'])
    expect(draft.tags).toBe('alpha, ')
    expect(parseTaskTagDraft('alpha, beta')).toEqual(['alpha', 'beta'])
    expect(parseTaskTagDraft('alpha, , beta,alpha,')).toEqual(['alpha', 'beta'])
    expect(parseTaskTagDraft('')).toEqual([])
  })

  it('clears a saved field while retaining other tasks, links and unsaved text', () => {
    const drafts: TaskDrafts = {
      first: { notes: 'written note', tags: 'alpha, ', linkId: 'note-123', linkKind: 'note' },
      second: { notes: 'another task' },
    }
    const next = clearTaskDraftField(drafts, 'first', 'notes', 'written note')
    expect(next.first).toEqual({ tags: 'alpha, ', linkId: 'note-123', linkKind: 'note' })
    expect(next.second).toBe(drafts.second)
    expect(drafts.first?.notes).toBe('written note')
  })

  it('keeps text edited after the submitted value and removes only empty draft entries', () => {
    const edited = { first: { notes: 'newer note' } }
    expect(clearTaskDraftField(edited, 'first', 'notes', 'old note')).toBe(edited)
    expect(clearTaskDraftField(edited, 'first', 'notes', 'newer note')).toEqual({})
  })
})

describe('task dates and import validation', () => {
  it('round-trips a local calendar day across negative and positive timezone offsets', () => {
    const previous = process.env.TZ
    try {
      for (const timezone of ['America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = timezone
        const timestamp = taskDateFromInput('2026-09-14')
        expect(timestamp).toBe(new Date(2026, 8, 14).getTime())
        expect(taskDateInputValue(timestamp)).toBe('2026-09-14')
        expect(taskDateInputValue(new Date(2026, 8, 14, 23, 59).getTime())).toBe('2026-09-14')
      }
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('rejects invalid dates and preserves empty date controls', () => {
    for (const value of ['', '2026-02-30', '2026-13-01', 'x', '2026-1-2']) expect(taskDateFromInput(value)).toBeUndefined()
    expect(taskDateInputValue(undefined)).toBe('')
    expect(taskDateInputValue(Number.NaN)).toBe('')
    expect(taskDateInputValue(taskDateFromInput('2024-02-29'))).toBe('2024-02-29')
  })

  it('accepts an exported task bundle without dropping task properties', () => {
    const store = new PersonalTaskStore()
    store.create({ title: 'Review', notes: 'Keep me', tags: ['test'], links: [{ kind: 'note', id: 'note-1' }], priority: 'high' })
    expect(parseTaskImport(store.exportJson())?.snapshot()).toEqual(store.snapshot())
  })

  it('rejects malformed and duplicate task rows before rendering or merging them', () => {
    const store = new PersonalTaskStore()
    const task = store.create({ title: 'Valid task' })
    for (const rows of [[null], [{ ...task, notes: null }], [{ ...task, tags: ['ok', 3] }], [{ ...task, links: [null] }], [{ ...task, list: 'unknown' }], [task, task]]) {
      expect(parseTaskImport(JSON.stringify({ ...store.snapshot(), tasks: rows }))).toBeNull()
    }
    expect(parseTaskImport('{broken')).toBeNull()
    expect(parseTaskImport(JSON.stringify({ version: 99, tasks: [] }))).toBeNull()
  })
})
