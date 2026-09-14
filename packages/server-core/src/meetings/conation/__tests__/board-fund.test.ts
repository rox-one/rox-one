import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { isLiveVerified } from '../../types.ts'
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
    const renamed = renameTask(views, 't1', 'New')
    expect(renamed.status).toBe('pending')
    expect(renamed.status).not.toBe('verified')
    expect(renamed.live).toBe(false)
    expect(isLiveVerified(renamed)).toBe(false)
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
    const moved = dragTask(views, 't1', { x: 2, y: 2 }, '2')
    expect(moved.status).toBe('pending')
    expect(moved.status).not.toBe('verified')
    expect(moved.reason).toBe('moved')
    expect(moved.live).toBe(false)
    expect(isLiveVerified(moved)).toBe(false)
    expect(views.layout.get('t1')).toEqual({ x: 2, y: 2 })
    sourceDeleted(views, 'src-1')
    expect(taskInViews(views, 't1')).toHaveLength(0)
  })

  it('forbids cycles only on acyclic depends relations', () => {
    const views = createBoardViews({ id: 'a', title: 'A', revision: '1', status: 'todo' })
    views.board.set('b', { id: 'b', title: 'B', revision: '1', status: 'todo' })
    const linked = linkRelation(views, 'a', 'b', 'depends')
    expect(linked.status).toBe('pending')
    expect(linked.status).not.toBe('verified')
    expect(linked.live).toBe(false)
    expect(isLiveVerified(linked)).toBe(false)
    expect(linkRelation(views, 'b', 'a', 'depends').reason).toBe('cycle')
    expect(linkRelation(views, 'b', 'a', 'related').status).toBe('pending')
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
    expect(native.status).toBe('pending')
    expect(native.status).not.toBe('verified')
    expect(native.reason).toBe('native-surface')
    expect(native.live).toBe(false)
    expect(native.evidenceLevel).toBe('U1')
    expect(isLiveVerified(native)).toBe(false)

    const views = createBoardViews({ id: 't1', title: 'Task', revision: '1', status: 'todo' })
    expect(renameTask(views, 't1', 'Still native').status).toBe('pending')
    expect(taskInViews(views, 't1').every((row) => row.title === 'Still native')).toBe(true)

    const unknown = applyUnknownConationOp('invented-schema')
    expect(unknown.status).toBe('unsupported')
    expect(unknown.reason).toBe('unknown-conation-op')
    expect(unknown.live).toBe(false)
    expect(unknown.evidenceLevel).toBe('U1')
  })

  it('does not stamp verified / live:true / L4 on native Board/Fund stubs', () => {
    const src = readFileSync(new URL('../board-fund.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/status:\s*'verified'/)
    expect(src).not.toMatch(/live:\s*true/)
    expect(src).not.toMatch(/evidenceLevel:\s*'L4'/)

    const native = presentBoardFundSurface('native')
    expect(native.status).not.toBe('verified')
    expect(native.live).toBe(false)
    expect(native.evidenceLevel).not.toBe('L4')
    expect(isLiveVerified(native)).toBe(false)

    const views = createBoardViews({ id: 't1', title: 'Task', revision: '1', status: 'todo' })
    for (const result of [
      renameTask(views, 't1', 'Renamed'),
      dragTask(views, 't1', { x: 3, y: 4 }, '2'),
      linkRelation(views, 't1', 't1', 'related'),
    ]) {
      expect(result.status).not.toBe('verified')
      expect(result.live).toBe(false)
      expect(result.evidenceLevel).not.toBe('L4')
      expect(isLiveVerified(result)).toBe(false)
    }
  })
})
