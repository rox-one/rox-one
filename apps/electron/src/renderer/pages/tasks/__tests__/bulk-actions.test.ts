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
    expect(snap.spawned.length).toBe(1)
    expect(store.get(a)?.completedAt).toBeDefined()
    expect(store.get(r)?.completedAt).toBeDefined()
    undoBulkOperation(store, snap)
    expect(store.get(a)?.completedAt).toBeUndefined()
    expect(store.get(r)?.completedAt).toBeUndefined()
    expect(store.list().length).toBe(countBefore)
    for (const id of snap.spawned) expect(store.get(id)).toBeUndefined()
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

describe('review round 2', () => {
  it('pruning collapses to single selection at ≤ 1 and keeps focus inside the set', async () => {
    const { settlePrune, rangeFocus } = await import('../bulk-actions')
    expect(settlePrune(new Set(['b']), 'a')).toEqual({ multi: new Set(), focus: 'b' })
    expect(settlePrune(new Set(), 'a')).toEqual({ multi: new Set(), focus: 'a' })
    expect(settlePrune(new Set(['b', 'c']), 'a').focus).toBe('b')
    expect(settlePrune(new Set(['b', 'c']), 'c').focus).toBe('c')
    expect(rangeFocus(new Set(['b', 'c']), 'a', 'c')).toBe('c')
    expect(rangeFocus(new Set(['a', 'b']), 'a', 'b')).toBe('a')
  })

  it('undo reverts only changed fields and skips tasks edited after the action', () => {
    const { store, a, b } = seed()
    const snap = runBulkOperation(store, [a, b], 'evening', { now: NOW })
    store.update(a, { title: 'renamed' })
    store.setWhen(b, { kind: 'someday' })
    undoBulkOperation(store, snap)
    expect(store.get(a)?.title).toBe('renamed')
    expect(store.get(a)?.list).toBe('anytime')
    expect(store.get(b)?.list).toBe('someday')
  })

  it('undo removes only repeat copies spawned for the completed ids', () => {
    const { store, a, r } = seed()
    const other = store.create({ title: 'made later', list: 'inbox' })
    const snap = runBulkOperation(store, [a, r], 'complete', { now: NOW })
    expect(snap.spawned.length).toBe(1)
    undoBulkOperation(store, snap)
    expect(store.get(other.id)).toBeDefined()
    expect(store.get(snap.spawned[0]!)).toBeUndefined()
  })

  it('bulk move of a trashed task in a trashed project restores the project trash state on undo', () => {
    const { store, a, b } = seed()
    const project = store.addProject('P')
    store.moveTo(a, { projectId: project.id })
    store.trash(a, NOW)
    store.trashProject(project.id, NOW)
    const trashedAt = store.projects().find((p) => p.id === project.id)?.trashedAt
    expect(trashedAt).toBeDefined()
    const snap = runBulkOperation(store, [a, b], 'move', { dest: 'when:today', now: NOW })
    expect(store.get(a)?.trashedAt).toBeUndefined()
    expect(store.projects().find((p) => p.id === project.id)?.trashedAt).toBeUndefined()
    undoBulkOperation(store, snap)
    expect(store.projects().find((p) => p.id === project.id)?.trashedAt).toBe(trashedAt)
    expect(store.get(a)?.trashedAt).toBeDefined()
  })

  it('every action skips pending ids', () => {
    const { store, a, b } = seed()
    for (const kind of ['today', 'trash', 'move'] as const) {
      const snap = runBulkOperation(store, [a, b], kind, { pending: new Set([a]), dest: 'when:someday', now: NOW })
      expect(snap.affected).not.toContain(a)
    }
    expect(store.get(a)?.list).toBe('anytime')
  })
})
