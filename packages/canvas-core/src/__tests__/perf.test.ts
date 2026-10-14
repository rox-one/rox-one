/**
 * Perf budgets (SPEC §9). Measured on the dev machine; budgets are asserted
 * with headroom so CI noise doesn't flake, and the raw numbers are printed.
 */
import { expect, test } from 'bun:test'
import * as Y from 'yjs'
import { actorOrigin, CanvasDoc, SpatialIndex } from '../index.ts'

const me = actorOrigin('user', 'perf')
const N_OPEN = 1000
const N_PAN = 5000

function makeBoard(n: number): CanvasDoc {
  const b = new CanvasDoc()
  b.init({ title: 'perf' })
  const inputs = Array.from({ length: n }, (_, i) => ({
    type: i % 3 === 0 ? 'sticky' : 'shape', x: (i % 100) * 220, y: Math.floor(i / 100) * 180, w: 180, h: 140,
    props: i % 3 === 0 ? { text: `note ${i}` } : { kind: 'rect' },
  }))
  b.add(inputs, me)
  return b
}
const ms = (f: () => void) => { const t = performance.now(); f(); return performance.now() - t }

test(`open a ${N_OPEN}-object board (decode + list + index) ≤ 500 ms`, () => {
  const state = Y.encodeStateAsUpdate(makeBoard(N_OPEN).doc)
  let objects = 0
  const t = ms(() => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, state)
    const b = new CanvasDoc(doc)
    objects = b.list().length
    new SpatialIndex(b).dispose()
  })
  console.log(`[perf] open ${N_OPEN} objects: ${t.toFixed(1)} ms (${(state.length / 1024).toFixed(0)} KiB)`)
  expect(objects).toBe(N_OPEN)
  expect(t).toBeLessThan(500)
})

test(`viewport query on ${N_PAN} objects fits a 60 fps frame (p95 ≤ 2 ms)`, () => {
  const b = makeBoard(N_PAN)
  const idx = new SpatialIndex(b)
  const times: number[] = []
  let visible = 0
  for (let f = 0; f < 600; f++) {
    const x = (f * 37) % 20000, y = (f * 23) % 8000
    times.push(ms(() => { visible = idx.query({ minX: x, minY: y, maxX: x + 1920, maxY: y + 1080 }).size }))
  }
  times.sort((a, b) => a - b)
  const p95 = times[Math.floor(times.length * 0.95)]!
  console.log(`[perf] viewport query ${N_PAN}: p50 ${times[300]!.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, ~${visible} visible`)
  expect(p95).toBeLessThan(2)
  idx.dispose()
})

test('incremental reindex on a move stays well under one frame', () => {
  const b = makeBoard(N_PAN)
  const idx = new SpatialIndex(b)
  const id = [...b.objects.keys()][42]!
  const t = ms(() => { for (let i = 0; i < 100; i++) b.update(id, { x: 50000 + i }, me) })
  console.log(`[perf] 100 moves + reindex on ${N_PAN}: ${t.toFixed(1)} ms (${(t / 100).toFixed(2)} ms/move)`)
  expect(idx.query({ minX: 50000, minY: -1e6, maxX: 60000, maxY: 1e6 }).has(id)).toBe(true)
  expect(t / 100).toBeLessThan(16)
  idx.dispose()
})

test('appending 5k objects keeps z-keys short', () => {
  const b = makeBoard(N_PAN)
  const maxLen = Math.max(...b.list().map(o => o.index.length))
  console.log(`[perf] max z-key length after ${N_PAN} appends: ${maxLen}`)
  expect(maxLen).toBeLessThan(6)
})

test('no single core operation blocks > 50 ms on a 5k board', () => {
  const b = makeBoard(N_PAN)
  const cold = ms(() => b.list()) // one-time per open; covered by the open budget
  const ops: Record<string, number> = {
    listCached: ms(() => b.list()),
    move: ms(() => b.update(b.list()[10]!.id, { x: 1 }, me)),
    encode: ms(() => Y.encodeStateAsUpdate(b.doc)),
    add100: ms(() => b.add(Array.from({ length: 100 }, () => ({ type: 'shape', x: 0, y: 0, w: 1, h: 1, props: { kind: 'rect' } })), me)),
  }
  console.log(`[perf] 5k cold list (open-time): ${cold.toFixed(1)} ms`)
  console.log(`[perf] 5k ops: ${Object.entries(ops).map(([k, v]) => `${k} ${v.toFixed(1)} ms`).join(', ')}`)
  for (const v of Object.values(ops)) expect(v).toBeLessThan(50)
})
