import { describe, expect, it } from 'bun:test'
import type { LocalMeeting } from '../../../../shared/meetings-local'
import {
  activeSegmentIndex,
  filterSegments,
  formatDuration,
  groupLocalMeetings,
  inLocalBucket,
  localBucketCounts,
  meetingMatches,
  normalizeQuery,
  parseSummaryExtraction,
} from '../local-meetings-model'

const NOW = new Date(2026, 8, 29, 17, 0, 0).getTime()
const HOUR = 3600_000

function meeting(p: Partial<LocalMeeting>): LocalMeeting {
  return {
    schema: 1, id: p.id ?? 'm-x', title: 'T', workspaceId: null, createdAt: NOW, durationMs: 0, status: 'ready', source: 'none',
    participants: [], notes: '', audio: null, transcript: { status: 'none', progress: 0 }, summary: null, actions: [], documents: [], updatedAt: NOW,
    ...p,
  }
}

describe('local meetings view model', () => {
  const live = meeting({ id: 'm-live', status: 'recording', startedAt: NOW - 60_000 })
  const upcoming = meeting({ id: 'm-up', status: 'planned', scheduledAt: NOW + 2 * HOUR })
  const today = meeting({ id: 'm-today', startedAt: NOW - 2 * HOUR, audio: { file: 'audio.webm', mimeType: 'audio/webm', bytes: 1 }, transcript: { status: 'failed', progress: 0 } })
  const old = meeting({ id: 'm-old', startedAt: NOW - 3 * 24 * HOUR, actions: [{ id: 'a', text: 'x', done: false, createdAt: 0 }] })
  const all = [live, upcoming, today, old]

  it('filters buckets for real', () => {
    expect(all.filter((m) => inLocalBucket(m, 'live', NOW)).map((m) => m.id)).toEqual(['m-live'])
    expect(all.filter((m) => inLocalBucket(m, 'upcoming', NOW)).map((m) => m.id)).toEqual(['m-up'])
    expect(all.filter((m) => inLocalBucket(m, 'past', NOW)).map((m) => m.id)).toEqual(['m-today', 'm-old'])
    expect(all.filter((m) => inLocalBucket(m, 'today', NOW)).map((m) => m.id)).toEqual(['m-live', 'm-up', 'm-today'])
    expect(all.filter((m) => inLocalBucket(m, 'needsAction', NOW)).map((m) => m.id)).toEqual(['m-today', 'm-old'])
    expect(localBucketCounts(all, NOW)).toEqual({ all: 4, today: 3, upcoming: 1, past: 2, live: 1, needsAction: 2 })
  })

  it('groups live → planned → days', () => {
    expect(groupLocalMeetings(all, NOW).map((g) => g.kind)).toEqual(['now', 'planned', 'today', 'day'])
  })

  it('searches metadata and transcript text', () => {
    const m = meeting({ title: 'Бюджет Q4', participants: ['Анна'] })
    expect(meetingMatches(m, normalizeQuery('бюджет анна'))).toBe(true)
    expect(meetingMatches(m, normalizeQuery('релиз'))).toBe(false)
    expect(meetingMatches(m, normalizeQuery('релиз'), 'обсудили релиз в пятницу')).toBe(true)
  })

  it('transcript search and active segment for seeking', () => {
    const segs = [{ id: 's0', startMs: 0, endMs: 1000, text: 'Проверка записи' }, { id: 's1', startMs: 1000, endMs: 2000, text: 'встречи' }]
    expect(filterSegments(segs, 'запис').map((s) => s.id)).toEqual(['s0'])
    expect(activeSegmentIndex(segs, 1500)).toBe(1)
    expect(activeSegmentIndex(segs, -1)).toBe(-1)
    expect(formatDuration(61_000)).toBe('1:01')
    expect(formatDuration(3_723_000)).toBe('1:02:03')
  })

  it('parses the generated summary block', () => {
    expect(parseSummaryExtraction({ summary: 'Итог', decisions: [{ title: 'Делаем', who: ['A', 3] }, { why: 'no title' }], actions: ['Сделать X', { text: 'Y' }, ''] })).toEqual({
      summary: 'Итог',
      decisions: [{ title: 'Делаем', why: '', who: ['A'] }],
      actions: ['Сделать X', 'Y'],
    })
    expect(parseSummaryExtraction({})).toBeNull()
    expect(parseSummaryExtraction([1])).toBeNull()
  })
})
