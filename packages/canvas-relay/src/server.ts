/**
 * y-websocket–compatible relay on Bun.serve.
 *
 * Connect: ws(s)://host/r/<roomId>   (roomId = <workspaceId>:<boardId>)
 *   Token: subprotocols ['rox-canvas.v1', '<jws>'] (the server echoes
 *   'rox-canvas.v1'); the Rox desktop client uses only this. `?token=` is
 *   accepted for stock y-websocket clients — disable query-string logging at
 *   the reverse proxy (see README). The relay itself never logs URLs.
 * Refresh: tokens live ≤ 15 min. Before expiry the client sends
 *   [2=auth, varString token]; the server verifies it (same room and sub,
 *   revocation epoch checked again) and re-arms the expiry close.
 * Origin: with `allowedOrigins`, requests carrying a foreign Origin get 403;
 *   requests without Origin (desktop) still need a valid token.
 * Scopes: view/comment may read and send awareness; doc updates need edit.
 * Awareness: ≤ MAX_CLIENT_IDS clientIDs per connection, each state ≤
 *   maxAwarenessBytes; a clientID belongs to the first connection announcing
 *   it; user.id/user.name are pinned from the token.
 * Writes: an update is persisted (SQLite append) BEFORE it is applied in
 *   memory; a failed append closes the writer with 1011 and nothing changes.
 *   Only real growth (the part of an update the doc doesn't have yet) counts
 *   toward the per-room size cap. Compaction runs on idle, never inline.
 */
import type { ServerWebSocket } from 'bun'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { verifyRoomToken, type RoomClaims } from './auth.ts'
import { RoomStore } from './store.ts'
import { timingSafeEqual } from 'node:crypto'

const MSG_SYNC = 0
const MSG_AWARENESS = 1
export const MSG_AUTH = 2
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}(~comments)?$/
/** Comments of a board live in their own Yjs doc, room `<board room>~comments`. */
export const COMMENTS_SUFFIX = '~comments'
/** Board room a (possibly comments) room belongs to: tokens and revocations are per board room. */
export const baseRoom = (room: string): string => (room.endsWith(COMMENTS_SUFFIX) ? room.slice(0, -COMMENTS_SUFFIX.length) : room)
/**
 * Scope mapping: edit writes both rooms; comment writes only the comments room
 * and is read-only on the board; view is read-only everywhere.
 */
export function canWrite(scope: string, room: string): boolean {
  if (scope === 'edit') return true
  return scope === 'comment' && room.endsWith(COMMENTS_SUFFIX)
}
export const SUBPROTOCOL = 'rox-canvas.v1'
export const MIN_SECRET_LENGTH = 32
export const MAX_CLIENT_IDS = 4
const MAX_TIMER_MS = 2 ** 31 - 1

export const CLOSE = { expired: 4001, revoked: 4003, rateLimited: 4008, docTooLarge: 4009, roomFull: 4013, serverError: 1011, badMessage: 1003 } as const

export interface RelayLimits {
  maxMessageBytes: number
  maxDocBytes: number
  maxConnsPerRoom: number
  maxConnsTotal: number
  msgsPerSecond: number
  bytesPerSecond: number
  maxAwarenessBytes: number
  maxLogRows: number
  maxLogBytes: number
}
export const DEFAULT_LIMITS: RelayLimits = {
  maxMessageBytes: 1024 * 1024,
  maxDocBytes: 50 * 1024 * 1024,
  maxConnsPerRoom: 100,
  maxConnsTotal: 5000,
  msgsPerSecond: 100,
  bytesPerSecond: 2 * 1024 * 1024,
  maxAwarenessBytes: 4096,
  /** Per-room update-log caps: reaching either forces an immediate compaction. */
  maxLogRows: 2000,
  maxLogBytes: 8 * 1024 * 1024,
}

export interface RelayOptions {
  port: number
  hostname?: string
  dbPath: string
  secret: string
  issuer: string
  audience: string
  /** Compact a room after this many updates once it's idle for `compactIdleMs`. */
  compactEvery?: number
  compactIdleMs?: number
  allowedOrigins?: string[]
  limits?: Partial<RelayLimits>
  log?: (msg: string) => void
  /** Test seam: replace the store (e.g. to inject failures). */
  store?: RoomStore
  /**
   * Bearer token for POST /admin/revoke (>= 32 chars). Unset = endpoint off.
   * Body: {"room": "<ws>:<board>", "sub": "<user id>|*", "epoch"?: <int ≥ 1>}
   * (epoch defaults to the current minimum + 1). Served on a separate admin
   * listener bound to `adminHostname` (default 127.0.0.1), never the public port.
   */
  adminToken?: string
  adminHostname?: string
  /** Admin listener port (0 = ephemeral). */
  adminPort?: number
}

