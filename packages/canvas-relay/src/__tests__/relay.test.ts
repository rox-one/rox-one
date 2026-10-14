import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { armExpiry, CLOSE, MAX_CLIENT_IDS, MSG_AUTH, RoomStore, signRoomToken, startRelay, SUBPROTOCOL, verifyRoomToken, type RelayOptions } from '../index.ts'

const SECRET = 'x'.repeat(40)
const ROOM = 'ws1:b1'
const ISS = 'https://id.test'
const AUD = 'rox-canvas'
const V = { secret: SECRET, issuer: ISS, audience: AUD }
const dir = mkdtempSync(join(tmpdir(), 'relay-'))
const relays: { stop(): void }[] = []
afterAll(() => { for (const r of relays) try { r.stop() } catch {} })
function relay(over: Partial<RelayOptions> = {}, db = join(dir, `${Math.random()}.sqlite`)) {
  const r = startRelay({ port: 0, dbPath: db, secret: SECRET, issuer: ISS, audience: AUD, log: () => {}, ...over })
  relays.push(r)
  return r
}
const now = () => Math.floor(Date.now() / 1000)
type TokOpts = { room?: string; exp?: number; iat?: number; sub?: string; name?: string; iss?: string; aud?: string; epoch?: number }
const tok = (scope: 'edit' | 'view', o: TokOpts = {}) => {
  const iat = o.iat ?? now()
  return signRoomToken({ sub: o.sub ?? 'u', name: o.name, room: o.room ?? ROOM, scope, iss: o.iss ?? ISS, aud: o.aud ?? AUD, iat, nbf: iat, exp: o.exp ?? now() + 60, epoch: o.epoch }, SECRET)
}

/** Promise that resolves when `pred` becomes true, checked on every doc/awareness change. */
function until(pred: () => boolean, subscribe: (cb: () => void) => () => void, ms = 5000): Promise<void> {
  return new Promise((res, rej) => {
    if (pred()) return res()
    const t = setTimeout(() => { off(); rej(new Error('timeout waiting for condition')) }, ms)
    const off = subscribe(() => { if (pred()) { clearTimeout(t); off(); res() } })
  })
}

function client(port: number | undefined, token: string, opts: { via?: 'protocol' | 'query' } = {}) {
  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  const url = `ws://localhost:${port}/r/${ROOM}` + (opts.via === 'query' ? `?token=${token}` : '')
  const ws = opts.via === 'query' ? new WebSocket(url) : new WebSocket(url, [SUBPROTOCOL, token])
  ws.binaryType = 'arraybuffer'
  let synced = false
  const listeners = new Set<() => void>()
  const notify = () => { for (const l of [...listeners]) l() }
  const send = (b: Uint8Array) => { if (ws.readyState === 1) ws.send(b) }
  ws.onmessage = e => {
    const dec = decoding.createDecoder(new Uint8Array(e.data as ArrayBuffer))
    const t = decoding.readVarUint(dec)
    if (t === 0) {
      const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0)
      const kind = syncProtocol.readSyncMessage(dec, enc, doc, 'remote')
      if (kind === syncProtocol.messageYjsSyncStep2) synced = true
      if (encoding.length(enc) > 1) send(encoding.toUint8Array(enc))
    } else if (t === 1) awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), 'remote')
    notify()
  }
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeUpdate(enc, u); send(encoding.toUint8Array(enc))
  })
  const closed = new Promise<number>(res => { ws.onclose = e => { notify(); res(e.code) } })
  const opened = new Promise<void>((res, rej) => {
    ws.onopen = () => { const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeSyncStep1(enc, doc); send(encoding.toUint8Array(enc)); res() }
    ws.onerror = () => rej(new Error('ws error'))
  })
  const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb) }
  const isSynced = () => until(() => synced, subscribe)
  return { doc, awareness, ws, opened, closed, subscribe, isSynced, send }
}

