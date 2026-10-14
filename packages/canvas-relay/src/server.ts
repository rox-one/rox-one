/**
 * y-websocket–compatible relay on Bun.serve.
 *
 * Connect: ws(s)://host/r/<roomId>   (roomId = <workspaceId>:<boardId>)
 *   Token, preferred: subprotocols ['rox-canvas.v1', '<jws>'] — the server
 *   echoes 'rox-canvas.v1'. Fallback (stock y-websocket clients): ?token=<jws>.
 *   Request URLs are never logged, so tokens never reach logs.
 * Origin: when `allowedOrigins` is set, a request carrying an Origin header
 *   outside the list gets 403. Requests without Origin (native/desktop
 *   clients) still need a valid token. The CLI/Docker default requires the
 *   list (see main.ts).
 * Scopes: view/comment may read and send awareness; doc updates require edit
 *   (comment writes arrive in Phase 3 with server-side diffing).
 * Awareness: a clientID belongs to the first connection that announces it;
 *   other connections' states for it are dropped. `user.id`/`user.name` are
 *   overwritten from the token claims, so identity can't be spoofed.
 * Limits: payload cap, per-room doc size cap, per-room and global connection
 *   caps, per-connection message/byte rate limits. Sockets close at token exp.
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
export const SUBPROTOCOL = 'rox-canvas.v1'
export const MIN_SECRET_LENGTH = 32

export const CLOSE = { expired: 4001, rateLimited: 4008, docTooLarge: 4009, roomFull: 4013, loadFailed: 1011, badMessage: 1003 } as const

export interface RelayLimits {
  maxMessageBytes: number
  maxDocBytes: number
  maxConnsPerRoom: number
  maxConnsTotal: number
  /** Token bucket per connection. */
  msgsPerSecond: number
  bytesPerSecond: number
}
export const DEFAULT_LIMITS: RelayLimits = {
  maxMessageBytes: 1024 * 1024,
  maxDocBytes: 50 * 1024 * 1024,
  maxConnsPerRoom: 100,
  maxConnsTotal: 5000,
  msgsPerSecond: 100,
  bytesPerSecond: 2 * 1024 * 1024,
}

export interface RelayOptions {
  port: number
  hostname?: string
  dbPath: string
  secret: string
  compactEvery?: number
  allowedOrigins?: string[]
  limits?: Partial<RelayLimits>
  log?: (msg: string) => void
}

interface Bucket { msgs: number; bytes: number; at: number }
interface Conn { room: string; claims: RoomClaims; controlled: Set<number>; bucket: Bucket; expTimer?: ReturnType<typeof setTimeout> }
type WS = ServerWebSocket<Conn>

class Room {
  readonly conns = new Set<WS>()
  readonly awareness: awarenessProtocol.Awareness
  /** clientID → owning connection. */
  readonly owners = new Map<number, WS>()
  bytes: number
  constructor(readonly name: string, readonly doc: Y.Doc, private store: RoomStore, private compactEvery: number) {
    this.bytes = Y.encodeStateAsUpdate(doc).length
    this.awareness = new awarenessProtocol.Awareness(doc)
    this.awareness.setLocalState(null)
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (this.store.append(name, update) >= this.compactEvery) {
        this.store.compact(name, doc)
        this.bytes = Y.encodeStateAsUpdate(doc).length
      }
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeUpdate(enc, update)
      this.broadcast(encoding.toUint8Array(enc), origin as WS | undefined)
    })
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const ws = origin as WS | undefined
      if (ws && this.conns.has(ws)) {
        for (const id of added) ws.data.controlled.add(id)
        for (const id of removed) { ws.data.controlled.delete(id); if (this.owners.get(id) === ws) this.owners.delete(id) }
      }
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]))
      this.broadcast(encoding.toUint8Array(enc))
    })
  }
  broadcast(msg: Uint8Array, except?: WS) {
    for (const c of this.conns) if (c !== except) c.sendBinary(msg)
  }
}

/**
 * Keep only entries whose clientID is unowned or owned by `ws`; claim new ones;
 * pin `user.id`/`user.name` from the token. Returns a re-encoded update or null.
 */
