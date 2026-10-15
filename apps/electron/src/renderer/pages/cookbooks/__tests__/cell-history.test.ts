/**
 * Wave 14 (SPEC §F5): unit tests for the pure undo/redo core.
 *
 * The cases here are the frozen contract itself: a push clears the redo stack
 * and caps depth at the limit (oldest dropped), `undoStep` / `redoStep` shuffle
 * entries between the two stacks in order and return `null` on an empty stack,
 * `canUndo` / `canRedo` mirror the stacks, `createHistory` seeds an empty,
 * bounded history, and `invertOp` flips every kind (`duplicate` has no inverse).
 */
import { describe, expect, it } from 'bun:test'
import {
  canRedo,
  canUndo,
  createHistory,
  HISTORY_LIMIT,
  invertOp,
  pushEntry,
  redoStep,
  undoStep,
  type HistoryEntry,
} from '../cell-history'

const entry = (labelKey: string): HistoryEntry => ({ labelKey, undo: [], redo: [] })

describe('createHistory', () => {
  it('starts empty and bounded by the default limit', () => {
    const h = createHistory()
    expect(h.past).toEqual([])
    expect(h.future).toEqual([])
    expect(h.limit).toBe(HISTORY_LIMIT)
    expect(HISTORY_LIMIT).toBe(50)
  })

  it('honours an explicit limit', () => {
    expect(createHistory(3).limit).toBe(3)
  })
})

describe('canUndo / canRedo', () => {
  it('reflect the stacks on a fresh history', () => {
    const h = createHistory()
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('track a push and a redo availability', () => {
    const pushed = pushEntry(createHistory(), entry('cookbooks.op.move'))
    expect(canUndo(pushed)).toBe(true)
    expect(canRedo(pushed)).toBe(false)

    const undone = undoStep(pushed)
    expect(undone).not.toBeNull()
    expect(canUndo(undone!.history)).toBe(false)
    expect(canRedo(undone!.history)).toBe(true)
  })
})

describe('pushEntry', () => {
  it('appends to the past stack without mutating the argument', () => {
    const h = createHistory()
    const next = pushEntry(h, entry('a'))
    expect(next.past.map((e) => e.labelKey)).toEqual(['a'])
    expect(h.past).toEqual([])
  })

  it('clears the redo stack', () => {
    const undone = undoStep(pushEntry(createHistory(), entry('a')))!.history
    expect(canRedo(undone)).toBe(true)
    expect(pushEntry(undone, entry('b')).future).toEqual([])
  })

  it('caps depth at the limit, dropping the oldest entries first', () => {
    let h = createHistory(3)
    for (const label of ['a', 'b', 'c', 'd']) h = pushEntry(h, entry(label))
    expect(h.past.map((e) => e.labelKey)).toEqual(['b', 'c', 'd'])
  })

  it('caps at the default HISTORY_LIMIT of 50', () => {
    let h = createHistory()
    for (let i = 0; i < HISTORY_LIMIT + 1; i += 1) h = pushEntry(h, entry(`e${i}`))
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    // The very first push fell off; the last one is still present.
    expect(h.past[0].labelKey).toBe('e1')
    expect(h.past[h.past.length - 1].labelKey).toBe(`e${HISTORY_LIMIT}`)
  })
})

describe('undoStep / redoStep', () => {
  it('return null on an empty stack', () => {
    expect(undoStep(createHistory())).toBeNull()
    expect(redoStep(createHistory())).toBeNull()
  })

  it('undo moves the tail of past onto future and yields that entry', () => {
    const h = pushEntry(pushEntry(createHistory(), entry('a')), entry('b'))
    const step = undoStep(h)!
    expect(step.entry.labelKey).toBe('b')
    expect(step.history.past.map((e) => e.labelKey)).toEqual(['a'])
    expect(step.history.future.map((e) => e.labelKey)).toEqual(['b'])
    // Pure: the source history is untouched.
    expect(h.past.map((e) => e.labelKey)).toEqual(['a', 'b'])
    expect(h.future).toEqual([])
  })

  it('undo walks the past stack newest-first', () => {
    const h = pushEntry(pushEntry(createHistory(), entry('a')), entry('b'))
    expect(undoStep(h)!.entry.labelKey).toBe('b')
    expect(undoStep(undoStep(h)!.history)!.entry.labelKey).toBe('a')
  })

  it('redo moves the head of future back onto past and yields that entry', () => {
    const undone = undoStep(pushEntry(pushEntry(createHistory(), entry('a')), entry('b')))!.history
    const step = redoStep(undone)!
    expect(step.entry.labelKey).toBe('b')
    expect(step.history.past.map((e) => e.labelKey)).toEqual(['a', 'b'])
    expect(step.history.future).toEqual([])
  })

  it('round-trips undo then redo', () => {
    const h = pushEntry(createHistory(), entry('a'))
    const redone = redoStep(undoStep(h)!.history)!
    expect(redone.history.past.map((e) => e.labelKey)).toEqual(['a'])
    expect(redone.history.future).toEqual([])
  })
})

describe('invertOp', () => {
  it('flips add <-> delete keeping index, type and source', () => {
    expect(invertOp({ kind: 'add', index: 2, cellType: 'code', source: 'x = 1' })).toEqual({
      kind: 'delete',
      index: 2,
      cellType: 'code',
      source: 'x = 1',
    })
    expect(invertOp({ kind: 'delete', index: 0, cellType: 'markdown', source: '# hi' })).toEqual({
      kind: 'add',
      index: 0,
      cellType: 'markdown',
      source: '# hi',
    })
  })

  it('flips move(from, to)', () => {
    expect(invertOp({ kind: 'move', from: 0, to: 3 })).toEqual({ kind: 'move', from: 3, to: 0 })
  })

  it('flips convert(fromType, toType)', () => {
    expect(invertOp({ kind: 'convert', index: 1, fromType: 'code', toType: 'markdown' })).toEqual({
      kind: 'convert',
      index: 1,
      fromType: 'markdown',
      toType: 'code',
    })
  })

  it('returns null for duplicate — it has no positional inverse', () => {
    expect(invertOp({ kind: 'duplicate', index: 4 })).toBeNull()
  })
})
