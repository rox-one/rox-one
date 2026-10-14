/**
 * y-websocket–compatible relay on Bun.serve.
 * URL: ws(s)://host/r/<roomId>?token=<jws>   (roomId = <workspaceId>:<boardId>)
 * Messages: [0=sync | 1=awareness] per y-protocols. Clients with scope
 * view/comment may sync-read and send awareness but their doc updates are
 * rejected (comment-scope writes arrive in Phase 3 with server-side diffing).
 */
import type { ServerWebSocket } from 'bun'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { verifyRoomToken, type RoomClaims } from './auth.ts'
import { RoomStore } from './store.ts'

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/

export interface RelayOptions {
  port: number
  hostname?: string
  dbPath: string
  secret: string
  compactEvery?: number
  maxMessageBytes?: number
  allowedOrigins?: string[]
}

interface Conn { room: string; claims: RoomClaims; controlled: Set<number> }

class Room {
  readonly conns = new Set<ServerWebSocket<Conn>>()
  readonly awareness: awarenessProtocol.Awareness
  constructor(readonly name: string, readonly doc: Y.Doc, private store: RoomStore, private compactEvery: number) {
    this.awareness = new awarenessProtocol.Awareness(doc)
    this.awareness.setLocalState(null)
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (this.store.append(name, update) >= this.compactEvery) this.store.compact(name, doc)
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeUpdate(enc, update)
      this.broadcast(encoding.toUint8Array(enc), origin as ServerWebSocket<Conn> | undefined)
    })
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed]
      const ws = origin as ServerWebSocket<Conn> | undefined
      if (ws && this.conns.has(ws)) {
        for (const id of added) ws.data.controlled.add(id)
        for (const id of removed) ws.data.controlled.delete(id)
      }
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
      this.broadcast(encoding.toUint8Array(enc))
    })
  }
  broadcast(msg: Uint8Array, except?: ServerWebSocket<Conn>) {
    for (const c of this.conns) if (c !== except) c.sendBinary(msg)
  }
}

export function startRelay(opts: RelayOptions) {
  const store = new RoomStore(opts.dbPath)
  const rooms = new Map<string, Room>()
  const maxBytes = opts.maxMessageBytes ?? 8 * 1024 * 1024
  const getRoom = (name: string) => {
    let r = rooms.get(name)
    if (!r) { r = new Room(name, store.load(name), store, opts.compactEvery ?? 500); rooms.set(name, r) }
    return r
  }

  const server = Bun.serve<Conn>({
    port: opts.port,
    hostname: opts.hostname,
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === '/healthz') return Response.json({ ok: true, rooms: rooms.size })
      const m = url.pathname.match(/^\/r\/([^/]+)$/)
      if (!m) return new Response('not found', { status: 404 })
      const room = decodeURIComponent(m[1]!)
      if (!ROOM_RE.test(room)) return new Response('bad room', { status: 400 })
      const origin = req.headers.get('origin')
      if (origin && opts.allowedOrigins?.length && !opts.allowedOrigins.includes(origin)) return new Response('forbidden origin', { status: 403 })
      const token = url.searchParams.get('token') ?? req.headers.get('sec-websocket-protocol')?.split(',').map(s => s.trim()).find(s => s.split('.').length === 3) ?? ''
      const v = await verifyRoomToken(token, room, opts.secret)
      if (!v.ok) return new Response('unauthorized', { status: 401 })
      if (srv.upgrade(req, { data: { room, claims: v.claims, controlled: new Set() } })) return undefined
      return new Response('upgrade required', { status: 426 })
    },
    websocket: {
      maxPayloadLength: maxBytes,
      open(ws) {
        const room = getRoom(ws.data.room)
        room.conns.add(ws)
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MSG_SYNC)
        syncProtocol.writeSyncStep1(enc, room.doc)
        ws.sendBinary(encoding.toUint8Array(enc))
        const states = [...room.awareness.getStates().keys()]
        if (states.length) {
          const a = encoding.createEncoder()
          encoding.writeVarUint(a, MSG_AWARENESS)
          encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(room.awareness, states))
          ws.sendBinary(encoding.toUint8Array(a))
        }
      },
      message(ws, raw) {
        if (typeof raw === 'string') return
        const room = rooms.get(ws.data.room)
        if (!room) return
        try {
          const dec = decoding.createDecoder(new Uint8Array(raw))
          const type = decoding.readVarUint(dec)
          if (type === MSG_SYNC) {
            const sub = decoding.peekVarUint(dec)
            if (sub !== syncProtocol.messageYjsSyncStep1 && ws.data.claims.scope !== 'edit') return // read-only scope
            const enc = encoding.createEncoder()
            encoding.writeVarUint(enc, MSG_SYNC)
            syncProtocol.readSyncMessage(dec, enc, room.doc, ws)
            if (encoding.length(enc) > 1) ws.sendBinary(encoding.toUint8Array(enc))
          } else if (type === MSG_AWARENESS) {
            awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), ws)
          }
        } catch {
          ws.close(1003, 'bad message')
        }
      },
      close(ws) {
        const room = rooms.get(ws.data.room)
        if (!room) return
        room.conns.delete(ws)
        awarenessProtocol.removeAwarenessStates(room.awareness, [...ws.data.controlled], null)
        if (room.conns.size === 0) {
          store.compact(room.name, room.doc)
          room.awareness.destroy()
          room.doc.destroy()
          rooms.delete(room.name)
        }
      },
    },
  })

  return {
    server,
    port: server.port,
    stop() {
      for (const r of rooms.values()) store.compact(r.name, r.doc)
      server.stop(true)
      store.close()
    },
  }
}