describe('auth', () => {
  test('token verification', async () => {
    const reason = async (t: Promise<string>, o: Parameters<typeof verifyRoomToken>[2] = V) => { const r = await verifyRoomToken(await t, ROOM, o); return r.ok ? 'ok' : r.reason }
    expect(await reason(tok('edit'))).toBe('ok')
    expect(await reason(tok('edit', { room: 'ws1:other' }))).toBe('room')
    expect(await reason(tok('edit', { iat: 1, exp: 2 }))).toBe('expired')
    expect(await reason(tok('edit'), { ...V, secret: 'y'.repeat(40) })).toBe('signature')
    expect(await reason(tok('edit', { exp: now() + 16 * 60 }))).toBe('ttl')
    expect(await reason(tok('edit', { iss: 'https://evil' }))).toBe('iss')
    expect(await reason(tok('edit', { aud: 'other' }))).toBe('aud')
    expect(await reason(tok('edit', { iat: now() + 3600, exp: now() + 3700 }))).toBe('nbf')
    expect(await reason(tok('edit', { epoch: 1 }), { ...V, minEpoch: () => 2 })).toBe('revoked')
    const noIat = await signRoomToken({ sub: 'u', room: ROOM, scope: 'edit', iss: ISS, aud: AUD, exp: now() + 60 } as never, SECRET)
    expect((await verifyRoomToken(noIat, ROOM, V)).ok).toBe(false)
  })
  test('short secret is refused', () => {
    expect(() => startRelay({ port: 0, dbPath: join(dir, 'short.sqlite'), secret: 'short', issuer: ISS, audience: AUD })).toThrow()
  })
  test('HTTP errors: bad token 401, bad URI 400, bad origin 403', async () => {
    const r = relay({ allowedOrigins: ['https://ok.example'] })
    const base = `http://localhost:${r.port}`
    expect((await fetch(`${base}/r/${ROOM}?token=nope`)).status).toBe(401)
    expect((await fetch(`${base}/r/%E0%A4%A`)).status).toBe(400)
    expect((await fetch(`${base}/r/${ROOM}?token=${await tok('edit')}`, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
  })
  test('subprotocol is echoed; query token still works', async () => {
    const r = relay()
    const a = client(r.port, await tok('edit'))
    await a.opened
    expect(a.ws.protocol).toBe(SUBPROTOCOL)
    const b = client(r.port, await tok('edit'), { via: 'query' })
    await b.opened
    await b.isSynced()
    a.ws.close(); b.ws.close()
  })
  test('socket closes at token expiry', async () => {
    const r = relay()
    const c = client(r.port, await tok('edit', { exp: now() + 1 }))
    await c.opened
    expect(await c.closed).toBe(CLOSE.expired)
  })
})

describe('sync', () => {
  test('two editors converge, viewer cannot write, state survives restart', async () => {
    const db = join(dir, 'persist.sqlite')
    let r = relay({ compactEvery: 3 }, db)
    const a = client(r.port, await tok('edit')), b = client(r.port, await tok('edit')), v = client(r.port, await tok('view'))
    await Promise.all([a.isSynced(), b.isSynced(), v.isSynced()])
    a.doc.getMap('objects').set('x', 1)
    b.doc.getMap('objects').set('y', 2)
    v.doc.getMap('objects').set('evil', 1)
    const both = (d: Y.Doc) => d.getMap('objects').has('x') && d.getMap('objects').has('y')
    await Promise.all([until(() => both(a.doc), a.subscribe), until(() => both(b.doc), b.subscribe), until(() => both(v.doc), v.subscribe)])
    expect(a.doc.getMap('objects').has('evil')).toBe(false)
    for (const c of [a, b, v]) c.ws.close()
    await Promise.all([a.closed, b.closed, v.closed])
    r.stop()
    r = relay({}, db)
    const c = client(r.port, await tok('view'))
    await c.isSynced()
    expect(c.doc.getMap('objects').toJSON()).toEqual({ x: 1, y: 2 })
    c.ws.close()
  })
  test('per-room doc size cap closes the writer', async () => {
    const r = relay({ limits: { maxDocBytes: 2000 } })
    const a = client(r.port, await tok('edit'))
    await a.isSynced()
    a.doc.getText('t').insert(0, 'z'.repeat(5000))
    expect(await a.closed).toBe(CLOSE.docTooLarge)
  })
  test('rate limit closes a flooding connection', async () => {
    const r = relay({ limits: { msgsPerSecond: 5 } })
    const a = client(r.port, await tok('edit'))
    await a.isSynced()
    for (let i = 0; i < 50; i++) a.doc.getMap('m').set(`k${i}`, i)
    expect(await a.closed).toBe(CLOSE.rateLimited)
  })
  test('connection cap per room', async () => {
    const r = relay({ limits: { maxConnsPerRoom: 1 } })
    const a = client(r.port, await tok('edit'))
    await a.opened
    const res = await fetch(`http://localhost:${r.port}/r/${ROOM}?token=${await tok('edit')}`, { headers: { upgrade: 'websocket', connection: 'upgrade', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } })
    expect(res.status).toBe(503)
    a.ws.close()
  })
})

describe('awareness', () => {
  test('identity pinned from claims; clientID hijack dropped', async () => {
    const r = relay()
    const alice = client(r.port, await tok('edit', { sub: 'alice', name: 'Alice' }))
    const mallory = client(r.port, await tok('edit', { sub: 'mallory', name: 'Mallory' }))
    const watcher = client(r.port, await tok('view', { sub: 'w' }))
    await Promise.all([alice.isSynced(), mallory.isSynced(), watcher.isSynced()])
    alice.awareness.setLocalState({ user: { id: 'ceo', name: 'CEO' }, cursor: { x: 1, y: 1 } })
    const aliceId = alice.doc.clientID
    const sendAw = (c: ReturnType<typeof client>, aw: awarenessProtocol.Awareness, ids: number[]) => {
      const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 1)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(aw, ids)); c.send(encoding.toUint8Array(enc))
    }
    sendAw(alice, alice.awareness, [aliceId!])
    const userOf = (id: number) => (watcher.awareness.getStates().get(id) as { user?: { id: string; name: string } } | undefined)?.user
    await until(() => userOf(aliceId) !== undefined, watcher.subscribe)
    expect(userOf(aliceId)).toEqual({ id: 'alice', name: 'Alice' })
    // Mallory forges an update for Alice's clientID with a higher clock.
    const forged = new awarenessProtocol.Awareness(new Y.Doc())
    ;(forged as unknown as { clientID: number }).clientID = aliceId
    forged.setLocalState({ user: { id: 'alice', name: 'pwned' } })
    forged.setLocalState({ user: { id: 'alice', name: 'pwned2' } })
    forged.setLocalState({ user: { id: 'alice', name: 'pwned3' } })
    sendAw(mallory, forged, [aliceId!])
    // Alice then moves; once her update arrives, the forged one must not have won.
    alice.awareness.setLocalState({ user: {}, cursor: { x: 9, y: 9 } })
    alice.awareness.setLocalState({ user: {}, cursor: { x: 10, y: 10 } })
    alice.awareness.setLocalState({ user: {}, cursor: { x: 11, y: 11 } })
    alice.awareness.setLocalState({ user: {}, cursor: { x: 12, y: 12 } })
    sendAw(alice, alice.awareness, [aliceId!])
    const cursorOf = (id: number) => (watcher.awareness.getStates().get(id) as { cursor?: { x: number } } | undefined)?.cursor?.x
    await until(() => cursorOf(aliceId) === 12, watcher.subscribe)
    expect(userOf(aliceId)).toEqual({ id: 'alice', name: 'Alice' })
    for (const c of [alice, mallory, watcher]) c.ws.close()
  })
})

describe('re-review fixes', () => {
  test('expiry timer never overflows setTimeout', async () => {
    let closed = false
    const fake = { data: {} as { expTimer?: ReturnType<typeof setTimeout> }, close: () => { closed = true } }
    armExpiry(fake as never, now() + 60 * 24 * 3600) // 60 days > 2^31-1 ms
    await Bun.sleep(30) // an overflowed timer fires after ~1 ms
    expect(closed).toBe(false)
    clearTimeout(fake.data.expTimer)
  })
  test('in-band refresh extends the session; a refresh for another sub closes it', async () => {
    const r = relay()
    const c = client(r.port, await tok('edit', { exp: now() + 2 }))
    await c.isSynced()
    const auth = async (t: string) => { const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_AUTH); encoding.writeVarString(e, t); c.send(encoding.toUint8Array(e)) }
    await auth(await tok('edit', { exp: now() + 600 }))
    const early = await Promise.race([c.closed.then(() => 'closed'), Bun.sleep(2600).then(() => 'open')])
    expect(early).toBe('open')
    await auth(await tok('edit', { sub: 'someone-else' }))
    expect(await c.closed).toBe(CLOSE.expired)
  })
  test('revocation closes live sockets and rejects new ones', async () => {
    const r = relay()
    const c = client(r.port, await tok('edit', { sub: 'bob' }))
    await c.isSynced()
    r.revoke(ROOM, 'bob', 1)
    expect(await c.closed).toBe(CLOSE.revoked)
    expect((await fetch(`http://localhost:${r.port}/r/${ROOM}?token=${await tok('edit', { sub: 'bob' })}`)).status).toBe(401)
    const ok = client(r.port, await tok('edit', { sub: 'bob', epoch: 1 }))
    await ok.isSynced()
    ok.ws.close()
  })
  test(`awareness: at most ${MAX_CLIENT_IDS} clientIDs per connection and a size cap per state`, async () => {
    const r = relay({ limits: { maxAwarenessBytes: 512 } })
    const a = client(r.port, await tok('edit', { sub: 'a' }))
    const w = client(r.port, await tok('view', { sub: 'w' }))
    await Promise.all([a.isSynced(), w.isSynced()])
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 1)
    const inner = encoding.createEncoder()
    encoding.writeVarUint(inner, 7)
    for (let id = 1; id <= 6; id++) { encoding.writeVarUint(inner, 1000 + id); encoding.writeVarUint(inner, 1); encoding.writeVarString(inner, JSON.stringify({ n: id })) }
    encoding.writeVarUint(inner, 2000); encoding.writeVarUint(inner, 1); encoding.writeVarString(inner, JSON.stringify({ big: 'x'.repeat(1000) }))
    encoding.writeVarUint8Array(enc, encoding.toUint8Array(inner))
    a.send(encoding.toUint8Array(enc))
    await until(() => w.awareness.getStates().size >= MAX_CLIENT_IDS, w.subscribe)
    const ids = [...w.awareness.getStates().keys()].filter(id => id >= 1000 && id <= 2000)
    expect(ids.length).toBe(MAX_CLIENT_IDS)
    expect(ids).not.toContain(2000)
    a.ws.close(); w.ws.close()
  })
  test('only real growth counts toward the size cap', async () => {
    const r = relay({ limits: { maxDocBytes: 1500 } })
    const src = new Y.Doc(); src.getText('t').insert(0, 'y'.repeat(1000))
    const update = Y.encodeStateAsUpdate(src)
    const a = client(r.port, await tok('edit')), b = client(r.port, await tok('edit'))
    await Promise.all([a.isSynced(), b.isSynced()])
    Y.applyUpdate(a.doc, update)
    await until(() => b.doc.getText('t').length === 1000, b.subscribe)
    // b re-sends the same content: no growth, so no cap violation.
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeUpdate(enc, update); b.send(encoding.toUint8Array(enc))
    b.doc.getMap('m').set('k', 1)
    await until(() => a.doc.getMap('m').get('k') === 1, a.subscribe)
    a.ws.close(); b.ws.close()
  })
  test('append failure closes 1011 and nothing is applied', async () => {
    const store = new RoomStore(join(dir, 'fail.sqlite'))
    store.append = () => { throw new Error('disk full') }
    const r = relay({ store })
    const a = client(r.port, await tok('edit')), w = client(r.port, await tok('view'))
    await Promise.all([a.isSynced(), w.isSynced()])
    a.doc.getMap('m').set('k', 1)
    expect(await a.closed).toBe(CLOSE.serverError)
    const v = client(r.port, await tok('view'))
    await v.isSynced()
    expect(v.doc.getMap('m').has('k')).toBe(false)
    expect(w.doc.getMap('m').has('k')).toBe(false)
    v.ws.close(); w.ws.close()
  })
  test('compaction runs on idle, not inline', async () => {
    const store = new RoomStore(join(dir, 'idle.sqlite'))
    let compacts = 0
    const orig = store.compact.bind(store)
    let onCompact = () => {}
    store.compact = (room, doc) => { compacts++; orig(room, doc); onCompact() }
    const r = relay({ store, compactEvery: 2, compactIdleMs: 100 })
    const a = client(r.port, await tok('edit'))
    await a.isSynced()
    a.doc.getMap('m').set('a', 1); a.doc.getMap('m').set('b', 2); a.doc.getMap('m').set('c', 3)
    await until(() => a.doc.getMap('m').size === 3, a.subscribe)
    expect(compacts).toBe(0)
    await new Promise<void>(res => { onCompact = res })
    expect(compacts).toBe(1)
    a.ws.close()
  })
  test('global connection cap holds under concurrent upgrades', async () => {
    const r = relay({ limits: { maxConnsTotal: 1 } })
    const t = await tok('edit')
    const cs = [client(r.port, t), client(r.port, t), client(r.port, t)]
    const results = await Promise.all(cs.map(c => c.opened.then(() => Promise.race([c.closed.then(() => 'closed'), c.isSynced().then(() => 'ok')])).catch(() => 'refused')))
    expect(results.filter(x => x === 'ok').length).toBe(1)
    for (const c of cs) c.ws.close()
  })
})
