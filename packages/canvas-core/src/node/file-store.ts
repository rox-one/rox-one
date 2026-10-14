/**
 * Local, offline-first persistence for boards in a workspace:
 *   <workspaceRoot>/canvas/index.json       board list (id, title, timestamps)
 *   <workspaceRoot>/canvas/<boardId>.ydoc   full Yjs state (atomic, fsynced replace)
 *   <workspaceRoot>/canvas/<boardId>.log    appended updates since last snapshot
 *
 * Durability: snapshots are written to a temp file, fsynced, renamed, and the
 * directory fsynced before the log is removed. Every queued write step catches
 * its own error, so one I/O failure never stops later saves; a failed board is
 * marked dirty and a full snapshot is retried (backoff) until it succeeds.
 * A corrupt index.json is rebuilt from the *.ydoc files. Deletion moves the
 * board to canvas/.trash (never destroys user data).
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import * as Y from 'yjs'
import { CanvasDoc } from '../doc.ts'

export interface BoardSummary { id: string; title: string; createdAt: number; updatedAt: number }
export type StoreErrorHandler = (error: unknown, context: { boardId?: string; op: string }) => void

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/
const COMPACT_AFTER = 200
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 30_000
const INDEX_THROTTLE_MS = 1_000

export function isValidBoardId(id: string): boolean { return BOARD_ID.test(id) }
function assertId(id: string): void { if (!isValidBoardId(id)) throw new Error('canvas: invalid board id') }

async function fsyncDir(dir: string): Promise<void> {
  // Directory fsync is unsupported on some platforms (Windows); best effort there.
  const h = await fs.open(dir, 'r').catch(() => null)
  if (!h) return
  try { await h.sync() } catch { /* EISDIR/EPERM on some FS */ } finally { await h.close() }
}

export async function atomicWrite(path: string, data: Uint8Array | string, dir: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  const h = await fs.open(tmp, 'w')
  try { await h.writeFile(data); await h.sync() } finally { await h.close() }
  await fs.rename(tmp, path)
  await fsyncDir(dir)
}

/** Length-prefixed update frames (u32 LE + bytes). */
function encodeFrame(update: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + update.length)
  new DataView(out.buffer).setUint32(0, update.length, true)
  out.set(update, 4)
  return out
}
/**
 * Replay frames into `doc`. Stops at the first torn or unappliable frame and
 * returns its byte offset (null = the whole log applied cleanly).
 */
function replayFrames(buf: Uint8Array, doc: Y.Doc): number | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let off = 0
  while (off < buf.length) {
    if (off + 4 > buf.length) return off
    const len = view.getUint32(off, true)
    if (off + 4 + len > buf.length) return off
    try { Y.applyUpdate(doc, buf.subarray(off + 4, off + 4 + len)) } catch { return off }
    off += 4 + len
  }
  return null
}

const LOG_FSYNC_DEBOUNCE_MS = 200

/** True while `pid` is a live process (signal 0 probes without killing). */
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

interface OpenEntry {
  board: CanvasDoc
  pending: number
  dirty: boolean
  retries: number
  retryTimer: ReturnType<typeof setTimeout> | null
  fsyncTimer: ReturnType<typeof setTimeout> | null
  needsFsync: boolean
  indexStale: boolean
  indexTimer: ReturnType<typeof setTimeout> | null
  detach: () => void
  chain: Promise<void>
}

export class CanvasFileStore {
  readonly dir: string
  private open = new Map<string, OpenEntry>()
  private opening = new Map<string, Promise<CanvasDoc>>()
  /** Boards being closed or trashed: openBoard waits for these first. */
  private busy = new Map<string, Promise<unknown>>()
  /** Per-board chain for updates from docs that were already closed (see `adoptStale`). */
  private staleChain = new Map<string, Promise<void>>()
  private lockHeld = false
  private indexChain: Promise<void> = Promise.resolve()
  private onError: StoreErrorHandler

  constructor(workspaceRoot: string, opts: { onError?: StoreErrorHandler } = {}) {
    this.dir = join(workspaceRoot, 'canvas')
    this.onError = opts.onError ?? ((e, ctx) => console.error(`[canvas-store] ${ctx.op}${ctx.boardId ? ` ${ctx.boardId}` : ''} failed:`, e))
  }

