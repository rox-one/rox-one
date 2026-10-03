import { describe, expect, it } from 'bun:test'
import type { Lesson } from '@craft-agent/shared/memory/types'
import { clusterTopics, contextSelection, duplicateIds, lessonId, matchesFilter, mergePatch, nearDuplicates, sortLessons, tokenBudget } from '../memory-model'

const make = (rule: string, extra: Partial<Lesson> = {}): Lesson => ({
  ts: '2026-09-01T00:00:00.000Z', rule, category: 'workflow', scope: 'workspace', source: { trigger: 'distillation', sessionId: 's' }, ...extra,
})

describe('memory model', () => {
  it('context selection and budget skip disabled lessons and keep pinned', () => {
    const lessons = [make('a pinned rule', { pinned: true }), ...Array.from({ length: 60 }, (_, i) => make(`rule number ${i}`)), make('off', { disabled: true })]
    const inContext = contextSelection(lessons)
    expect(inContext.size).toBe(50)
    expect(inContext.has(lessonId(lessons[0]!))).toBe(true)
    expect(inContext.has(lessonId(lessons[1]!))).toBe(false)
    const budget = tokenBudget(lessons, inContext)
    expect(budget.injectedCount).toBe(50)
    expect(budget.disabledCount).toBe(1)
    expect(budget.activeCount).toBe(61)
    expect(budget.injectedTokens).toBeGreaterThan(0)
  })

  it('clusters lessons by shared keywords', () => {
    const lessons = [
      make('Проверять скриншоты перед отчётом'), make('Скриншоты сохранять в rox-shots'), make('Скриншоты делать на 1280'),
      make('Коммиты без force-push'), make('Коммиты подписывать'), make('Коммиты маленькие'), make('Уникальное правило про кофе'),
    ]
    const { topics } = clusterTopics(lessons)
    const labels = topics.map((t) => t.label)
    expect(labels).toContain('скриншоты')
    expect(labels).toContain('коммиты')
    expect(topics[topics.length - 1]!.id).toBe('')
  })

  it('finds near duplicates within a scope only', () => {
    const a = make('Никогда не использовать раскрытые credentials повторно')
    const b = make('Раскрытые credentials повторно не использовать никогда')
    const c = make('Раскрытые credentials повторно не использовать никогда', { scope: 'global' })
    expect(nearDuplicates(a, [a, b, c]).map((x) => x.lesson)).toEqual([b])
    expect(duplicateIds([a, b, c]).size).toBe(2)
  })

  it('filters by facets and search, sorts pinned first', () => {
    const lessons = [make('alpha #x', { tags: ['ui'], usageCount: 1 }), make('beta', { negative: true, usageCount: 9 }), make('gamma', { pinned: true })]
    const ctx = { inContext: contextSelection(lessons), topicOf: new Map<string, string>() }
    expect(lessons.filter((l) => matchesFilter(l, { status: 'negative' }, ctx)).map((l) => l.rule)).toEqual(['beta'])
    expect(lessons.filter((l) => matchesFilter(l, { query: '#ui' }, ctx)).map((l) => l.rule)).toEqual(['alpha #x'])
    expect(lessons.filter((l) => matchesFilter(l, { usage: 'often' }, ctx)).map((l) => l.rule)).toEqual(['beta'])
    expect(sortLessons(lessons, 'usage').map((l) => l.rule)).toEqual(['gamma', 'beta', 'alpha #x'])
  })

  it('merge keeps provenance and sums usage', () => {
    const keeper = make('keep', { usageCount: 2, tags: ['a'] })
    const other = make('other', { usageCount: 3, tags: ['b'], pinned: true })
    const patch = mergePatch(keeper, [other], 'keep')
    expect(patch.usageCount).toBe(5)
    expect(patch.mergedFrom).toEqual(['other'])
    expect(patch.tags).toEqual(['a', 'b'])
    expect(patch.pinned).toBe(true)
  })

  it('stores exact reversible merge origins and rejects cross-scope merges', () => {
    const keeper = make('primary', { source: { trigger: 'explicit', sessionId: 'session-a' }, usageCount: 2 })
    const source = make('secondary', { source: { trigger: 'error', sessionId: 'session-b' }, disabled: true })
    const patch = mergePatch(keeper, [source], 'combined')
    expect(patch.mergeHistory?.lessons).toEqual([keeper, source])
    expect(patch.mergedFrom).toContain('secondary')
    expect(() => mergePatch(keeper, [make('global', { scope: 'global' })], 'combined')).toThrow('different scopes')
  })
})
