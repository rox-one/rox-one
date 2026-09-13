import { describe, expect, it } from 'bun:test'
import {
  createBoardViews,
  dragTask,
  linkRelation,
  renameTask,
  sourceDeleted,
  taskInViews,
  unlinkTask,
} from '../board-fund.ts'

describe('board-fund (#378)', () => {
  it('keeps one Task id across meeting/board/canvas', () => {
    const views = createBoardViews({ id: 't1', title: 'Task', revision: '1', status: 'todo' })
    const copies = taskInViews(views, 't1')
    expect(copies).toHaveLength(3)
    expect(new Set(copies.map((row) => row.id)).size).toBe(1)
  })

  it('renames native tasks in every view and unlinks without leftover ids', () => {
    const views = createBoardViews({ id: 't1', title: 'Task', revision: '1', status: 'todo' })
    expect(renameTask(views, 't1', 'New').status).toBe('verified')
    expect(taskInViews(views, 't1').every((row) => row.title === 'New')).toBe(true)
    expect(renameTask(views, 't1', 'FromConation', 'conation').status).toBe('blocked')
    unlinkTask(views, 't1')
    expect(taskInViews(views, 't1')).toHaveLength(0)
  })

  it('CAS-fails concurrent drags and drops source-deleted tasks', () => {
    const views = createBoardViews({
      id: 't1',
      title: 'Task',
      revision: '2',
      status: 'todo',
      sourceId: 'src-1',
    })
    expect(dragTask(views, 't1', { x: 1, y: 1 }, '1').reason).toBe('concurrent-drag')
    sourceDeleted(views, 'src-1')
    expect(taskInViews(views, 't1')).toHaveLength(0)
  })

  it('forbids cycles only on acyclic depends relations', () => {
    const views = createBoardViews({ id: 'a', title: 'A', revision: '1', status: 'todo' })
    views.board.set('b', { id: 'b', title: 'B', revision: '1', status: 'todo' })
    expect(linkRelation(views, 'a', 'b', 'depends').status).toBe('verified')
    expect(linkRelation(views, 'b', 'a', 'depends').reason).toBe('cycle')
    expect(linkRelation(views, 'b', 'a', 'related').status).toBe('verified')
  })
})
