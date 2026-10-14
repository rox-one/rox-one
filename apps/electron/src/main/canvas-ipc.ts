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

export function registerCanvasIpc(ipcMain: Pick<IpcMain, 'handle'>, deps: CanvasIpcDependencies & {
  /** Look up a live renderer by id (forwarding). */
  rendererById?(id: number): WebContents | undefined
  /** Workbench flag `workbench.mode.canvas.v1`; the renderer syncs it, `ROX_CANVAS=1` forces it on. */
  initiallyEnabled?: boolean
}) {
  const registry = createCanvasStoreRegistry(deps)
  let enabled = deps.initiallyEnabled ?? process.env.ROX_CANVAS === '1'
  const guard = (event: IpcMainInvokeEvent, opts: { flag?: boolean } = {}) => {
    if (deps.isTrustedSender && !deps.isTrustedSender(event)) throw new Error('IPC_SENDER_DENIED')
    if (opts.flag !== false && !enabled) throw new Error('CANVAS_DISABLED')
  }
  const knownBoard = async (store: CanvasFileStore, id: string) => {
    const boards = await store.listBoards()
    if (!boards.some(b => b.id === id)) throw new Error('CANVAS_UNKNOWN_BOARD')
  }
  /** "<ws>|<board>" → renderer ids that have the board open. */
  const subscribers = new Map<string, Set<number>>()
  const forwarding = new WeakSet<object>()
  const key = (ws: string, id: string) => `${ws}|${id}`
  const subscribe = (ws: string, id: string, wc: WebContents) => {
    const k = key(ws, id)
    let set = subscribers.get(k)
    if (!set) { set = new Set(); subscribers.set(k, set) }
    if (!set.has(wc.id)) {
      set.add(wc.id)
      wc.once?.('destroyed', () => subscribers.get(k)?.delete(wc.id))
    }
  }
  /** Forward every change of a board doc (renderer edits AND main-origin ones, e.g. rename) to its subscribers. */
  const ensureForwarding = (ws: string, id: string, doc: Y.Doc) => {
    if (forwarding.has(doc)) return
    forwarding.add(doc)
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const skip = (origin as RendererOrigin | null)?.kind === 'remote' ? (origin as RendererOrigin).senderId : -1
      for (const rid of subscribers.get(key(ws, id)) ?? []) {
        if (rid === skip) continue
        const wc = deps.rendererById?.(rid) ?? deps.listRenderers?.().find(w => w.id === rid)
        if (!wc || wc.isDestroyed()) { subscribers.get(key(ws, id))?.delete(rid); continue }
        wc.send(CANVAS_IPC.update, ws, id, update)
      }
    })
  }

  ipcMain.handle(CANVAS_IPC.setEnabled, async (event, on: unknown) => {
    guard(event, { flag: false })
    enabled = on === true || process.env.ROX_CANVAS === '1'
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
    ensureForwarding(ws as string, bid, board.doc)
    board.setTitle(cleanTitle(title), { kind: 'user', userId: 'local' })
    await store.flush(bid)
    return { ok: true as const }
  })
  ipcMain.handle(CANVAS_IPC.trash, async (event, ws: unknown, id: unknown) => {
    guard(event)
    const store = registry.get(ws)
    const bid = boardId(id)
    await knownBoard(store, bid)
    await store.trashBoard(bid)
    subscribers.delete(key(ws as string, bid))
    return { ok: true as const }
  })
  ipcMain.handle(CANVAS_IPC.open, async (event, ws: unknown, id: unknown): Promise<Uint8Array> => {
    guard(event)
    const store = registry.get(ws)
    const bid = boardId(id)
    await knownBoard(store, bid)
    const board = await store.openBoard(bid)
    ensureForwarding(ws as string, bid, board.doc)
    subscribe(ws as string, bid, event.sender)
    return Y.encodeStateAsUpdate(board.doc)
  })
  ipcMain.handle(CANVAS_IPC.close, async (event, ws: unknown, id: unknown) => {
    guard(event, { flag: false })
    if (typeof ws === 'string' && typeof id === 'string') subscribers.get(key(ws, id))?.delete(event.sender.id)
    return { ok: true as const }
  })
  ipcMain.handle(CANVAS_IPC.apply, async (event, ws: unknown, id: unknown, update: unknown) => {
    guard(event)
    if (!(update instanceof Uint8Array) || update.length === 0 || update.length > MAX_UPDATE_BYTES) throw new Error('CANVAS_BAD_UPDATE')
    const store = registry.get(ws)
    const bid = boardId(id)
    // Only a renderer that opened this board may write to it (and the board must exist).
    if (!subscribers.get(key(ws as string, bid))?.has(event.sender.id)) {
      await knownBoard(store, bid)
      throw new Error('CANVAS_NOT_OPEN')
    }
    const board = await store.openBoard(bid)
    ensureForwarding(ws as string, bid, board.doc)
    const origin: RendererOrigin = { kind: 'remote', senderId: event.sender.id }
    Y.applyUpdate(board.doc, update, origin)
    return { ok: true as const }
  })
  return registry
}
