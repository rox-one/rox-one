import { describe, expect, test } from 'bun:test'
import {
  addManualNote,
  applyMeetingSummary,
  createMeeting,
  correctSegment,
  deleteMeeting,
  encodeMeetingCursor,
  getMeeting,
  listMeetings,
  setMeetingLifecycle,
  type MeetingQueryRecord,
} from '../queries.ts'

const actor = { workspaceId: 'ws-a', allowed: true }

function meeting(partial: Partial<MeetingQueryRecord> & Pick<MeetingQueryRecord, 'id'>): MeetingQueryRecord {
  return {
    workspaceId: 'ws-a',
    title: partial.title ?? partial.id,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

describe('meeting queries (issue 368)', () => {
  test('pagination returns a cursor and a stale cursor is rejected', () => {
    const meetings = [
      meeting({ id: 'm1', title: 'Alpha', updatedAt: 3 }),
      meeting({ id: 'm2', title: 'Beta', updatedAt: 2 }),
      meeting({ id: 'm3', title: 'Gamma', updatedAt: 1 }),
    ]
    const first = listMeetings({ meetings, actor, limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual(['m1', 'm2'])
    expect(first.nextCursor).toBe(encodeMeetingCursor(first.items[1]!))
    const second = listMeetings({ meetings, actor, limit: 2, cursor: first.nextCursor })
    expect(second.items.map((item) => item.id)).toEqual(['m3'])
    expect(second.nextCursor).toBeUndefined()
    expect(() => listMeetings({
      meetings,
      actor,
      limit: 2,
      cursor: encodeMeetingCursor({ id: 'gone', updatedAt: 9 }),
    })).toThrow('stale-cursor')
  })

  test('denied is distinct from an empty archive', () => {
    expect(listMeetings({ meetings: [], actor, limit: 10 }).state).toBe('empty')
    expect(listMeetings({
      meetings: [meeting({ id: 'm1' })],
      actor: { workspaceId: 'ws-a', allowed: false },
      limit: 10,
    })).toEqual({ items: [], state: 'denied' })
    expect(getMeeting([meeting({ id: 'm1' })], 'm1', { workspaceId: 'ws-a', allowed: false }).state).toBe('denied')
  })

  test('private sources are not searchable', () => {
    const meetings = [meeting({
      id: 'm1',
      title: 'Standup',
      sources: [
        { id: 'public', text: 'roadmap' },
        { id: 'secret', private: true, text: 'salary-band' },
      ],
    })]
    expect(listMeetings({ meetings, actor, query: 'standup', limit: 10 }).items).toHaveLength(1)
    expect(listMeetings({ meetings, actor, query: 'roadmap', limit: 10 }).items).toHaveLength(1)
    expect(listMeetings({ meetings, actor, query: 'salary-band', limit: 10 }).items).toHaveLength(0)
    expect(listMeetings({ meetings, actor, query: 'salary-band', limit: 10 }).state).toBe('empty')
  })

  test('delete tombstones a meeting instead of looking like an empty archive', () => {
    const meetings = [meeting({ id: 'm1', title: 'Keep' }), meeting({ id: 'm2', title: 'Drop' })]
    const next = deleteMeeting(meetings, 'm2', actor)
    expect(listMeetings({ meetings: next, actor, limit: 10 }).items.map((item) => item.id)).toEqual(['m1'])
    expect(getMeeting(next, 'm2', actor).state).toBe('deleted')
    expect(getMeeting(next, 'm2', actor).meeting?.title).toBe('Drop')
    expect(() => deleteMeeting(meetings, 'm1', { workspaceId: 'ws-a', allowed: false })).toThrow('denied')
  })

  test('manual notes survive an AI summary and offline/incomplete stay explicit', () => {
    const original = meeting({ id: 'm1', manualNotes: 'моя правка', transcript: 'partial' })
    const summarized = applyMeetingSummary(original, 'AI сводка')
    expect(summarized.manualNotes).toBe('моя правка')
    expect(summarized.transcript).toBe('AI сводка')
    expect(listMeetings({ meetings: [original], actor, limit: 10, offline: true }).state).toBe('offline')
    expect(getMeeting([meeting({ id: 'm1', incomplete: true })], 'm1', actor).state).toBe('incomplete')
  })

  test('create, lifecycle, manual note, and segment correction stay on the query record', () => {
    const created = createMeeting([], { id: 'm1', workspaceId: 'ws-a', title: 'Standup', updatedAt: 1 }, actor)
    expect(created[0]?.status).toBe('planned')
    const started = setMeetingLifecycle(created, 'm1', 'capturing', actor, 2, 'device-required')
    expect(started[0]?.status).toBe('capturing')
    const noted = addManualNote(started, 'm1', 'keep this', actor, 3)
    const patched = correctSegment(noted, 'm1', {
      streamId: 's1',
      segmentId: 'seg1',
      revision: 2,
      text: 'Срок — понедельник',
    }, actor, 4)
    expect(patched[0]?.manualNotes).toBe('keep this')
    expect(patched[0]?.segments?.[0]?.text).toBe('Срок — понедельник')
  })
})
