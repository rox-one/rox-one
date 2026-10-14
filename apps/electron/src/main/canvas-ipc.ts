/**
 * «Доска» (Canvas) — main-process persistence bridge.
 *
 * The renderer never passes paths: it names a workspace id, main resolves the
 * workspace root from the stored config and keeps one `CanvasFileStore` per
 * root (`<root>/canvas/`). Board state crosses IPC as Yjs updates, so the
 * renderer's live doc and main's persisted doc are the same CRDT; updates
 * applied from one window are forwarded to the other windows.
 */
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import * as Y from 'yjs'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CanvasFileStore, isValidBoardId, type BoardSummary } from '@rox/canvas-core/node'

export const CANVAS_IPC = {
  list: 'canvas:list',
  create: 'canvas:create',
  rename: 'canvas:rename',
  trash: 'canvas:trash',
  open: 'canvas:open',
  apply: 'canvas:apply',
  close: 'canvas:close',
  setEnabled: 'canvas:setEnabled',
  listTrash: 'canvas:listTrash',
  restore: 'canvas:restore',
  update: 'canvas:update', // main → renderer event
} as const

const MAX_TITLE = 200
const MAX_UPDATE_BYTES = 16 * 1024 * 1024
/** Origin tag of an update applied from a renderer: forwarding skips that renderer. */
interface RendererOrigin { kind: 'remote'; senderId: number }

export interface CanvasIpcDependencies {
  resolveWorkspaceRoot(workspaceId: string): string | null
  isTrustedSender?(event: IpcMainInvokeEvent): boolean
  /** Other renderers to forward updates to. */
  listRenderers?(): WebContents[]
}

export function createCanvasStoreRegistry(deps: Pick<CanvasIpcDependencies, 'resolveWorkspaceRoot'>) {
  const stores = new Map<string, CanvasFileStore>()
  return {
    get(workspaceId: unknown): CanvasFileStore {
      if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('CANVAS_BAD_WORKSPACE')
      const root = deps.resolveWorkspaceRoot(workspaceId)
      if (!root) throw new Error('CANVAS_UNKNOWN_WORKSPACE')
      let s = stores.get(root)
      if (!s) { s = new CanvasFileStore(root); stores.set(root, s) }
      return s
    },
    /** Canonical workspace root (subscriber key); throws like get(). */
    rootOf(workspaceId: unknown): string {
      if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('CANVAS_BAD_WORKSPACE')
      const root = deps.resolveWorkspaceRoot(workspaceId)
      if (!root) throw new Error('CANVAS_UNKNOWN_WORKSPACE')
      return root
    },
    async closeAll(): Promise<void> {
      await Promise.all([...stores.values()].map(s => s.flush().catch(() => {})))
    },
  }
}

function cleanTitle(title: unknown): string {
  if (typeof title !== 'string') throw new Error('CANVAS_BAD_TITLE')
  const t = title.trim().slice(0, MAX_TITLE)
  if (!t) throw new Error('CANVAS_BAD_TITLE')
  return t
}
function boardId(id: unknown): string {
  if (typeof id !== 'string' || !isValidBoardId(id)) throw new Error('CANVAS_BAD_BOARD')
  return id
}

/** Mirrors `defaultValue` of `workbench.mode.canvas.v1` in flags.ts. */
export const CANVAS_FLAG_DEFAULT = true
export const CANVAS_FLAG_FILE = 'canvas-flag.json'
/** Last flag value pushed by the renderer; undefined when none / unreadable. */
export function readCanvasFlag(configDir: string): boolean | undefined {
  try {
    const f = join(configDir, CANVAS_FLAG_FILE)
    if (!existsSync(f)) return undefined
    const v = JSON.parse(readFileSync(f, 'utf8')) as { enabled?: unknown }
    return typeof v.enabled === 'boolean' ? v.enabled : undefined
  } catch { return undefined }
}
export function writeCanvasFlag(configDir: string, enabled: boolean): void {
  try {
    mkdirSync(configDir, { recursive: true })
    const f = join(configDir, CANVAS_FLAG_FILE), tmp = `${f}.tmp`
    writeFileSync(tmp, JSON.stringify({ enabled }))
    renameSync(tmp, f)
  } catch { /* best effort: the renderer re-pushes at every start */ }
}

