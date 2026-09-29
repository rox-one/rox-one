import { describe, expect, test } from 'bun:test'
import {
  buildRadarPrompt,
  buildReplyDraftInput,
  buildTaskFromItem,
  emptyRadarData,
  groupDigest,
  latestSweep,
  localDateKey,
  matchLocalSignals,
  normalizeRadarData,
  parseRadarDigest,
  shouldRunDailySweep,
  topicItemCount,
  type RadarData,
  type RadarTopic,
} from '../radar/radar-model'

const topic = (label: string, keywords: string[] = [], kind: RadarTopic['kind'] = 'topic'): RadarTopic => ({
  id: `t-${label}`, label, kind, keywords, createdAt: 1,
})
const at = (h: number, day = 29) => new Date(2026, 8, day, h, 0, 0).getTime()

describe('radar model', () => {
  test('normalize drops junk and keeps defaults', () => {
    const data = normalizeRadarData({ topics: [{ id: 'a', label: ' ' }, { id: 'b', label: 'Linear', kind: 'competitor', keywords: ['x', 3] }], sweeps: [{ id: 's' }], daily: false, dailyHour: 99 })
    expect(data.topics).toHaveLength(1)
    expect(data.topics[0]).toMatchObject({ label: 'Linear', kind: 'competitor', keywords: ['x'] })
    expect(data.sweeps).toEqual([])
    expect(data.daily).toBe(false)
    expect(data.dailyHour).toBe(7)
    expect(normalizeRadarData(null)).toEqual(emptyRadarData())
  })

  test('daily sweep: once per local day, after the hour, only with topics', () => {
    const base: RadarData = { ...emptyRadarData(), topics: [topic('AI')] }
    expect(shouldRunDailySweep({ ...base, topics: [] }, at(9))).toBe(false)
    expect(shouldRunDailySweep(base, at(6))).toBe(false)
    expect(shouldRunDailySweep(base, at(9))).toBe(true)
    expect(shouldRunDailySweep({ ...base, daily: false }, at(9))).toBe(false)
    const swept = { ...base, sweeps: [{ id: 's', sessionId: 'x', date: localDateKey(at(8)), startedAt: at(8), trigger: 'daily' as const }] }
    expect(shouldRunDailySweep(swept, at(12))).toBe(false)
    expect(shouldRunDailySweep(swept, at(9, 30))).toBe(true)
  })

  test('latest sweep by start time', () => {
    const data = { ...emptyRadarData(), sweeps: [
      { id: 'old', sessionId: 'a', date: 'd', startedAt: 1, trigger: 'manual' as const },
      { id: 'new', sessionId: 'b', date: 'd', startedAt: 5, trigger: 'manual' as const },
    ] }
    expect(latestSweep(data)?.id).toBe('new')
  })

  test('prompt is read-only and lists topics', () => {
    const prompt = buildRadarPrompt([topic('Cursor', ['IDE'], 'competitor')], at(9), 'ru')
    expect(prompt).toContain('[конкурент] Cursor — слова: IDE')
    expect(prompt).toContain('запрещено')
    expect(prompt).toContain('```json')
  })

  test('parse digest: validates buckets, urls, dedupes; null without JSON', () => {
    expect(parseRadarDigest(undefined)).toBeNull()
    expect(parseRadarDigest({ foo: 1 })).toBeNull()
    const parsed = parseRadarDigest({ notes: 'нет X', items: [
      { title: 'A', bucket: 'reaction', reaction: 'ответить', url: 'javascript:alert(1)', source: 'X' },
      { title: 'A', bucket: 'reaction' },
      { title: 'B', bucket: 'weird', url: 'https://b.example' },
      { summary: 'no title' },
    ] })!
    expect(parsed.notes).toBe('нет X')
    expect(parsed.items.map((i) => i.title)).toEqual(['A', 'B'])
    expect(parsed.items[0].url).toBeUndefined()
    expect(parsed.items[0].reaction).toBe('ответить')
    expect(parsed.items[1]).toMatchObject({ bucket: 'changed', url: 'https://b.example', source: '—', origin: 'agent' })
    expect(parseRadarDigest({ items: [] })).toEqual({ items: [], notes: undefined })
  })

  test('local signals: last 24h keyword matches (ё-insensitive)', () => {
    const now = at(12)
    const signals = matchLocalSignals([topic('Ёлка', ['сбер'])], {
      sessions: [{ id: 's1', name: 'Звонок: елка и подарки', lastMessageAt: now - 3600e3 }, { id: 's2', name: 'Сбер старый', lastMessageAt: now - 48 * 3600e3 }],
      meetings: [{ id: 'm1', title: 'Сбер демо', at: now - 60e3 }],
      notes: [{ id: 'n1', title: 'Прочее', updatedAt: now }],
    }, now)
    expect(signals.map((s) => s.ref?.id)).toEqual(['m1', 's1'])
    expect(signals.every((s) => s.origin === 'local' && s.bucket === 'changed')).toBe(true)
  })

  test('group digest hides dismissed; topic counts', () => {
    const items = parseRadarDigest({ items: [{ title: 'A', bucket: 'important', topic: 'AI' }, { title: 'B', bucket: 'reaction', topic: 'ai' }] })!.items
    const groups = groupDigest(items, [items[0].id])
    expect(groups.important).toHaveLength(0)
    expect(groups.reaction).toHaveLength(1)
    expect(topicItemCount(topic('AI'), items)).toBe(2)
  })

  test('actions: draft input forbids sending; task carries context', () => {
    const [item] = parseRadarDigest({ items: [{ title: 'Пост о нас', bucket: 'reaction', reaction: 'Ответить', summary: 'Критика', url: 'https://x.com/a/1', source: 'X' }] })!.items
    const draft = buildReplyDraftInput(item, 'ru')
    expect(draft).toContain('ничего не отправляй')
    expect(draft).toContain('https://x.com/a/1')
    const task = buildTaskFromItem(item)
    expect(task.title).toBe('Ответить: Пост о нас')
    expect(task.notes).toContain('Радар · X')
  })
})