const EMPTY_UPDATE_LEN = 2 // Y.diffUpdate of nothing new: 0 structs, 0 delete-set clients

interface Bucket { msgs: number; bytes: number; at: number }
interface Conn { room: string; claims: RoomClaims; controlled: Set<number>; bucket: Bucket; expTimer?: ReturnType<typeof setTimeout>; counted?: boolean; closed?: boolean; authSeq?: number }
type WS = ServerWebSocket<Conn>
export type RelayConn = Conn

/** Close `ws` at unix second `exp`, re-arming in ≤ 2^31-1 ms steps (setTimeout overflow). */
export function armExpiry(ws: WS, exp: number): void {
  if (ws.data.expTimer) clearTimeout(ws.data.expTimer)
  const ms = exp * 1000 - Date.now()
  if (ms <= 0) { ws.close(CLOSE.expired, 'token expired'); return }
  ws.data.expTimer = setTimeout(() => armExpiry(ws, exp), Math.min(ms, MAX_TIMER_MS))
}

class Room {
  readonly conns = new Set<WS>()
  readonly awareness: awarenessProtocol.Awareness
  readonly owners = new Map<number, WS>()
  bytes: number
  sinceCompact = 0
  private compactTimer: ReturnType<typeof setTimeout> | null = null
  /** Bytes of structs waiting for missing dependencies (held in memory, count toward the cap). */
  pendingBytes(): number {
    const p = (this.doc.store as unknown as { pendingStructs: { update: Uint8Array } | null; pendingDs: Uint8Array | null })
    return (p.pendingStructs?.update.length ?? 0) + (p.pendingDs?.length ?? 0)
  }
  constructor(readonly name: string, readonly doc: Y.Doc, private store: RoomStore, private compactEvery: number, private idleMs: number, private log: (m: string) => void, private logCap: { rows: number; bytes: number } = { rows: Infinity, bytes: Infinity }) {
    this.bytes = Y.encodeStateAsUpdate(doc).length
    this.awareness = new awarenessProtocol.Awareness(doc)
    this.awareness.setLocalState(null)
    doc.on('update', (update: Uint8Array, origin: unknown) => {
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

  /**
   * Persist then apply. Returns false (nothing applied) if the append failed.
   * `growth` is the part of the update the doc did not already contain.
   */
  write(growth: Uint8Array, origin: WS): boolean {
    // Validate first: a malformed update must never reach the log (it would break every later load).
    Y.decodeUpdate(growth) // throws on malformed bytes → caller closes; nothing stored
    const scratch = new Y.Doc()
    try { Y.applyUpdate(scratch, growth) } finally { scratch.destroy() }
    // Only the part the doc lacks is stored and applied (duplicates cost nothing).
    this.store.append(this.name, growth) // throws → caller closes 1011; memory untouched
    Y.applyUpdate(this.doc, growth, origin)
    this.bytes += growth.length
    const size = this.store.logSize(this.name)
    // Under sustained load the room never goes idle: force compaction at the cap.
    if (size.rows >= this.logCap.rows || size.bytes >= this.logCap.bytes) this.compactNow()
    else if (++this.sinceCompact >= this.compactEvery) this.scheduleCompact()
    return true
  }

  private scheduleCompact(): void {
    if (this.compactTimer) clearTimeout(this.compactTimer)
    this.compactTimer = setTimeout(() => { this.compactTimer = null; this.compactNow() }, this.idleMs)
  }

  compactNow(): void {
    if (this.compactTimer) { clearTimeout(this.compactTimer); this.compactTimer = null }
    try {
      this.store.compact(this.name, this.doc)
      this.sinceCompact = 0
      this.bytes = Y.encodeStateAsUpdate(this.doc).length
    } catch (e) { this.log(`compact failed room=${this.name}: ${(e as Error).message}`) }
  }

  broadcast(msg: Uint8Array, except?: WS) {
    for (const c of this.conns) if (c !== except) c.sendBinary(msg)
  }
  destroy() {
    if (this.compactTimer) clearTimeout(this.compactTimer)
    this.awareness.destroy()
    this.doc.destroy()
  }
}

/**
 * Keep entries whose clientID is unowned or owned by `ws` (≤ MAX_CLIENT_IDS per
 * connection, each ≤ maxBytes); pin user.id/user.name from the token.
 */
export function sanitizeAwareness(update: Uint8Array, ws: { data: Pick<Conn, 'claims' | 'controlled'> }, owners: Map<number, unknown>, maxBytes = DEFAULT_LIMITS.maxAwarenessBytes): Uint8Array | null {
  const dec = decoding.createDecoder(update)
  const n = decoding.readVarUint(dec)
  if (n > 64) return null
  const kept: { id: number; clock: number; json: string }[] = []
  const mine = new Set<number>([...owners].filter(([, o]) => o === ws).map(([id]) => id))
  for (let i = 0; i < n; i++) {
    const id = decoding.readVarUint(dec)
    const clock = decoding.readVarUint(dec)
    const raw = decoding.readVarString(dec)
    const owner = owners.get(id)
    if (owner !== undefined && owner !== ws) continue
    if (raw.length > maxBytes) continue
    let state: unknown = JSON.parse(raw)
    if (state !== null) {
      if (typeof state !== 'object' || Array.isArray(state)) continue
      if (owner === undefined && mine.size >= MAX_CLIENT_IDS) continue
      const s = state as Record<string, unknown>
      const user = s.user && typeof s.user === 'object' && !Array.isArray(s.user) ? (s.user as Record<string, unknown>) : {}
      s.user = { ...user, id: ws.data.claims.sub, name: ws.data.claims.name ?? (typeof user.name === 'string' ? user.name.slice(0, 80) : ws.data.claims.sub) }
      state = s
    }
    const json = JSON.stringify(state)
    if (json.length > maxBytes) continue
    // Claim the clientID only once the entry is actually accepted.
    if (state !== null) { owners.set(id, ws); mine.add(id) }
    kept.push({ id, clock, json })
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
  if (!opts.issuer || !opts.audience) throw new Error('canvas-relay: issuer and audience are required')
  if (opts.adminToken !== undefined && opts.adminToken.length < MIN_SECRET_LENGTH) throw new Error(`canvas-relay: admin token must be at least ${MIN_SECRET_LENGTH} characters`)
  if (opts.adminToken !== undefined && opts.adminToken === opts.secret) throw new Error('canvas-relay: admin token must differ from the token secret')
  const limits: RelayLimits = { ...DEFAULT_LIMITS, ...opts.limits }
  const log = opts.log ?? ((m: string) => console.log(`[canvas-relay] ${m}`))
  const store = opts.store ?? new RoomStore(opts.dbPath)
  const rooms = new Map<string, Room>()
  let totalConns = 0
  const verify = (token: string, room: string) => verifyRoomToken(token, baseRoom(room), {
    secret: opts.secret, issuer: opts.issuer, audience: opts.audience,
    minEpoch: (r, sub) => store.minEpoch(r, sub),
  })

  const getRoom = (name: string): Room => {
    let r = rooms.get(name)
    if (!r) { r = new Room(name, store.load(name), store, opts.compactEvery ?? 500, opts.compactIdleMs ?? 2000, log, { rows: limits.maxLogRows, bytes: limits.maxLogBytes }); rooms.set(name, r) }
    return r
  }

  const dropRoom = (room: Room, compact: boolean) => {
    if (compact) room.compactNow()
    room.destroy()
    rooms.delete(room.name)
    store.forget(room.name)
  }

  const handleAuth = async (ws: WS, token: string) => {
    const seq = (ws.data.authSeq = (ws.data.authSeq ?? 0) + 1)
    const v = await verify(token, ws.data.room)
    // The socket may have closed, or a newer refresh started, while verifying.
    if (ws.data.closed || seq !== ws.data.authSeq) return
    if (!v.ok || v.claims.sub !== ws.data.claims.sub) {
      log(`auth refresh rejected room=${ws.data.room} reason=${v.ok ? 'sub' : v.reason}`)
      ws.close(v.ok || v.reason !== 'revoked' ? CLOSE.expired : CLOSE.revoked, 'auth refresh rejected')
      return
    }
    // A refresh may change scope/name; it never lowers the epoch already accepted.
    if ((v.claims.epoch ?? 0) < (ws.data.claims.epoch ?? 0)) { ws.close(CLOSE.revoked, 'stale epoch'); return }
    ws.data.claims = v.claims
    armExpiry(ws, v.claims.exp)
  }

  const adminOk = (req: Request): boolean => {
    if (!opts.adminToken) return false
    const got = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''))
    const want = Buffer.from(opts.adminToken)
    return got.length === want.length && timingSafeEqual(got, want)
  }

  const handleAdminRevoke = async (req: Request): Promise<Response> => {
    if (!opts.adminToken) return new Response('not found', { status: 404 })
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
    // Server-to-server only: a browser request (Origin present) is never an admin call.
    if (req.headers.get('origin')) return new Response('forbidden', { status: 403 })
    if (!adminOk(req)) { log('admin revoke rejected: bad credentials'); return new Response('unauthorized', { status: 401 }) }
    let body: { room?: unknown; sub?: unknown; epoch?: unknown }
    try { body = await req.json() as typeof body } catch { return new Response('bad json', { status: 400 }) }
    const { room, sub, epoch } = body
    if (typeof room !== 'string' || !ROOM_RE.test(room)) return new Response('bad room', { status: 400 })
    if (typeof sub !== 'string' || !sub || sub.length > 128) return new Response('bad sub', { status: 400 })
    if (epoch !== undefined && (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1)) return new Response('bad epoch', { status: 400 })
    const e = epoch ?? store.minEpoch(room, sub) + 1
    const closed = revoke(room, sub, e)
    log(`admin revoke room=${room} sub=${sub === '*' ? '*' : '[sub]'} epoch=${e} closed=${closed}`)
    return Response.json({ ok: true, closed, epoch: e })
  }

  /** Raise the revocation epoch for a subject ('*' = everyone) and drop live sockets below it. */
  const revoke = (room: string, sub: string, epoch: number): number => {
    store.revoke(room, sub, epoch)
    let n = 0
    for (const c of [...(rooms.get(room)?.conns ?? []), ...(rooms.get(room + COMMENTS_SUFFIX)?.conns ?? [])]) {
      if ((sub === '*' || c.data.claims.sub === sub) && (c.data.claims.epoch ?? 0) < epoch) { c.close(CLOSE.revoked, 'revoked'); n++ }
    }
    return n
  }

  const server = Bun.serve<Conn>({
    port: opts.port,
    hostname: opts.hostname,
    // Bun's default error page logs the full request URL, which may carry ?token=.
    error(err) {
      log(`request error: ${err.name}: ${err.message.replace(/token=[^&\s']+/g, 'token=[redacted]')}`)
      return new Response('internal error', { status: 500 })
    },
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === '/healthz') return Response.json({ ok: true }) // counts only on the admin listener
      const m = url.pathname.match(/^\/r\/([^/]+)$/)
      if (!m) return new Response('not found', { status: 404 })
      let room: string
      try { room = decodeURIComponent(m[1]!) } catch { return new Response('bad room', { status: 400 }) }
      if (!ROOM_RE.test(room)) return new Response('bad room', { status: 400 })
      const origin = req.headers.get('origin')
      if (origin && opts.allowedOrigins?.length && !opts.allowedOrigins.includes(origin)) return new Response('forbidden origin', { status: 403 })
      const offered = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map(s => s.trim()).filter(Boolean)
      const protoToken = offered.find(s => s.split('.').length === 3)
      // A token in Sec-WebSocket-Protocol is only accepted next to our protocol
      // name, which is what we echo — the token itself is never echoed back.
      if (protoToken && !offered.includes(SUBPROTOCOL)) return new Response(`subprotocol ${SUBPROTOCOL} required`, { status: 400 })
      const token = protoToken ?? url.searchParams.get('token') ?? ''
      const v = await verify(token, room)
      if (!v.ok) { log(`auth rejected room=${room} reason=${v.reason}`); return new Response('unauthorized', { status: 401 }) }
      if (totalConns >= limits.maxConnsTotal) return new Response('server full', { status: 503 })
      if ((rooms.get(room)?.conns.size ?? 0) >= limits.maxConnsPerRoom) return new Response('room full', { status: 503 })
      const headers = new Headers()
      if (offered.includes(SUBPROTOCOL)) headers.set('Sec-WebSocket-Protocol', SUBPROTOCOL)
      const data: Conn = { room, claims: v.claims, controlled: new Set(), bucket: { msgs: limits.msgsPerSecond * 2, bytes: limits.bytesPerSecond * 2, at: Date.now() } }
      if (srv.upgrade(req, { data, headers })) return undefined
      return new Response('upgrade required', { status: 426 })
    },
    websocket: {
      maxPayloadLength: limits.maxMessageBytes,
      open(ws) {
        // A revocation may have landed between verify (fetch) and open.
        if ((ws.data.claims.epoch ?? 0) < store.minEpoch(baseRoom(ws.data.room), ws.data.claims.sub)) { ws.close(CLOSE.revoked, 'revoked'); return }
        if (ws.data.claims.exp * 1000 <= Date.now()) { ws.close(CLOSE.expired, 'token expired'); return }
        // Re-check caps here too: several upgrades can pass fetch() concurrently.
        if (totalConns >= limits.maxConnsTotal) { ws.close(CLOSE.roomFull, 'server full'); return }
        let room: Room
        try { room = getRoom(ws.data.room) } catch (e) {
          // Never create/compact a room we failed to read: stored rows stay untouched.
          log(`load failed room=${ws.data.room}: ${(e as Error).message}`)
          ws.close(CLOSE.serverError, 'load failed')
          return
        }
        if (room.conns.size >= limits.maxConnsPerRoom) { ws.close(CLOSE.roomFull, 'room full'); return }
        room.conns.add(ws)
        ws.data.counted = true
        totalConns++
        armExpiry(ws, ws.data.claims.exp)
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MSG_SYNC)
        syncProtocol.writeSyncStep1(enc, room.doc)
        ws.sendBinary(encoding.toUint8Array(enc))
        // Full sync up front: the whole state as step 2, so a client that never
        // sends step 1 (or a view-only one) still gets the document.
        const full = encoding.createEncoder()
        encoding.writeVarUint(full, MSG_SYNC)
        syncProtocol.writeSyncStep2(full, room.doc)
        ws.sendBinary(encoding.toUint8Array(full))
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
        let dec: decoding.Decoder
        let type: number
        try { dec = decoding.createDecoder(bytes); type = decoding.readVarUint(dec) } catch { ws.close(CLOSE.badMessage, 'bad message'); return }
        if (type === MSG_AUTH) {
          let token: string
          try { token = decoding.readVarString(dec) } catch { ws.close(CLOSE.badMessage, 'bad message'); return }
          void handleAuth(ws, token)
          return
        }
        try {
          if (type === MSG_SYNC) {
            const sub = decoding.readVarUint(dec)
            if (sub === syncProtocol.messageYjsSyncStep1) {
              const enc = encoding.createEncoder()
              encoding.writeVarUint(enc, MSG_SYNC)
              syncProtocol.readSyncStep1(dec, enc, room.doc)
              ws.sendBinary(encoding.toUint8Array(enc))
            } else if (sub === syncProtocol.messageYjsSyncStep2 || sub === syncProtocol.messageYjsUpdate) {
              if (!canWrite(ws.data.claims.scope, ws.data.room)) return // read-only in this room
              const update = decoding.readVarUint8Array(dec)
              // Only content the doc doesn't have yet counts (and is stored).
              const growth = Y.diffUpdate(update, Y.encodeStateVector(room.doc))
              if (growth.length <= EMPTY_UPDATE_LEN) return // nothing new
              if (room.bytes + room.pendingBytes() + growth.length > limits.maxDocBytes) { ws.close(CLOSE.docTooLarge, 'document too large'); return }
              try { room.write(growth, ws) } catch (e) {
                log(`append failed room=${room.name}: ${(e as Error).message}`)
                ws.close(CLOSE.serverError, 'storage error')
                return
              }
            }
          } else if (type === MSG_AWARENESS) {
            const clean = sanitizeAwareness(decoding.readVarUint8Array(dec), ws, room.owners, limits.maxAwarenessBytes)
            if (clean) awarenessProtocol.applyAwarenessUpdate(room.awareness, clean, ws)
          }
        } catch {
          ws.close(CLOSE.badMessage, 'bad message')
        }
      },
      close(ws) {
        ws.data.closed = true
        if (ws.data.expTimer) clearTimeout(ws.data.expTimer)
        if (!ws.data.counted) return
        ws.data.counted = false
        totalConns--
        const room = rooms.get(ws.data.room)
        if (!room || !room.conns.delete(ws)) return
        for (const [id, owner] of room.owners) if (owner === ws) room.owners.delete(id)
        awarenessProtocol.removeAwarenessStates(room.awareness, [...ws.data.controlled], null)
        if (room.conns.size === 0) dropRoom(room, true)
      },
    },
  })

  // Admin API lives on its own listener (loopback/tailnet), never the public port.
  const admin = opts.adminToken ? Bun.serve({
    port: opts.adminPort ?? 0,
    hostname: opts.adminHostname ?? '127.0.0.1',
    error(err) { log(`admin error: ${err.name}`); return new Response('internal error', { status: 500 }) },
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/admin/revoke') return handleAdminRevoke(req)
      if (url.pathname === '/admin/healthz') {
        if (!adminOk(req)) return new Response('unauthorized', { status: 401 })
        return Response.json({ ok: true, rooms: rooms.size, conns: totalConns })
      }
      return new Response('not found', { status: 404 })
    },
  }) : null

  return {
    server,
    port: server.port,
    adminPort: admin?.port,
    revoke,
    stop() {
      server.stop(true)
      admin?.stop(true)
      for (const r of [...rooms.values()]) dropRoom(r, true)
      store.close()
    },
  }
}
