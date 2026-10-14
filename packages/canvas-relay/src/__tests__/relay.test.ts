import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { signRoomToken, startRelay, verifyRoomToken } from '../index.ts'

const SECRET = 'x'.repeat(40)
const dir = mkdtempSync(join(tmpdir(), 'relay-'))
let relay = startRelay({ port: 0, dbPath: join(dir, 'db.sqlite'), secret: SECRET, compactEvery: 3 })
afterAll(() => relay.stop())
const ROOM = 'ws1:b1'
const tok = (scope: 'edit' | 'view', room = ROOM, exp = Math.floor(Date.now() / 1000) + 60) => signRoomToken({ sub: 'u', room, scope, exp }, SECRET)

function client(token: string) {
  const doc = new Y.Doc()
  const ws = new WebSocket(`ws://localhost:${relay.port}/r/${ROOM}?token=${token}`)
  ws.binaryType = 'arraybuffer'
  ws.onmessage = e => {
    const dec = decoding.createDecoder(new Uint8Array(e.data as ArrayBuffer))
    if (decoding.readVarUint(dec) !== 0) return
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0)
    syncProtocol.readSyncMessage(dec, enc, doc, 'remote')
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc))
  }
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin === 'remote' || ws.readyState !== 1) return
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeUpdate(enc, u); ws.send(encoding.toUint8Array(enc))
  })
  const opened = new Promise<void>((res, rej) => { ws.onopen = () => { const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeSyncStep1(enc, doc); ws.send(encoding.toUint8Array(enc)); res() }; ws.onerror = () => rej(new Error('ws error')) })
  return { doc, ws, opened }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

test('token verification', async () => {
  expect((await verifyRoomToken(await tok('edit'), ROOM, SECRET)).ok).toBe(true)
  expect((await verifyRoomToken(await tok('edit', 'ws1:other'), ROOM, SECRET)).ok).toBe(false)
  expect((await verifyRoomToken(await tok('edit', ROOM, 1), ROOM, SECRET)).ok).toBe(false)
  expect((await verifyRoomToken(await tok('edit'), ROOM, 'y'.repeat(40))).ok).toBe(false)
})

test('rejects bad token over HTTP', async () => {
  const r = await fetch(`http://localhost:${relay.port}/r/${ROOM}?token=nope`, { headers: { upgrade: 'websocket' } })
  expect(r.status).toBe(401)
})

test('two editors converge, viewer cannot write, state survives restart', async () => {
  const a = client(await tok('edit')), b = client(await tok('edit')), v = client(await tok('view'))
  await Promise.all([a.opened, b.opened, v.opened])
  a.doc.getMap('objects').set('x', 1)
  b.doc.getMap('objects').set('y', 2)
  v.doc.getMap('objects').set('evil', 1)
  await wait(200)
  expect(a.doc.getMap('objects').toJSON()).toEqual({ x: 1, y: 2 })
  expect(b.doc.getMap('objects').toJSON()).toEqual({ x: 1, y: 2 })
  for (const c of [a, b, v]) c.ws.close()
  await wait(100)
  relay.stop()
  relay = startRelay({ port: 0, dbPath: join(dir, 'db.sqlite'), secret: SECRET })
  const c = client(await tok('view'))
  await c.opened
  await wait(150)
  expect(c.doc.getMap('objects').toJSON()).toEqual({ x: 1, y: 2 })
  c.ws.close()
})
