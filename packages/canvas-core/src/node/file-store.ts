/**
 * Local, offline-first persistence for boards in a workspace:
 *   <workspaceRoot>/canvas/index.json       board list (id, title, timestamps)
 *   <workspaceRoot>/canvas/<boardId>.ydoc   full Yjs state (atomic replace)
 *   <workspaceRoot>/canvas/<boardId>.log    appended updates since last snapshot
 * Writes are crash-safe: snapshot via temp file + rename; the log is replayed
 * on load and truncated only after a successful snapshot. Deletion moves the
 * board to canvas/.trash (never destroys user data).
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import * as Y from 'yjs'
import { CanvasDoc } from '../doc.ts'

export interface BoardSummary { id: string; title: string; createdAt: number; updatedAt: number }

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/
const COMPACT_AFTER = 200

export function isValidBoardId(id: string): boolean { return BOARD_ID.test(id) }

function assertId(id: string): void {
  if (!isValidBoardId(id)) throw new Error(`canvas: invalid board id`)
}

async function atomicWrite(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, path)
}

/** Length-prefixed update frames (u32 LE + bytes); a torn tail is ignored. */
function encodeFrame(update: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + update.length)
  new DataView(out.buffer).setUint32(0, update.length, true)
  out.set(update, 4)
  return out
}
function decodeFrames(buf: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = []
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let off = 0
  while (off + 4 <= buf.length) {
    const len = view.getUint32(off, true)
    if (off + 4 + len > buf.length) break
    frames.push(buf.subarray(off + 4, off + 4 + len))
    off += 4 + len
  }
  return frames
}

export class CanvasFileStore {
  readonly dir: string
  private open = new Map<string, { board: CanvasDoc; pending: number; detach: () => void; chain: Promise<void> }>()
  private indexChain: Promise<void> = Promise.resolve()

  constructor(workspaceRoot: string) {
    this.dir = join(workspaceRoot, 'canvas')
  }

  private paths(id: string) {
    assertId(id)
    return { snap: join(this.dir, `${id}.ydoc`), log: join(this.dir, `${id}.log`) }
  }

  async listBoards(): Promise<BoardSummary[]> {
    try {
      const raw = JSON.parse(await fs.readFile(join(this.dir, 'index.json'), 'utf8')) as { boards?: BoardSummary[] }
      return (raw.boards ?? []).filter(b => isValidBoardId(b.id)).sort((a, b) => b.updatedAt - a.updatedAt)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }

  private updateIndex(mut: (boards: BoardSummary[]) => BoardSummary[]): Promise<void> {
    this.indexChain = this.indexChain.then(async () => {
      await fs.mkdir(this.dir, { recursive: true })
      const boards = mut(await this.listBoards())
      await atomicWrite(join(this.dir, 'index.json'), JSON.stringify({ version: 1, boards }, null, 2))
    })
    return this.indexChain
  }

  async createBoard(title: string, createdBy?: string): Promise<BoardSummary> {
    const id = `b_${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`
    await fs.mkdir(this.dir, { recursive: true })
    const board = new CanvasDoc()
    board.init({ title, createdBy })
    await atomicWrite(this.paths(id).snap, Y.encodeStateAsUpdate(board.doc))
    const now = Date.now()
    const summary = { id, title, createdAt: now, updatedAt: now }
    await this.updateIndex(bs => [...bs.filter(b => b.id !== id), summary])
    return summary
  }

  /** Load (or return the already-open) board; local edits persist automatically. */
  async openBoard(id: string): Promise<CanvasDoc> {
    const existing = this.open.get(id)
    if (existing) return existing.board
    const { snap, log } = this.paths(id)
    const doc = new Y.Doc()
    const snapBytes = await fs.readFile(snap) // ENOENT → caller error (board doesn't exist)
    Y.applyUpdate(doc, new Uint8Array(snapBytes))
    try {
      for (const f of decodeFrames(new Uint8Array(await fs.readFile(log)))) Y.applyUpdate(doc, f)
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    const board = new CanvasDoc(doc)
    const entry = { board, pending: 0, detach: () => {}, chain: Promise.resolve() }
    const onUpdate = (update: Uint8Array) => {
      entry.chain = entry.chain.then(async () => {
        await fs.appendFile(log, encodeFrame(update))
        entry.pending++
        if (entry.pending >= COMPACT_AFTER) await this.compactEntry(id, entry)
        else await this.touch(id, board)
      })
    }
    doc.on('update', onUpdate)
    entry.detach = () => doc.off('update', onUpdate)
    this.open.set(id, entry)
    return board
  }

  private async touch(id: string, board: CanvasDoc): Promise<void> {
    const title = board.getMeta().title
    await this.updateIndex(bs => bs.map(b => (b.id === id ? { ...b, title, updatedAt: Date.now() } : b)))
  }

  private async compactEntry(id: string, entry: { board: CanvasDoc; pending: number }): Promise<void> {
    const { snap, log } = this.paths(id)
    await atomicWrite(snap, Y.encodeStateAsUpdate(entry.board.doc))
    await fs.rm(log, { force: true })
    entry.pending = 0
    await this.touch(id, entry.board)
  }

  /** Wait for queued writes of a board (or all). */
  async flush(id?: string): Promise<void> {
    const entries = id ? [this.open.get(id)].filter(Boolean) : [...this.open.values()]
    await Promise.all(entries.map(e => e!.chain))
    await this.indexChain
  }

  async closeBoard(id: string): Promise<void> {
    const entry = this.open.get(id)
    if (!entry) return
    entry.detach()
    await entry.chain
    await this.compactEntry(id, entry)
    this.open.delete(id)
  }

  /** Soft delete: files move to canvas/.trash/<id>-<ts>.*; index entry removed. */
  async trashBoard(id: string): Promise<void> {
    await this.closeBoard(id).catch(() => {})
    const { snap, log } = this.paths(id)
    const trash = join(this.dir, '.trash')
    await fs.mkdir(trash, { recursive: true })
    const stamp = Date.now()
    for (const [src, ext] of [[snap, 'ydoc'], [log, 'log']] as const) {
      await fs.rename(src, join(trash, `${id}-${stamp}.${ext}`)).catch(e => { if (e.code !== 'ENOENT') throw e })
    }
    await this.updateIndex(bs => bs.filter(b => b.id !== id))
  }
}
