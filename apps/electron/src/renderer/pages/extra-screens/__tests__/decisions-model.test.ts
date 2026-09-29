import { describe, expect, test } from 'bun:test'
import {
  buildExtractionPrompt,
  candidateToDecision,
  diffLessonRules,
  filterDecisions,
  lessonRulesFor,
  meetingTranscript,
  normalizeDecisionsData,
  parseDecisionCandidates,
  sessionTranscript,
  type Decision,
} from '../decisions/decisions-model'

const DAY = 86400000
const now = new Date(2026, 8, 29, 12).getTime()

function decision(patch: Partial<Decision> = {}): Decision {
  return {
    id: 'd1', title: 'Радар живёт в «Ещё»', why: 'пилюля перегружена', who: ['Марк'], decidedAt: now - DAY,
    status: 'accepted', rejected: [{ id: 'o1', text: 'восьмой пункт в пилюле', reason: 'перегруз' }],
    source: { kind: 'meeting', id: 'm1', label: 'Планёрка' }, tags: ['ui'], exposeToAgents: true, syncedRules: [],
    createdAt: now - DAY, updatedAt: now - DAY, ...patch,
  }
}

describe('decisions model', () => {
  test('normalize keeps valid decisions and defaults', () => {
    const data = normalizeDecisionsData({ decisions: [{ id: 'a', title: 'X', rejected: ['Y', { option: 'Z', reason: 'r' }] }, { id: 'b' }], candidates: 'junk' })
    expect(data.decisions).toHaveLength(1)
    expect(data.decisions[0]).toMatchObject({ status: 'accepted', exposeToAgents: true, source: { kind: 'manual' } })
    expect(data.decisions[0].rejected.map((r) => r.text)).toEqual(['Y', 'Z'])
    expect(data.candidates).toEqual([])
  })

  test('filters: search (ё-insensitive, rejected options), status, source, period', () => {
    const list = [
      decision(),
      decision({ id: 'd2', title: 'Postgres вместо Mongo', rejected: [], status: 'superseded', source: { kind: 'manual' }, decidedAt: now - 40 * DAY }),
    ]
    const base = { query: '', status: 'all' as const, source: 'all' as const, periodDays: null }
    expect(filterDecisions(list, base, now).map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(filterDecisions(list, { ...base, query: 'ещё' }, now).map((d) => d.id)).toEqual(['d1'])
    expect(filterDecisions(list, { ...base, query: 'восьмой' }, now).map((d) => d.id)).toEqual(['d1'])
    expect(filterDecisions(list, { ...base, status: 'superseded' }, now).map((d) => d.id)).toEqual(['d2'])
    expect(filterDecisions(list, { ...base, source: 'meeting' }, now).map((d) => d.id)).toEqual(['d1'])
    expect(filterDecisions(list, { ...base, periodDays: 30 }, now).map((d) => d.id)).toEqual(['d1'])
  })

  test('lesson rules: decision + MUST NOT per rejected option; none when not in force', () => {
    const rules = lessonRulesFor(decision())
    expect(rules).toHaveLength(2)
    expect(rules[0].negative).toBe(false)
    expect(rules[0].rule).toContain('Радар живёт в «Ещё»')
    expect(rules[1]).toMatchObject({ negative: true })
    expect(rules[1].rule).toContain('«восьмой пункт в пилюле»')
    expect(lessonRulesFor(decision({ status: 'superseded' }))).toEqual([])
    expect(lessonRulesFor(decision({ exposeToAgents: false }))).toEqual([])
  })

  test('diff rules adds new and removes stale', () => {
    const wanted = lessonRulesFor(decision())
    expect(diffLessonRules([], wanted).add).toHaveLength(2)
    const synced = wanted.map((r) => r.rule)
    expect(diffLessonRules(synced, wanted)).toEqual({ add: [], remove: [] })
    expect(diffLessonRules([...synced, 'old'], [])).toEqual({ add: [], remove: [...synced, 'old'] })
  })

  test('transcripts: session keeps user + final assistant turns; meeting collects segments', () => {
    const text = sessionTranscript([
      { role: 'user', content: 'Решим?' },
      { role: 'assistant', content: 'думаю', isIntermediate: true },
      { role: 'tool', content: 'x' },
      { role: 'assistant', content: 'Да, берём A.' },
    ])
    expect(text).toBe('Пользователь: Решим?\n\nАгент: Да, берём A.')
    expect(sessionTranscript([{ role: 'user', content: 'x'.repeat(50) }], 10).startsWith('…')).toBe(true)
    const meeting = meetingTranscript({ meeting: { title: 'M' }, segments: [{ text: 'Берём Б', speakerId: 'Аня' }, { text: 'ок' }], summary: 'Выбрали Б' })
    expect(meeting).toBe('Итоги: Выбрали Б\nАня: Берём Б\nок')
  })

  test('extraction prompt is read-only; parse candidates', () => {
    const prompt = buildExtractionPrompt({ kind: 'session', id: 's1', label: 'Созвон' }, 'текст', 'ru')
    expect(prompt).toContain('Ничего не отправляй')
    expect(prompt.endsWith('текст')).toBe(true)
    expect(parseDecisionCandidates(undefined, { extractionId: 'e', source: { kind: 'manual' } })).toBeNull()
    const list = parseDecisionCandidates({ decisions: [{ title: 'A', who: ['Марк'], rejected: [{ text: 'B', reason: 'дорого' }] }, { why: 'no title' }] }, { extractionId: 'e', source: { kind: 'session', id: 's1' } })!
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'e-0', title: 'A', who: ['Марк'], source: { kind: 'session', id: 's1' } })
    expect(list[0].rejected[0]).toMatchObject({ text: 'B', reason: 'дорого' })
    const d = candidateToDecision(list[0], 'dec-1', now)
    expect(d).toMatchObject({ id: 'dec-1', status: 'accepted', exposeToAgents: true, decidedAt: now, syncedRules: [] })
  })
})