export function sanitizeAwareness(update: Uint8Array, ws: { data: Pick<Conn, 'claims'> }, owners: Map<number, unknown>): Uint8Array | null {
  const dec = decoding.createDecoder(update)
  const n = decoding.readVarUint(dec)
  const kept: { id: number; clock: number; json: string }[] = []
  for (let i = 0; i < n; i++) {
    const id = decoding.readVarUint(dec)
    const clock = decoding.readVarUint(dec)
    const raw = decoding.readVarString(dec)
    const owner = owners.get(id)
    if (owner !== undefined && owner !== ws) continue
    let state: unknown = JSON.parse(raw)
    if (state !== null) {
      if (typeof state !== 'object' || Array.isArray(state)) continue
      const s = state as Record<string, unknown>
      const user = s.user && typeof s.user === 'object' && !Array.isArray(s.user) ? (s.user as Record<string, unknown>) : {}
      s.user = { ...user, id: ws.data.claims.sub, name: ws.data.claims.name ?? (typeof user.name === 'string' ? user.name.slice(0, 80) : ws.data.claims.sub) }
      state = s
      owners.set(id, ws)
    }
    kept.push({ id, clock, json: JSON.stringify(state) })
  }
  if (!kept.length) return null
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, kept.length)
  for (const k of kept) { encoding.writeVarUint(enc, k.id); encoding.writeVarUint(enc, k.clock); encoding.writeVarString(enc, k.json) }
  return encoding.toUint8Array(enc)
}

function takeToken(bucket: Bucket, bytes: number, limits: RelayLimits, now = Date.now()): boolean {
  const dt = (now - bucket.at) / 1000
  bucket.at = now
  bucket.msgs = Math.min(limits.msgsPerSecond * 2, bucket.msgs + dt * limits.msgsPerSecond)
  bucket.bytes = Math.min(limits.bytesPerSecond * 2, bucket.bytes + dt * limits.bytesPerSecond)
  if (bucket.msgs < 1 || bucket.bytes < bytes) return false
  bucket.msgs -= 1
  bucket.bytes -= bytes
  return true
}

