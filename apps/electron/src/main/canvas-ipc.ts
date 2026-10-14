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
  update: 'canvas:update', // main → renderer event
} as const

const MAX_TITLE = 200
const MAX_UPDATE_BYTES = 16 * 1024 * 1024
const RENDERER_ORIGIN = { kind: 'remote' as const }

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

export function registerCanvasIpc(ipcMain: Pick<IpcMain, 'handle'>, deps: CanvasIpcDependencies) {
  const registry = createCanvasStoreRegistry(deps)
  const guard = (event: IpcMainInvokeEvent) => {
    if (deps.isTrustedSender && !deps.isTrustedSender(event)) throw new Error('IPC_SENDER_DENIED')
  }
  const knownBoard = async (store: CanvasFileStore, id: string) => {
    const boards = await store.listBoards()
    if (!boards.some(b => b.id === id)) throw new Error('CANVAS_UNKNOWN_BOARD')
  }

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
    return { ok: true as const }
  })
  ipcMain.handle(CANVAS_IPC.open, async (event, ws: unknown, id: unknown): Promise<Uint8Array> => {
    guard(event)
    const store = registry.get(ws)
    const bid = boardId(id)
    await knownBoard(store, bid)
    const board = await store.openBoard(bid)
    return Y.encodeStateAsUpdate(board.doc)
  })
  ipcMain.handle(CANVAS_IPC.apply, async (event, ws: unknown, id: unknown, update: unknown) => {
    guard(event)
    if (!(update instanceof Uint8Array) || update.length === 0 || update.length > MAX_UPDATE_BYTES) throw new Error('CANVAS_BAD_UPDATE')
    const store = registry.get(ws)
    const bid = boardId(id)
    const board = await store.openBoard(bid)
    Y.applyUpdate(board.doc, update, RENDERER_ORIGIN)
    for (const wc of deps.listRenderers?.() ?? []) {
      if (wc.id === event.sender.id || wc.isDestroyed()) continue
      wc.send(CANVAS_IPC.update, ws, bid, update)
    }
    return { ok: true as const }
  })
  return registry
}
