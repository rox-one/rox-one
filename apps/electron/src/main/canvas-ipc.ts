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
import { CanvasAssetStore, CanvasFileStore, isValidAssetHash, isValidBoardId, MAX_ASSET_BYTES, normalizeAssetMime, sanitizeAssetName, type AssetMeta, type BoardSummary } from '@rox/canvas-core/node'
import { registerEntityResolverFactory } from '@rox/server-core/handlers/rpc/entities'
import { setCanvasFileStoreHost } from '@rox/server-core/canvas/store-host'
import type { EntityPreview, EntityRef } from '@rox/core/entities'

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
  putAsset: 'canvas:putAsset',
  getAsset: 'canvas:getAsset',
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
      return this.forRoot(root)
    },
    /** Same store instance Electron IPC and agent tools must share (lock). */
    forRoot(root: string): CanvasFileStore {
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
    /**
     * Board title for entity previews / «На доске …» backlinks.
     * Scoped to one workspace so titles never cross stores.
     */
    async findBoardTitle(workspaceId: string, boardId: string): Promise<string | null> {
      if (!isValidBoardId(boardId)) return null
      try {
        const hit = (await this.get(workspaceId).listBoards()).find(b => b.id === boardId)
        return hit?.title ?? null
      } catch { /* unknown workspace / store mid-close */
        return null
      }
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


/** Live board-title lookup for the canvas entity resolver (set by registerCanvasIpc). */
let canvasTitleLookup: ((workspaceId: string, boardId: string) => Promise<string | null>) | null = null
let canvasResolverRegistered = false

function canvasPreview(ref: EntityRef, title: string | null): EntityPreview {
  if (title === null) {
    return {
      ref,
      status: 'unavailable' as const,
      title: '',
      kindLabel: 'entities.kind.canvas',
      icon: 'presentation',
      authority: 'local' as const,
      etag: `canvas:missing:${ref.id}`,
    }
  }
  return {
    ref,
    status: 'ok' as const,
    title,
    kindLabel: 'entities.kind.canvas',
    icon: 'presentation',
    authority: 'local' as const,
    etag: `canvas:${ref.id}:${title}`,
  }
}

/** Wire / re-wire the canvas → title lookup used by `entities:resolve` (once, per-workspace). */
export function bindCanvasEntityResolver(lookup: (workspaceId: string, boardId: string) => Promise<string | null>): void {
  canvasTitleLookup = lookup
  if (canvasResolverRegistered) return
  canvasResolverRegistered = true
  // Factory closes over workspaceId so titles never leak across stores.
  registerEntityResolverFactory((workspaceId) => ({
    kinds: ['canvas'],
    async resolve(refs: EntityRef[]): Promise<EntityPreview[]> {
      return Promise.all(refs.map(async (ref) => {
        const title = await (canvasTitleLookup?.(workspaceId, ref.id) ?? Promise.resolve(null))
        return canvasPreview(ref, title)
      }))
    },
  }))
}

/** Tests only — drop the lookup + flag so the next registerCanvasIpc rebinds cleanly. */
export function __resetCanvasEntityResolverForTests(): void {
  canvasTitleLookup = null
  canvasResolverRegistered = false
}

export function registerCanvasIpc(ipcMain: Pick<IpcMain, 'handle'>, deps: CanvasIpcDependencies & {
  /** Look up a live renderer by id (forwarding). */
  rendererById?(id: number): WebContents | undefined
  /** Override the start-up value of `workbench.mode.canvas.v1` (tests). */
  initiallyEnabled?: boolean
  /** Config dir: the last flag value the renderer pushed is persisted here and read at init. */
  configDir?: string
  /** Notified whenever the effective canvas flag changes (SessionManager mirrors it). */
  onEnabledChange?: (enabled: boolean) => void
}) {
  const registry = createCanvasStoreRegistry(deps)
  // Share this process's stores with agent canvas tools (one store per root — lock).
  setCanvasFileStoreHost({ forRoot: (root) => registry.forRoot(root) })
  // WP3.2: point the (once-registered) canvas resolver at this process's stores.
  bindCanvasEntityResolver((workspaceId, boardId) => registry.findBoardTitle(workspaceId, boardId))
  const forced = process.env.ROX_CANVAS === '1'
  let enabled = forced || (deps.initiallyEnabled ?? (deps.configDir ? readCanvasFlag(deps.configDir) : undefined) ?? CANVAS_FLAG_DEFAULT)
  deps.onEnabledChange?.(enabled)
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
  /** "<key>|<renderer id>" → opens in flight; "<key>" → opens in flight from any renderer. */
  const pendingOpens = new Map<string, number>()
  const bump = (k: string, d: number) => {
    const n = (pendingOpens.get(k) ?? 0) + d
    if (n > 0) pendingOpens.set(k, n); else pendingOpens.delete(k)
    return n
  }
  /** Drop the forwarder and close the board once nobody has it open. */
  const releaseIfIdle = async (ws: unknown, id: string) => {
    const k = key(ws, id)
    // A pending open (any renderer) shares the store's doc: closing it now would hand that open a closed doc.
    if (subscribers.get(k)?.size || pendingOpens.get(k)) return
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
    deps.onEnabledChange?.(enabled)
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
    const k = key(ws, bid)
    const seqKey = `${k}|${event.sender.id}`
    const seq = closeSeq.get(seqKey) ?? 0
    bump(k, 1); bump(seqKey, 1)
    let board: Awaited<ReturnType<typeof store.openBoard>>
    try {
      await knownBoard(store, bid)
      board = await store.openBoard(bid)
    } catch (e) {
      bump(k, -1); if (!bump(seqKey, -1)) closeSeq.delete(seqKey)
      await releaseIfIdle(ws, bid)
      throw e
    }
    const state = Y.encodeStateAsUpdate(board.doc)
    // A renderer destroyed mid-open never fires 'destroyed' for a later subscribe: treat it as closed.
    const closed = (closeSeq.get(seqKey) ?? 0) !== seq || event.sender.isDestroyed()
    bump(k, -1); if (!bump(seqKey, -1)) closeSeq.delete(seqKey)
    if (closed) {
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
      if (pendingOpens.get(seqKey)) closeSeq.set(seqKey, (closeSeq.get(seqKey) ?? 0) + 1)
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
  // Content-addressed blobs under <ws>/canvas/assets/<sha256>. Metadata is written
  // into the board Y.Doc by the renderer (assets map); main only stores bytes.
  const assetStoreFor = (ws: unknown) => new CanvasAssetStore(registry.rootOf(ws))
  ipcMain.handle(CANVAS_IPC.putAsset, async (event, ws: unknown, bytes: unknown, mime: unknown, name: unknown): Promise<AssetMeta> => {
    guard(event)
    if (!(bytes instanceof Uint8Array)) throw new Error('CANVAS_BAD_ASSET')
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) throw new Error('CANVAS_BAD_ASSET')
    if (!normalizeAssetMime(mime)) throw new Error('CANVAS_BAD_ASSET_MIME')
    return assetStoreFor(ws).put(bytes, String(mime), sanitizeAssetName(name))
  })
  ipcMain.handle(CANVAS_IPC.getAsset, async (event, ws: unknown, hash: unknown): Promise<Uint8Array> => {
    guard(event)
    if (typeof hash !== 'string' || !isValidAssetHash(hash)) throw new Error('CANVAS_BAD_ASSET_HASH')
    return assetStoreFor(ws).get(hash)
  })
  return registry
}