export function startRelay(opts: RelayOptions) {
  if (typeof opts.secret !== 'string' || opts.secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`canvas-relay: secret must be at least ${MIN_SECRET_LENGTH} characters`)
  }
  const limits: RelayLimits = { ...DEFAULT_LIMITS, ...opts.limits }
  const log = opts.log ?? ((m: string) => console.log(`[canvas-relay] ${m}`))
  const store = new RoomStore(opts.dbPath)
  const rooms = new Map<string, Room>()
  let totalConns = 0

  const getRoom = (name: string): Room => {
    let r = rooms.get(name)
    if (!r) { r = new Room(name, store.load(name), store, opts.compactEvery ?? 500); rooms.set(name, r) }
    return r
  }

  const server = Bun.serve<Conn>({
    port: opts.port,
    hostname: opts.hostname,
    // Own error handler: Bun's default logs the full request URL, which may carry ?token=.
    error(err) {
      log(`request error: ${err.name}: ${err.message.replace(/token=[^&\s']+/g, 'token=[redacted]')}`)
      return new Response('internal error', { status: 500 })
    },
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === '/healthz') return Response.json({ ok: true, rooms: rooms.size, conns: totalConns })
      const m = url.pathname.match(/^\/r\/([^/]+)$/)
      if (!m) return new Response('not found', { status: 404 })
      let room: string
      try { room = decodeURIComponent(m[1]!) } catch { return new Response('bad room', { status: 400 }) }
      if (!ROOM_RE.test(room)) return new Response('bad room', { status: 400 })
      const origin = req.headers.get('origin')
      if (origin && opts.allowedOrigins?.length && !opts.allowedOrigins.includes(origin)) return new Response('forbidden origin', { status: 403 })
      const offered = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map(s => s.trim()).filter(Boolean)
      const protoToken = offered.find(s => s.split('.').length === 3)
      const token = protoToken ?? url.searchParams.get('token') ?? ''
      const v = await verifyRoomToken(token, room, opts.secret)
      if (!v.ok) { log(`auth rejected room=${room} reason=${v.reason}`); return new Response('unauthorized', { status: 401 }) }
      if (totalConns >= limits.maxConnsTotal) return new Response('server full', { status: 503 })
      if ((rooms.get(room)?.conns.size ?? 0) >= limits.maxConnsPerRoom) return new Response('room full', { status: 503 })
      const headers: Record<string, string> = {}
      if (offered.includes(SUBPROTOCOL)) headers['Sec-WebSocket-Protocol'] = SUBPROTOCOL
      else if (protoToken) headers['Sec-WebSocket-Protocol'] = protoToken // client offered only the token
      const data: Conn = { room, claims: v.claims, controlled: new Set(), bucket: { msgs: limits.msgsPerSecond * 2, bytes: limits.bytesPerSecond * 2, at: Date.now() } }
      if (srv.upgrade(req, { data, headers: new Headers(headers) })) return undefined
      return new Response('upgrade required', { status: 426 })
    },
    websocket: {
      maxPayloadLength: limits.maxMessageBytes,
      open(ws) {
        let room: Room
        try { room = getRoom(ws.data.room) } catch (e) {
          // Never create/compact a room we failed to read: stored rows stay untouched.
          log(`load failed room=${ws.data.room}: ${(e as Error).message}`)
          ws.close(CLOSE.loadFailed, 'load failed')
          return
        }
        if (room.conns.size >= limits.maxConnsPerRoom) { ws.close(CLOSE.roomFull, 'room full'); return }
        room.conns.add(ws)
        totalConns++
        const ms = ws.data.claims.exp * 1000 - Date.now()
        ws.data.expTimer = setTimeout(() => ws.close(CLOSE.expired, 'token expired'), Math.max(0, ms))
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
        if (!room || !room.conns.has(ws)) return
        const bytes = new Uint8Array(raw)
        if (!takeToken(ws.data.bucket, bytes.length, limits)) { ws.close(CLOSE.rateLimited, 'rate limited'); return }
        try {
          const dec = decoding.createDecoder(bytes)
          const type = decoding.readVarUint(dec)
          if (type === MSG_SYNC) {
            const sub = decoding.readVarUint(dec)
            if (sub === syncProtocol.messageYjsSyncStep1) {
              const enc = encoding.createEncoder()
              encoding.writeVarUint(enc, MSG_SYNC)
              syncProtocol.readSyncStep1(dec, enc, room.doc)
              ws.sendBinary(encoding.toUint8Array(enc))
            } else if (sub === syncProtocol.messageYjsSyncStep2 || sub === syncProtocol.messageYjsUpdate) {
              if (ws.data.claims.scope !== 'edit') return // read-only scope
              const update = decoding.readVarUint8Array(dec)
              if (room.bytes + update.length > limits.maxDocBytes) { ws.close(CLOSE.docTooLarge, 'document too large'); return }
              Y.applyUpdate(room.doc, update, ws)
              room.bytes += update.length
            }
          } else if (type === MSG_AWARENESS) {
            const clean = sanitizeAwareness(decoding.readVarUint8Array(dec), ws, room.owners)
            if (clean) awarenessProtocol.applyAwarenessUpdate(room.awareness, clean, ws)
          }
        } catch {
          ws.close(CLOSE.badMessage, 'bad message')
        }
      },
      close(ws) {
        if (ws.data.expTimer) clearTimeout(ws.data.expTimer)
        const room = rooms.get(ws.data.room)
        if (!room || !room.conns.delete(ws)) return
        totalConns--
        for (const [id, owner] of room.owners) if (owner === ws) room.owners.delete(id)
        awarenessProtocol.removeAwarenessStates(room.awareness, [...ws.data.controlled], null)
        if (room.conns.size === 0) {
          try { store.compact(room.name, room.doc) } catch (e) { log(`compact failed room=${room.name}: ${(e as Error).message}`) }
          room.awareness.destroy()
          room.doc.destroy()
          rooms.delete(room.name)
          store.forget(room.name)
        }
      },
    },
  })

  return {
    server,
    port: server.port,
    stop() {
      server.stop(true)
      for (const r of rooms.values()) {
        try { store.compact(r.name, r.doc) } catch (e) { log(`compact failed room=${r.name}: ${(e as Error).message}`) }
      }
      rooms.clear()
      store.close()
    },
  }
}
