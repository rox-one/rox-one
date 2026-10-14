import { describe, expect, it, mock } from 'bun:test'
import { parseCanvasRoute, setCanvasTarget, takeCanvasTarget } from '../canvas-target'

describe('canvas target (S3)', () => {
  it('parses board and object id', () => {
    expect(parseCanvasRoute('canvas/board/b1#o2')).toEqual({ boardId: 'b1', objectId: 'o2' })
    expect(parseCanvasRoute('canvas/board/b1')).toEqual({ boardId: 'b1' })
    expect(parseCanvasRoute('notes/note/n1')).toBeNull()
  })
  it('pending target is consumed once', () => {
    setCanvasTarget({ boardId: 'b', objectId: 'o' })
    expect(takeCanvasTarget()).toEqual({ boardId: 'b', objectId: 'o' })
    expect(takeCanvasTarget()).toBeNull()
  })
})

describe('preview batcher (S7)', () => {
  it('one entitiesResolve per frame, cached per ref', async () => {
    const calls: unknown[] = []
    ;(globalThis as any).window = { electronAPI: { entitiesResolve: async (_ws: string, q: { refs: { id: string }[] }) => { calls.push(q); return q.refs.map(r => ({ title: r.id })) } } }
    const { createPreviewBatcher } = await import('../entity-wiring')
    const frames: Array<() => void> = []
    const b = createPreviewBatcher('ws', cb => { frames.push(cb) })
    const p1 = b.get({ kind: 'note', id: 'a' }), p2 = b.get({ kind: 'note', id: 'b' }), p3 = b.get({ kind: 'note', id: 'a' })
    expect(p3).toBe(p1)
    expect(frames.length).toBe(1)
    frames[0]!()
    expect(((await p1) as any)?.title).toBe('a')
    expect(((await p2) as any)?.title).toBe('b')
    expect(calls.length).toBe(1)
    b.get({ kind: 'note', id: 'a' })
    expect(frames.length).toBe(1)
  })
})
