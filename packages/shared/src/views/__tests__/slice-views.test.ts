import { describe, expect, it } from 'bun:test'
import { compileView, buildViewContext } from '../evaluator.ts'
import {
  filtersToExpression,
  mergeSliceViews,
  sliceToView,
  type CollectionSliceLike,
} from '../slice-views.ts'
import type { ViewConfig } from '../types.ts'

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
})

describe('mergeSliceViews', () => {
  it('is additive and skips duplicates by id and signature', () => {
    const existing: ViewConfig[] = [
      {
        id: 'view-new',
        name: 'New',
        expression: 'hasUnread == true',
        collectionFilters: { hasUnread: true },
      },
    ]
    const merged = mergeSliceViews(existing, builtins)
    expect(merged[0]).toBe(existing[0])
    expect(merged.map((v) => v.id)).toEqual([
      'view-new',
      'slice:flagged',
      'slice:overdue',
      'slice:today',
    ])
    const again = mergeSliceViews(merged, builtins)
    expect(again).toHaveLength(merged.length)
    expect(again.map((v) => v.id)).toEqual(merged.map((v) => v.id))
  })
})

describe('buildViewContext extras', () => {
  it('defaults priority/projectId/dueDate to empty string / empty string / 0', () => {
    const ctx = buildViewContext({})
    expect(ctx.priority).toBe('')
    expect(ctx.projectId).toBe('')
    expect(ctx.dueDate).toBe(0)
  })
})
