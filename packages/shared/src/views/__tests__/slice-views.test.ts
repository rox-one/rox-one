import { describe, expect, it } from 'bun:test'
import { compileView, buildViewContext, evaluateView } from '../evaluator.ts'
import { getDefaultKnowledgeViews, getDefaultViews } from '../defaults.ts'
import { VIEW_FUNCTIONS } from '../functions.ts'
import { localDayBounds } from '../../sessions/collection-query.ts'
import { validateViewExpression } from '../validation.ts'
import {
  filtersToExpression,
  mergeSliceViews,
  sliceToView,
  userCollectionSlices,
  viewToCollectionSlice,
  type CollectionSliceLike,
} from '../slice-views.ts'

const builtins: CollectionSliceLike[] = [
  { id: 'unread', name: 'Unread', filters: { hasUnread: true }, builtin: true },
  { id: 'flagged', name: 'Flagged', filters: { flagged: true }, builtin: true },
  { id: 'overdue', name: 'Overdue', filters: { due: { type: 'overdue' } }, builtin: true },
  { id: 'today', name: 'Today', filters: { due: { type: 'today' } }, builtin: true },
]

describe('filtersToExpression + compileView', () => {
  it('compiles unread, flagged, overdue, today, and status+labels', () => {
    const cases: CollectionSliceLike[] = [
      ...builtins,
      {
        id: 'todo-bug',
        name: 'Todo bugs',
        filters: { status: ['todo'], labels: ['bug'] },
      },
    ]
    for (const slice of cases) {
      const view = sliceToView(slice)
      expect(compileView(view)).not.toBeNull()
      expect(view.expression.length).toBeGreaterThan(0)
      expect(view.collectionFilters).toEqual(slice.filters)
    }
    expect(filtersToExpression({ hasUnread: true })).toBe('hasUnread == true')
    expect(filtersToExpression({ flagged: true })).toBe('isFlagged == true')
    expect(filtersToExpression({ due: { type: 'overdue' } })).toBe('dueBucket == "overdue"')
    expect(filtersToExpression({ due: { type: 'today' } })).toBe('dueBucket == "today"')
    expect(filtersToExpression({ status: ['todo'], labels: ['bug'] })).toBe(
      'sessionStatus == "todo" and contains(labels, "bug")',
    )
  })

  it('matches flagged sessions', () => {
    const view = sliceToView({ id: 'x', name: 'X', filters: { flagged: true } })
    const compiled = compileView(view)!
    expect(evaluateView(buildViewContext({ isFlagged: true }), compiled)).toBe(true)
    expect(evaluateView(buildViewContext({ isFlagged: false }), compiled)).toBe(false)
  })
})

describe('mergeSliceViews', () => {
  it('keeps defaults and knowledge, skips builtins, replaces user slices', () => {
    const existing = [
      ...getDefaultViews(),
      ...getDefaultKnowledgeViews(),
      sliceToView({ id: 'old', name: 'Old', filters: { flagged: true } }),
    ]
    const merged = mergeSliceViews(existing, [
      ...builtins,
      { id: 'slice:new', name: 'New slice', filters: { hasUnread: true } },
    ])
    const ids = merged.map((v) => v.id)
    expect(ids).toContain('view-new')
    expect(ids).toContain('research-needs-review')
    expect(ids).not.toContain('slice:old')
    expect(ids).toContain('slice:new')
    expect(ids.some((id) => id === 'unread' || id === 'slice:unread')).toBe(false)
    expect(userCollectionSlices(merged).map((s) => s.name)).toEqual(['New slice'])
  })

  it('rename and delete via full replacement', () => {
    const existing = [
      ...getDefaultViews(),
      sliceToView({ id: 'keep', name: 'Keep', filters: { flagged: true } }),
      sliceToView({ id: 'gone', name: 'Gone', filters: { hasUnread: true } }),
    ]
    const renamed = mergeSliceViews(existing, [
      { id: 'slice:keep', name: 'Kept', filters: { flagged: true } },
    ])
    expect(renamed.map((v) => v.name)).toContain('Kept')
    expect(renamed.some((v) => v.id === 'slice:gone' || v.name === 'Gone')).toBe(false)
  })
})

