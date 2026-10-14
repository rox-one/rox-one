import { describe, expect, it } from 'bun:test'
import { PersonalTaskStore } from '@rox/core/tasks/personal'
import { clearSelection, plainClick, runBulkOperation, selectAll, settleToggle, undoBulkOperation } from '../bulk-actions'
import { toggleInSelection } from '../multi-select'

const NOW = Date.UTC(2026, 9, 14, 12)

function seed() {
  const store = new PersonalTaskStore()
  const a = store.create({ title: 'a', list: 'anytime' })
  const b = store.create({ title: 'b', list: 'anytime' })
  const r = store.create({ title: 'repeat', list: 'today' })
  store.update(r.id, { recurrence: { rule: 'daily', interval: 1 }, startAt: NOW })
  return { store, a: a.id, b: b.id, r: r.id }
}

describe('bulk operations', () => {
  it('completes a repeating task and undo reopens it and removes the spawned copy', () => {
    const { store, a, r } = seed()
    const countBefore = store.list().length
    const snap = runBulkOperation(store, [a, r], 'complete', { now: NOW })
    expect(snap.affected).toEqual([a, r])
    expect(snap.created.length).toBe(1)
    expect(store.get(a)?.completedAt).toBeDefined()
    expect(store.get(r)?.completedAt).toBeDefined()
    undoBulkOperation(store, snap)
    expect(store.get(a)?.completedAt).toBeUndefined()
    expect(store.get(r)?.completedAt).toBeUndefined()
    expect(store.list().length).toBe(countBefore)
    for (const id of snap.created) expect(store.get(id)).toBeUndefined()
  })

  it('skips tasks that are mid-complete-animation', () => {
    const { store, a, b } = seed()
    const snap = runBulkOperation(store, [a, b], 'complete', { pending: new Set([a]), now: NOW })
    expect(snap.affected).toEqual([b])
    expect(store.get(a)?.completedAt).toBeUndefined()
  })

  it('trashes and restores', () => {
    const { store, a, b } = seed()
    const snap = runBulkOperation(store, [a, b], 'trash', { now: NOW })
    expect(store.get(a)?.trashedAt).toBeDefined()
    undoBulkOperation(store, snap)
    expect(store.get(a)?.trashedAt).toBeUndefined()
    expect(store.get(b)?.trashedAt).toBeUndefined()
  })

  it('batches when/move and undo restores list, evening and project', () => {
    const { store, a, b } = seed()
    const project = store.addProject('P')
    const before = { a: { ...store.get(a)! }, b: { ...store.get(b)! } }
    const snap = runBulkOperation(store, [a, b], 'evening', { now: NOW })
    expect(store.get(a)?.evening).toBe(true)
    undoBulkOperation(store, snap)
    expect(store.get(a)?.list).toBe(before.a.list)
    expect(Boolean(store.get(a)?.evening)).toBe(false)
    const moved = runBulkOperation(store, [a, b], 'move', { dest: `project:${project.id}`, now: NOW })
    expect(store.get(b)?.projectId).toBe(project.id)
    undoBulkOperation(store, moved)
    expect(store.get(b)?.projectId).toBeUndefined()
    expect(store.get(b)?.order).toBe(before.b.order)
  })
})

describe('selection transitions', () => {
  const order = ['a', 'b', 'c']
  it('⌘A selects all visible and Esc clears to the focused row', () => {
    const all = selectAll(order, 'b')
    expect([...all.multi]).toEqual(order)
    expect(all.focus).toBe('b')
    expect(selectAll(['a'], null)).toEqual({ multi: new Set(), focus: 'a' })
    expect(clearSelection('b')).toEqual({ multi: new Set(), focus: 'b' })
  })

  it('a plain click clears multi and focuses the clicked row', () => {
    expect(plainClick('c')).toEqual({ multi: new Set(), focus: 'c' })
  })

  it('a toggle that leaves one id collapses to single selection', () => {
    const next = toggleInSelection(new Set(['a', 'b']), 'b', 'a')
    expect(settleToggle(next, 'a')).toEqual({ multi: new Set(), focus: 'a' })
    expect(settleToggle(new Set(), 'a')).toEqual({ multi: new Set(), focus: null })
    const many = toggleInSelection(new Set(), 'c', 'a')
    expect(settleToggle(many, 'a').multi.size).toBe(2)
  })
})
