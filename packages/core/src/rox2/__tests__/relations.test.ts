import { describe, expect, test } from 'bun:test'
import { Rox2RelationCycleError, Rox2RelationGraph, deletionPolicyFor } from '../relations.ts'

describe('ROX2 relation graph (issue 336)', () => {
  test('allows Note→Person discusses and mutual mentions', () => {
    const graph = new Rox2RelationGraph()
    expect(() => graph.add({ fromId: 'note:1', toId: 'person:1', kind: 'discusses' }, 'note', 'person')).not.toThrow()
    expect(() => graph.add({ fromId: 'note:1', toId: 'person:1', kind: 'mentions' }, 'note', 'person')).not.toThrow()
    expect(() => graph.add({ fromId: 'note:1', toId: 'note:2', kind: 'mentions' }, 'note', 'note')).not.toThrow()
    expect(() => graph.add({ fromId: 'note:2', toId: 'note:1', kind: 'mentions' }, 'note', 'note')).not.toThrow()
  })

  test('rejects a task dependency cycle', () => {
    const graph = new Rox2RelationGraph()
    graph.add({ fromId: 'task:a', toId: 'task:b', kind: 'depends-on' }, 'task', 'task')
    expect(() => graph.add({ fromId: 'task:b', toId: 'task:a', kind: 'depends-on' }, 'task', 'task')).toThrow(Rox2RelationCycleError)
  })

  test('delete detaches edges so queries have no dangling links', () => {
    const graph = new Rox2RelationGraph()
    graph.add({ fromId: 'task:a', toId: 'person:1', kind: 'assigned' }, 'task', 'person')
    graph.add({ fromId: 'note:1', toId: 'task:a', kind: 'mentions' }, 'note', 'task')
    expect(deletionPolicyFor('assigned')).toBe('detach')
    const removed = graph.removeEntity('task:a')
    expect(removed).toHaveLength(2)
    expect(graph.query()).toEqual([])
  })

  test('graph query hides edges the viewer cannot read', () => {
    const graph = new Rox2RelationGraph()
    graph.add({ fromId: 'note:1', toId: 'person:1', kind: 'discusses' }, 'note', 'person')
    expect(graph.query({ viewerPermissions: { 'note:1': ['read'], 'person:1': [] } })).toEqual([])
    expect(graph.query({ viewerPermissions: { 'note:1': ['read'], 'person:1': ['read'] } })).toHaveLength(1)
  })

  test('snapshot restore rolls migration back', () => {
    const graph = new Rox2RelationGraph()
    graph.add({ fromId: 'session:1', toId: 'project:1', kind: 'membership' }, 'session', 'project')
    const snap = graph.snapshot()
    expect(snap.sha256).toHaveLength(64)
    graph.add({ fromId: 'session:1', toId: 'project:2', kind: 'membership' }, 'session', 'project')
    graph.restore(snap)
    expect(graph.snapshot().sha256).toBe(snap.sha256)
    expect(graph.query()).toHaveLength(1)
  })
})