export function registerCanvasIpc(ipcMain: Pick<IpcMain, 'handle'>, deps: CanvasIpcDependencies & {
  /** Look up a live renderer by id (forwarding). */
  rendererById?(id: number): WebContents | undefined
  /** Override the start-up value of `workbench.mode.canvas.v1` (tests). */
  initiallyEnabled?: boolean
  /** Config dir: the last flag value the renderer pushed is persisted here and read at init. */
  configDir?: string
}) {
  const registry = createCanvasStoreRegistry(deps)
  const forced = process.env.ROX_CANVAS === '1'
  let enabled = forced || (deps.initiallyEnabled ?? (deps.configDir ? readCanvasFlag(deps.configDir) : undefined) ?? CANVAS_FLAG_DEFAULT)
  const guard = (event: IpcMainInvokeEvent, opts: { flag?: boolean } = {}) => {
    if (deps.isTrustedSender && !deps.isTrustedSender(event)) throw new Error('IPC_SENDER_DENIED')
    if (opts.flag !== false && !enabled) throw new Error('CANVAS_DISABLED')
  }
  const knownBoard = async (store: CanvasFileStore, id: string) => {
    const boards = await store.listBoards()
    if (!boards.some(b => b.id === id)) throw new Error('CANVAS_UNKNOWN_BOARD')
  }
  /**
   * "<workspace root>|<board>" → renderer ids that have the board open. Keyed by
   * the canonical root, so a workspace named by id or by name is one entry.
   */
  const subscribers = new Map<string, Set<number>>()
  const forwarders = new Map<string, { doc: Y.Doc; handler: (u: Uint8Array, o: unknown) => void }>()
  const key = (ws: unknown, id: string) => `${registry.rootOf(ws)}|${id}`
  /**
   * "<key>|<renderer id>" → count of close calls seen. An open that is still
   * awaiting the store when the same renderer closes the board must not
   * subscribe afterwards (close/reopen race: the close was a no-op then).
   */
  const closeSeq = new Map<string, number>()
  /** Drop the forwarder and close the board once nobody has it open. */
  const releaseIfIdle = async (ws: unknown, id: string) => {
    const k = key(ws, id)
    if (subscribers.get(k)?.size) return
    subscribers.delete(k)
    const f = forwarders.get(k)
    if (f) { f.doc.off('update', f.handler); forwarders.delete(k) }
    await registry.get(ws).closeBoard(id).catch(() => {})
  }
  const unsubscribe = (ws: unknown, id: string, rid: number) => {
    const set = subscribers.get(key(ws, id))
    if (!set?.delete(rid)) return
    void releaseIfIdle(ws, id)
  }
  const subscribe = (ws: unknown, id: string, wc: WebContents) => {
    const k = key(ws, id)
    let set = subscribers.get(k)
    if (!set) { set = new Set(); subscribers.set(k, set) }
    if (!set.has(wc.id)) {
      set.add(wc.id)
      wc.once?.('destroyed', () => unsubscribe(ws, id, wc.id))
    }
  }
  /** Forward every change of a board doc (renderer edits AND main-origin ones, e.g. rename) to its subscribers. */
  const ensureForwarding = (ws: unknown, id: string, doc: Y.Doc) => {
    const k = key(ws, id)
    const cur = forwarders.get(k)
    if (cur?.doc === doc) return
    if (cur) cur.doc.off('update', cur.handler)
    const handler = (update: Uint8Array, origin: unknown) => {
      const skip = (origin as RendererOrigin | null)?.kind === 'remote' ? (origin as RendererOrigin).senderId : -1
      for (const rid of subscribers.get(k) ?? []) {
        if (rid === skip) continue
        const wc = deps.rendererById?.(rid) ?? deps.listRenderers?.().find(w => w.id === rid)
        if (!wc || wc.isDestroyed()) { unsubscribe(ws, id, rid); continue }
        wc.send(CANVAS_IPC.update, ws, id, update)
      }
    }
    doc.on('update', handler)
    forwarders.set(k, { doc, handler })
  }

  ipcMain.handle(CANVAS_IPC.setEnabled, async (event, on: unknown) => {
    guard(event, { flag: false })
    if (typeof on !== 'boolean') throw new Error('CANVAS_BAD_FLAG')
    if (deps.configDir) writeCanvasFlag(deps.configDir, on)
    enabled = on || forced
    return { ok: true as const, enabled }
  })
  ipcMain.handle(CANVAS_IPC.listTrash, async (event, ws: unknown) => {
    guard(event)
    return registry.get(ws).listTrash()
  })
  ipcMain.handle(CANVAS_IPC.restore, async (event, ws: unknown, id: unknown, stamp: unknown) => {
    guard(event)
    if (typeof stamp !== 'number' || !Number.isSafeInteger(stamp)) throw new Error('CANVAS_BAD_STAMP')
    return registry.get(ws).restoreBoard(boardId(id), stamp)
  })
  ipcMain.handle(CANVAS_IPC.list, async (event, ws: unknown): Promise<BoardSummary[]> => {
    guard(event)
    return registry.get(ws).listBoards()
  })
  ipcMain.handle(CANVAS_IPC.create, async (event, ws: unknown, title: unknown): Promise<BoardSummary> => {
    guard(event)
    return registry.get(ws).createBoard(cleanTitle(title))
  })
  ipcMain.handle(CANVAS_IPC.rename, async (event, ws: unknown, id: unknown, title: unknown) => {
    guard(event)
    const store = registry.get(ws)
    const bid = boardId(id)
    await knownBoard(store, bid)
    const board = await store.openBoard(bid)
    ensureForwarding(ws, bid, board.doc)
    board.setTitle(cleanTitle(title), { kind: 'user', userId: 'local' })
    await store.flush(bid)
    await releaseIfIdle(ws, bid)
    return { ok: true as const }
  })
  ipcMain.handle(CANVAS_IPC.trash, async (event, ws: unknown, id: unknown) => {
    guard(event)
    const store = registry.get(ws)
    const bid = boardId(id)
    await knownBoard(store, bid)
    const k = key(ws, bid)
    subscribers.delete(k)
    const f = forwarders.get(k)
    if (f) { f.doc.off('update', f.handler); forwarders.delete(k) }
    await store.trashBoard(bid)
    return { ok: true as const }
  })
  ipcMain.handle(CANVAS_IPC.open, async (event, ws: unknown, id: unknown): Promise<Uint8Array> => {
    guard(event)
    const store = registry.get(ws)
    const bid = boardId(id)
    const seqKey = `${key(ws, bid)}|${event.sender.id}`
    const seq = closeSeq.get(seqKey) ?? 0
    await knownBoard(store, bid)
    const board = await store.openBoard(bid)
    const state = Y.encodeStateAsUpdate(board.doc)
    if ((closeSeq.get(seqKey) ?? 0) !== seq) {
      // Closed by this renderer while opening: don't leak a subscription / keep the board open.
      await releaseIfIdle(ws, bid)
      return state
    }
    ensureForwarding(ws, bid, board.doc)
    subscribe(ws, bid, event.sender)
    return state
  })
  ipcMain.handle(CANVAS_IPC.close, async (event, ws: unknown, id: unknown) => {
    guard(event, { flag: false })
    if (typeof ws === 'string' && typeof id === 'string' && isValidBoardId(id)) {
      const seqKey = `${key(ws, id)}|${event.sender.id}`
      closeSeq.set(seqKey, (closeSeq.get(seqKey) ?? 0) + 1)
      unsubscribe(ws, id, event.sender.id)
    }
    return { ok: true as const }
  })
  ipcMain.handle(CANVAS_IPC.apply, async (event, ws: unknown, id: unknown, update: unknown) => {
    guard(event)
    if (!(update instanceof Uint8Array) || update.length === 0 || update.length > MAX_UPDATE_BYTES) throw new Error('CANVAS_BAD_UPDATE')
    const store = registry.get(ws)
    const bid = boardId(id)
    // Only a renderer that opened this board may write to it (and the board must exist).
    if (!subscribers.get(key(ws, bid))?.has(event.sender.id)) {
      await knownBoard(store, bid)
      throw new Error('CANVAS_NOT_OPEN')
    }
    const board = await store.openBoard(bid)
    ensureForwarding(ws, bid, board.doc)
    const origin: RendererOrigin = { kind: 'remote', senderId: event.sender.id }
    Y.applyUpdate(board.doc, update, origin)
    return { ok: true as const }
  })
  return registry
}