describe('buildViewContext extras', () => {
  it('defaults priority/projectId/dueDate to empty string / empty string / 0', () => {
    const ctx = buildViewContext({})
    expect(ctx.priority).toBe('')
    expect(ctx.projectId).toBe('')
    expect(ctx.dueDate).toBe(0)
    expect(ctx.dueBucket).toBe('none')
  })
})

describe('due expressions', () => {
  it('compiles empty filters as true', () => {
    expect(filtersToExpression({})).toBe('true')
    expect(compileView(sliceToView({ id: 'empty', name: 'Empty', filters: {} }))).not.toBeNull()
  })

  it('compiles next_n_days and range as dueDate bounds', () => {
    const now = Date.UTC(2026, 7, 20, 15, 0, 0)
    const nDays = filtersToExpression({ due: { type: 'next_n_days', days: 3 } }, now)
    expect(nDays.startsWith('dueDate >= ')).toBe(true)
    expect(nDays.includes(' and dueDate <= ')).toBe(true)
    const range = filtersToExpression({ due: { type: 'range', start: 1, end: 9 } }, now)
    expect(range).toBe('dueDate >= 1 and dueDate <= 9')
    expect(compileView(sliceToView({ id: 'r', name: 'R', filters: { due: { type: 'range', start: 1, end: 9 } } }))).not.toBeNull()
  })

  it('evaluates leftover startOfToday expressions', () => {
    const compiled = compileView({
      id: 'legacy-overdue',
      name: 'Legacy overdue',
      domain: 'sessions',
      expression: 'dueDate > 0 and dueDate < startOfToday()',
    })
    expect(compiled).not.toBeNull()
    const overdue = Date.now() - 48 * 60 * 60 * 1000
    expect(evaluateView(buildViewContext({ dueDate: overdue }), compiled!)).toBe(true)
    expect(evaluateView(buildViewContext({ dueDate: Date.now() + 60_000 }), compiled!)).toBe(false)
  })
})

describe('userCollectionSlices', () => {
  it('skips default session views even if collectionFilters is present', () => {
    const views = [
      { ...getDefaultViews()[0]!, collectionFilters: { hasUnread: true } },
      sliceToView({ id: 'slice-abc', name: 'Mine', filters: { flagged: true } }),
    ]
    expect(userCollectionSlices(views).map((s) => s.name)).toEqual(['Mine'])
  })

  it('treats slice- ids as managed replacements', () => {
    const existing = [
      ...getDefaultViews(),
      { id: 'slice-old', name: 'Old', domain: 'sessions' as const, expression: 'true', collectionFilters: { flagged: true } },
    ]
    const merged = mergeSliceViews(existing, [{ id: 'slice-new', name: 'New', filters: { hasUnread: true } }])
    const ids = merged.map((v) => v.id)
    expect(ids).toContain('view-new')
    expect(ids.some((id) => id.includes('old'))).toBe(false)
    expect(ids).toContain('slice:slice-new')
  })

  it('does not treat knowledge views as Filter slices', () => {
    const knowledge = {
      ...getDefaultKnowledgeViews()[0]!,
      collectionFilters: { flagged: true },
    }
    expect(viewToCollectionSlice(knowledge)).toBeNull()
    expect(userCollectionSlices([knowledge])).toEqual([])
    const merged = mergeSliceViews([knowledge, ...getDefaultViews()], [{ id: 'slice-x', name: 'X', filters: { flagged: true } }])
    expect(merged.some((v) => v.id === knowledge.id)).toBe(true)
    expect(merged.some((v) => v.id === 'slice:slice-x')).toBe(true)
  })
})

describe('startOfToday leftover', () => {
  it('validates and evaluates startOfToday()', () => {
    expect(validateViewExpression('dueDate < startOfToday()').valid).toBe(true)
    const now = Date.now()
    expect(VIEW_FUNCTIONS.startOfToday()).toBe(localDayBounds(now).start)
    expect(VIEW_FUNCTIONS.startOfToday(now)).toBe(localDayBounds(now).start)
  })
})