  /**
   * One process per workspace: `canvas/.lock` holds the owner pid. A lock left
   * by a dead process is taken over; a live owner makes this store refuse to
   * open boards (CANVAS_LOCKED) instead of corrupting the log.
   */
  async acquireLock(): Promise<void> {
    if (this.lockHeld) return
    await fs.mkdir(this.dir, { recursive: true })
    const path = join(this.dir, '.lock')
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const h = await fs.open(path, 'wx')
        try { await h.writeFile(String(process.pid)); await h.sync() } finally { await h.close() }
        this.lockHeld = true
        return
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        const owner = Number((await fs.readFile(path, 'utf8').catch(() => '')).trim())
        if (owner === process.pid) { this.lockHeld = true; return }
        if (Number.isInteger(owner) && owner > 0 && pidAlive(owner)) throw new Error(`CANVAS_LOCKED: workspace canvas is in use by process ${owner}`)
        await fs.rm(path, { force: true }) // stale lock
      }
    }
    throw new Error('CANVAS_LOCKED: could not acquire the workspace lock')
  }

  /** Close every board and release the lock. */
  async dispose(): Promise<void> {
    for (const id of [...this.open.keys()]) await this.closeBoard(id).catch(e => this.onError(e, { boardId: id, op: 'dispose' }))
    if (this.lockHeld) {
      await fs.rm(join(this.dir, '.lock'), { force: true })
      this.lockHeld = false
    }
  }

  private paths(id: string) {
    assertId(id)
    return { snap: join(this.dir, `${id}.ydoc`), log: join(this.dir, `${id}.log`) }
  }

  async listBoards(): Promise<BoardSummary[]> {
    let raw: string
    try { raw = await fs.readFile(join(this.dir, 'index.json'), 'utf8') } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return this.rebuildIndexEntries()
      throw e
    }
    try {
      const parsed = JSON.parse(raw) as { boards?: unknown }
      if (!Array.isArray(parsed.boards)) throw new Error('index.json: boards is not an array')
      return (parsed.boards as BoardSummary[])
        .filter(b => b && typeof b.id === 'string' && isValidBoardId(b.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    } catch (e) {
      this.onError(e, { op: 'read-index' })
      return this.rebuildIndexEntries()
    }
  }

  /** Recover the board list from the snapshot files (index missing or corrupt). */
  private async rebuildIndexEntries(): Promise<BoardSummary[]> {
    let names: string[]
    try { names = await fs.readdir(this.dir) } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
    const out: BoardSummary[] = []
    for (const name of names) {
      if (!name.endsWith('.ydoc')) continue
      const id = name.slice(0, -5)
      if (!isValidBoardId(id)) continue
      try {
        const st = await fs.stat(join(this.dir, name))
        const doc = new Y.Doc()
        Y.applyUpdate(doc, new Uint8Array(await fs.readFile(join(this.dir, name))))
        const meta = new CanvasDoc(doc).getMeta()
        out.push({ id, title: meta.title, createdAt: meta.createdAt || st.birthtimeMs, updatedAt: st.mtimeMs })
        doc.destroy()
      } catch (e) { this.onError(e, { op: 'rebuild-index', boardId: id }) }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private updateIndex(mut: (boards: BoardSummary[]) => BoardSummary[]): Promise<void> {
    const step = this.indexChain.then(async () => {
      await fs.mkdir(this.dir, { recursive: true })
      const boards = mut(await this.listBoards())
      await atomicWrite(join(this.dir, 'index.json'), JSON.stringify({ version: 1, boards }, null, 2), this.dir)
    })
    // The chain itself never rejects, so one failure can't poison later index writes.
    this.indexChain = step.catch(e => this.onError(e, { op: 'write-index' }))
    return step
  }

  async createBoard(title: string, createdBy?: string): Promise<BoardSummary> {
    await this.acquireLock()
    const id = `b_${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`
    await fs.mkdir(this.dir, { recursive: true })
    const board = new CanvasDoc()
    board.init({ title, createdBy })
    await atomicWrite(this.paths(id).snap, Y.encodeStateAsUpdate(board.doc), this.dir)
    const now = Date.now()
    const summary = { id, title, createdAt: now, updatedAt: now }
    await this.updateIndex(bs => [...bs.filter(b => b.id !== id), summary])
    return summary
  }

  /** Load (or return the already-open / in-flight) board; local edits persist automatically. */
  openBoard(id: string): Promise<CanvasDoc> {
    if (!isValidBoardId(id)) return Promise.reject(new Error('canvas: invalid board id'))
    const busy = this.busy.get(id) // closing/trashing: never hand out the doc being closed
    const existing = this.open.get(id)
    if (existing && !busy) return Promise.resolve(existing.board)
    const inflight = this.opening.get(id)
    if (inflight) return inflight
    const p = (async () => {
      if (busy) await busy.catch(() => {})
      const again = this.open.get(id)
      if (again) return again.board
      await this.acquireLock()
      return this.load(id)
    })().finally(() => this.opening.delete(id))
    this.opening.set(id, p)
    return p
  }

  private async load(id: string): Promise<CanvasDoc> {
    const { snap, log } = this.paths(id)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(await fs.readFile(snap))) // ENOENT → board doesn't exist
    let logBytes: Uint8Array | null = null
    try { logBytes = new Uint8Array(await fs.readFile(log)) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    const badAt = logBytes ? replayFrames(logBytes, doc) : null
    const board = new CanvasDoc(doc)
    const entry: OpenEntry = { board, pending: 0, dirty: false, retries: 0, retryTimer: null, fsyncTimer: null, needsFsync: false, indexStale: false, indexTimer: null, detach: () => {}, chain: Promise.resolve() }
    if (logBytes && badAt !== null) {
      // Keep the unreadable tail aside, then fold the good prefix into a snapshot.
      const aside = join(this.dir, `${id}.log.corrupt-${Date.now()}`)
      await fs.writeFile(aside, logBytes.subarray(badAt))
      this.onError(new Error(`corrupt log frame at byte ${badAt}; tail saved to ${aside}`), { boardId: id, op: 'replay-log' })
      await this.compactEntry(id, entry)
    }
    const onUpdate = (update: Uint8Array) => {
      this.enqueue(id, entry, async () => {
        if (entry.dirty) { await this.compactEntry(id, entry); return } // the snapshot includes this update
        await fs.appendFile(log, encodeFrame(update))
        this.scheduleLogFsync(id, entry)
        entry.pending++
        if (entry.pending >= COMPACT_AFTER) await this.compactEntry(id, entry)
        else this.markIndexStale(id, entry)
      })
    }
    doc.on('update', onUpdate)
    entry.detach = () => doc.off('update', onUpdate)
    this.open.set(id, entry)
    return board
  }

  /** fsync the log at most every LOG_FSYNC_DEBOUNCE_MS (flush/close force it). */
  private scheduleLogFsync(id: string, entry: OpenEntry): void {
    entry.needsFsync = true
    if (entry.fsyncTimer) return
    entry.fsyncTimer = setTimeout(() => {
      entry.fsyncTimer = null
      this.enqueue(id, entry, () => this.fsyncLog(id, entry))
    }, LOG_FSYNC_DEBOUNCE_MS)
    ;(entry.fsyncTimer as { unref?: () => void }).unref?.()
  }

  private async fsyncLog(id: string, entry: OpenEntry): Promise<void> {
    if (!entry.needsFsync) return
    entry.needsFsync = false
    const h = await fs.open(this.paths(id).log, 'r').catch(e => { if (e.code === 'ENOENT') return null; throw e })
    if (!h) return
    try { await h.sync() } finally { await h.close() }
  }

  /** Queue a write step; failures are reported, the board is marked dirty and a snapshot retried. */
  private enqueue(id: string, entry: OpenEntry, step: () => Promise<void>): void {
    entry.chain = entry.chain.then(step).catch(e => {
      entry.dirty = true
      this.onError(e, { boardId: id, op: 'persist' })
      this.scheduleRetry(id, entry)
    })
  }

  private scheduleRetry(id: string, entry: OpenEntry): void {
    if (entry.retryTimer || !this.open.has(id)) return
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** entry.retries++)
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null
      if (entry.dirty) this.enqueue(id, entry, () => this.compactEntry(id, entry))
    }, delay)
    ;(entry.retryTimer as { unref?: () => void }).unref?.()
  }

  /** Index timestamps are throttled: at most one index write per board per INDEX_THROTTLE_MS. */
  private markIndexStale(id: string, entry: OpenEntry): void {
    entry.indexStale = true
    if (entry.indexTimer) return
    entry.indexTimer = setTimeout(() => {
      entry.indexTimer = null
      if (entry.indexStale) this.enqueue(id, entry, () => this.touchEntry(id, entry))
    }, INDEX_THROTTLE_MS)
    ;(entry.indexTimer as { unref?: () => void }).unref?.()
  }

  private async touchEntry(id: string, entry: OpenEntry): Promise<void> {
    entry.indexStale = false
    await this.touch(id, entry.board)
  }

  private async touch(id: string, board: CanvasDoc): Promise<void> {
    const title = board.getMeta().title
    await this.updateIndex(bs => {
      const found = bs.some(b => b.id === id)
      const now = Date.now()
      return found ? bs.map(b => (b.id === id ? { ...b, title, updatedAt: now } : b)) : [...bs, { id, title, createdAt: now, updatedAt: now }]
    })
  }

  private async compactEntry(id: string, entry: OpenEntry): Promise<void> {
    const { snap, log } = this.paths(id)
    await atomicWrite(snap, Y.encodeStateAsUpdate(entry.board.doc), this.dir)
    await fs.rm(log, { force: true })
    await fsyncDir(this.dir)
    entry.pending = 0
    entry.needsFsync = false
    entry.dirty = false
    entry.retries = 0
    await this.touchEntry(id, entry)
  }

  /** Wait for queued writes of a board (or all). Rejects if a board is still unsaved. */
  async flush(id?: string): Promise<void> {
    const entries = id ? [this.open.get(id)].filter((e): e is OpenEntry => !!e) : [...this.open.values()]
    for (const e of entries) {
      if (!e.indexStale) continue
      if (e.indexTimer) { clearTimeout(e.indexTimer); e.indexTimer = null }
      const bid = [...this.open.entries()].find(([, v]) => v === e)![0]
      this.enqueue(bid, e, () => this.touchEntry(bid, e))
    }
    for (const [bid, e] of this.open) {
      if (!entries.includes(e) || !e.needsFsync) continue
      if (e.fsyncTimer) { clearTimeout(e.fsyncTimer); e.fsyncTimer = null }
      this.enqueue(bid, e, () => this.fsyncLog(bid, e))
    }
    await Promise.all(entries.map(e => e.chain))
    await this.indexChain
    if (entries.some(e => e.dirty)) throw new Error('canvas: unsaved changes (write failed; retrying)')
  }

  /**
   * Close a board. The entry leaves `open` first (new opens wait on `busy`),
   * pending writes drain, and a final snapshot is taken while the listener is
   * still attached. If the snapshot fails the entry is re-registered (nothing
   * lost) and the error is thrown. After a successful close, edits made on the
   * stale doc are forwarded to a re-opened instance or appended to the log.
   */
  closeBoard(id: string): Promise<void> {
    const prev = this.busy.get(id)
    const p = (async () => {
      if (prev) await prev.catch(() => {})
      await this.opening.get(id)?.catch(() => {})
      const entry = this.open.get(id)
      if (!entry) return
      this.open.delete(id)
      try {
        for (const t of [entry.retryTimer, entry.indexTimer, entry.fsyncTimer]) if (t) clearTimeout(t)
        entry.retryTimer = entry.indexTimer = entry.fsyncTimer = null
        await entry.chain
        await this.compactEntry(id, entry)
        await entry.chain // updates that raced the snapshot were appended to the log
      } catch (e) {
        this.open.set(id, entry)
        entry.dirty = true
        this.scheduleRetry(id, entry)
        throw e
      }
      entry.detach()
      entry.board.doc.on('update', (update: Uint8Array) => this.adoptStale(id, update))
    })()
    const tracked = p.finally(() => { if (this.busy.get(id) === tracked) this.busy.delete(id) })
    this.busy.set(id, tracked)
    return tracked
  }

  /** An edit on a closed board's doc: never dropped. */
  private adoptStale(id: string, update: Uint8Array): void {
    this.onError(new Error('edit on a closed board; forwarded'), { boardId: id, op: 'write-after-close' })
    const live = this.open.get(id)
    if (live) { Y.applyUpdate(live.board.doc, update); return } // persisted by the live listener
    const prev = this.staleChain.get(id) ?? Promise.resolve()
    const next = prev.then(() => fs.appendFile(this.paths(id).log, encodeFrame(update))).catch(e => this.onError(e, { boardId: id, op: 'write-after-close' }))
    this.staleChain.set(id, next)
  }

  /** Soft delete: files move to canvas/.trash/<id>-<ts>.*; index entry removed. Opens wait meanwhile. */
  trashBoard(id: string): Promise<void> {
    assertId(id)
    const p = (async () => {
      await this.closeBoard(id)
      await this.staleChain.get(id)
      const { snap, log } = this.paths(id)
      const trash = join(this.dir, '.trash')
      await fs.mkdir(trash, { recursive: true })
      const stamp = Date.now()
      for (const [src, ext] of [[snap, 'ydoc'], [log, 'log']] as const) {
        await fs.rename(src, join(trash, `${id}-${stamp}.${ext}`)).catch(e => { if (e.code !== 'ENOENT') throw e })
      }
      await this.updateIndex(bs => bs.filter(b => b.id !== id))
    })()
    const tracked = p.finally(() => { if (this.busy.get(id) === tracked) this.busy.delete(id) })
    this.busy.set(id, tracked)
    return tracked
  }
}
