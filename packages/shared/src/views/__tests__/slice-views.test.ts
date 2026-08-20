import { describe, expect, it } from 'bun:test'
import { compileView, buildViewContext, evaluateView } from '../evaluator.ts'
import { getDefaultKnowledgeViews, getDefaultViews } from '../defaults.ts'
import {
  filtersToExpression,
  mergeSliceViews,
  sliceToView,
  userCollectionSlices,
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
