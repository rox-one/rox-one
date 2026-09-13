import { describe, expect, it } from 'bun:test'
import {
  applyUnknownConationOp,
  createBoardViews,
  dragTask,
  iframeIsNativeProduct,
  linkRelation,
  presentBoardFundSurface,
  renameTask,
  secondProductShellEnabled,
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

  it('does not present Conation iframe, deep-link, or a second shell as native ROX UI', () => {
    expect(iframeIsNativeProduct()).toBe(false)
    expect(secondProductShellEnabled()).toBe(false)

    const iframe = presentBoardFundSurface('iframe')
    expect(iframe.status).toBe('unsupported')
    expect(iframe.reason).toBe('iframe-is-not-native')
    expect(iframe.live).toBe(false)
    expect(iframe.evidenceLevel).toBe('U1')

    expect(presentBoardFundSurface('deeplink').status).toBe('unsupported')
    expect(presentBoardFundSurface('deeplink').reason).toBe('deeplink-is-not-native')
    expect(presentBoardFundSurface('second-shell').status).toBe('unsupported')
    expect(presentBoardFundSurface('second-shell').reason).toBe('second-shell-forbidden')
  })

  it('keeps native Board/Fund working when Conation is off and rejects unknown ops', () => {
    const native = presentBoardFundSurface('native', { conationEnabled: false })
    expect(native.status).toBe('verified')
    expect(native.reason).toBe('native-surface')
    expect(native.live).toBe(false)
    expect(native.evidenceLevel).toBe('U1')

    const views = createBoardViews({ id: 't1', title: 'Task', revision: '1', status: 'todo' })
    expect(renameTask(views, 't1', 'Still native').status).toBe('verified')
    expect(taskInViews(views, 't1').every((row) => row.title === 'Still native')).toBe(true)

    const unknown = applyUnknownConationOp('invented-schema')
    expect(unknown.status).toBe('unsupported')
    expect(unknown.reason).toBe('unknown-conation-op')
    expect(unknown.live).toBe(false)
    expect(unknown.evidenceLevel).toBe('U1')
  })
})
