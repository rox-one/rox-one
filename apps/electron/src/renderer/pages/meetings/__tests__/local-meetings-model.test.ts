import { describe, expect, it } from 'bun:test'
import type { LocalMeeting } from '../../../../shared/meetings-local'
import {
  activeSegmentIndex,
  buildSummaryPrompt,
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

  it('keeps only transcript-backed summary items and rejects unknown or uncited evidence', () => {
    expect(parseSummaryExtraction({
      summary: 'Итог',
      summarySourceSegmentIds: ['s0', 'outside'],
      decisions: [
        { title: 'Делаем', who: ['A', 3], sourceSegmentIds: ['s0', 'outside'] },
        { title: 'Без ссылки', sourceSegmentIds: ['outside'] },
      ],
      actions: [
        { text: 'Сделать X', sourceSegmentIds: ['s1'] },
        { text: 'Без ссылки', sourceSegmentIds: [] },
      ],
      questions: [{ text: 'Что дальше?', sourceSegmentIds: ['s1', 'outside'] }],
    }, ['s0', 's1'])).toEqual({
      summary: 'Итог',
      summarySourceSegmentIds: ['s0'],
      decisions: [{ title: 'Делаем', why: '', who: ['A'], sourceSegmentIds: ['s0'] }],
      actions: [{ text: 'Сделать X', sourceSegmentIds: ['s1'] }],
      questions: [{ text: 'Что дальше?', sourceSegmentIds: ['s1'] }],
    })
    expect(parseSummaryExtraction({
      summary: 'Без источника',
      summarySourceSegmentIds: ['missing'],
      decisions: [{ title: 'Нет ссылки', sourceSegmentIds: [] }],
    }, ['s0'])).toBeNull()
    expect(parseSummaryExtraction({}, ['s0'])).toBeNull()
    expect(parseSummaryExtraction([1], ['s0'])).toBeNull()
  })

  it('supplies stable transcript segment IDs and timecodes to summary generation', () => {
    const prompt = buildSummaryPrompt({
      title: 'Планирование',
      participants: [],
      language: 'ru',
      segments: [{ id: 'segment-a', startMs: 62_000, endMs: 64_000, text: 'Назначить встречу' }],
    })
    expect(prompt).toContain('[segmentId=segment-a 1:02–1:04] Назначить встречу')
  })
})
