/**
 * Rox History — GUI RPC handlers + monitor bootstrap.
 *
 * All 12 invoke channels (plus the `clipboard:changed` push) live here, including
 * `clipboard:writeConcealed` for first-party secret copies. The
 * store is created lazily against `<CONFIG_DIR>/clipboard-history/`; when the
 * SQLite runtime is missing the feature degrades fail-soft (read channels
 * answer empty, mutating channels report "unavailable") and the process stays up.
 */

import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { CONFIG_DIR } from '@rox/shared/config'
import { ROX_DEEPLINK_SCHEME } from '@rox/shared/identity'
import { pushTyped, type RequestContext, type RpcServer } from '@rox/server-core/transport'
import type {
  ClipChangedPayload,
  ClipCounts,
  ClipListQuery,
  ClipListResult,
  ClipSettings,
  ClipStats,
  ClipTagCount,
} from '@rox/shared/clipboard-history'
import { ClipboardHistoryStore, DEFAULT_CLIP_SETTINGS, THUMB_MAX_HEIGHT, THUMB_MAX_WIDTH } from '../clipboard-history/store'
import { ClipboardMonitor, type ClipboardAdapter } from '../clipboard-history/monitor'
import { writeClipboardTextConcealed } from '../clipboard-history/conceal'
import {
  syncClipboardShortcut,
  type ClipboardShortcutDeps,
  type ClipboardShortcutGlobalShortcut,
} from '../clipboard-history/shortcut'
import type { HandlerDeps } from './handler-deps'

/**
 * Registered invoke channels. `clipboard:changed` is push-only (it lives in the
 * BroadcastEventMap) and is therefore not part of the handled set, matching every
 * other handler module in this directory.
 */
export const HANDLED_CHANNELS = [
  RPC_CHANNELS.clipboard.LIST,
  RPC_CHANNELS.clipboard.GET,
  RPC_CHANNELS.clipboard.STAR,
  RPC_CHANNELS.clipboard.TAGS,
  RPC_CHANNELS.clipboard.DELETE,
  RPC_CHANNELS.clipboard.CLEAR,
  RPC_CHANNELS.clipboard.COPY,
  RPC_CHANNELS.clipboard.WRITE_CONCEALED,
  RPC_CHANNELS.clipboard.SETTINGS_GET,
  RPC_CHANNELS.clipboard.SETTINGS_SET,
  RPC_CHANNELS.clipboard.TAG_COUNTS,
  RPC_CHANNELS.clipboard.STATS,
] as const

const PRUNE_EVERY_CAPTURES = 200
/** Stored image format → clipboard MIME type for byte-exact write-back. */
const IMAGE_MIME_BY_FORMAT: Record<'png' | 'gif' | 'jpg', string> = {
  png: 'image/png',
  gif: 'image/gif',
  jpg: 'image/jpeg',
}
const EMPTY_COUNTS: ClipCounts = { total: 0, starred: 0, text: 0, image: 0 }
const EMPTY_LIST: ClipListResult = { entries: [], total: 0, counts: EMPTY_COUNTS, hasMore: false }
const EMPTY_STATS: ClipStats = { total: 0, starred: 0, text: 0, image: 0, bytes: 0, storageBytes: 0, oldestAt: null }
const UNAVAILABLE = 'Clipboard history storage is unavailable'

let store: ClipboardHistoryStore | null = null
let storeError: Error | null = null
let adapter: ClipboardAdapter | null = null
let monitor: ClipboardMonitor | null = null
let pushServer: RpcServer | null = null
let handlerDeps: HandlerDeps | null = null
let started = false
let capturesSincePrune = 0

/** Injected `globalShortcut` (tests); production resolves Electron's lazily. */
let shortcutGlobalShortcutOverride: ClipboardShortcutGlobalShortcut | null = null
/** Stable deps object so repeated syncs stay idempotent (shortcut.ts keys on identity). */
let shortcutDeps: ClipboardShortcutDeps | null = null

/**
 * Test seam: swap the clipboard adapter and/or the lazily-opened store, and/or
 * inject a fake `globalShortcut`. Production never calls this; the
 * clipboard-history handler tests use it to drive the copy/settings paths
 * without Electron or the real `<CONFIG_DIR>` database.
 */
export function setClipboardHistoryTestSeams(seams: {
  adapter?: ClipboardAdapter | null
  store?: ClipboardHistoryStore | null
  globalShortcut?: ClipboardShortcutGlobalShortcut | null
}): void {
  if ('adapter' in seams) adapter = seams.adapter ?? null
  if ('store' in seams) {
    store = seams.store ?? null
    storeError = null
  }
  if ('globalShortcut' in seams) {
    shortcutGlobalShortcutOverride = seams.globalShortcut ?? null
    shortcutDeps = null
  }
}

/** Lazily open the store; the first failure is latched and reported as unavailable. */
function openStore(): ClipboardHistoryStore | null {
  if (store) return store
  if (!storeError) {
    try {
      store = new ClipboardHistoryStore({ dir: join(CONFIG_DIR, 'clipboard-history') })
    } catch (error) {
      storeError = error instanceof Error ? error : new Error(String(error))
    }
  }
  return store
}

/**
 * Electron's `clipboard.has`/`ClipboardItem` keys name a raw AppKit pasteboard
 * type as `electron application/osclipboard;format="<pasteboard type>"`.
 */
function osClipboardFormat(rawFormat: string): string {
  return rawFormat.startsWith('electron application/osclipboard')
    ? rawFormat
    : `electron application/osclipboard;format="${rawFormat}"`
}

function createElectronClipboardAdapter(): ClipboardAdapter {
  const { clipboard, nativeImage, ClipboardItem: ElectronClipboardItem } = require('electron') as {
    clipboard: {
      read(): Promise<Array<{ types?: string[]; getType(type: string): Promise<Blob> }>>
      readText(): Promise<string>
      has(mimetype: string): Promise<boolean>
      write(data: Electron.ClipboardItem[]): Promise<void>
      writeText(text: string): Promise<void>
    }
    // `ClipboardItem` is a module export in the main process — there is no such
    // global there (verified against a live Electron 44 instance).
    ClipboardItem: new (items: Record<string, string | Blob>) => Electron.ClipboardItem
    nativeImage: {
      createFromBuffer(buffer: Buffer): {
        isEmpty(): boolean
        getSize(): { width: number; height: number }
        resize(options: { width: number; height: number }): { toPNG(): Buffer }
      }
    }
  }
  return {
    readText: () => clipboard.readText(),
    readTypes: async () => (await clipboard.read()).flatMap(item => item.types ?? []),
    // A bare pasteboard name (e.g. org.nspasteboard.ConcealedType) is wrapped in
    // the raw-key envelope Electron's `has` expects.
    hasRawFormat: rawFormat => clipboard.has(osClipboardFormat(rawFormat)),
    readTypeBytes: async mimeType => {
      // Accept either a platform MIME type (image/png) or a bare raw pasteboard
      // name (com.compuserve.gif), matching whichever form `item.types` exposes.
      const candidates = mimeType === osClipboardFormat(mimeType) ? [mimeType] : [mimeType, osClipboardFormat(mimeType)]
      for (const item of await clipboard.read()) {
        for (const candidate of candidates) {
          if (!item.types?.includes(candidate)) continue
          try {
            return Buffer.from(await (await item.getType(candidate)).arrayBuffer())
          } catch { /* listed but unreadable — try the next candidate */ }
        }
      }
      return null
    },
    // Electron 44's writes return Promises in the main process; awaiting them
    // makes the RPC report success only after the clipboard actually changed.
    writeText: async text => { await clipboard.writeText(text) },
    writeTypeBytes: async (mimeType, bytes) => {
      await clipboard.write([new ElectronClipboardItem({ [mimeType]: new Blob([new Uint8Array(bytes)], { type: mimeType }) })])
    },
    // Decode outside the Electron-free monitor: an undecodable raster (e.g. GIF
    // in some builds) yields null, and the monitor keeps the raw bytes anyway.
    decodeImage: async bytes => {
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) return null
      const size = image.getSize()
      return {
        width: size.width,
        height: size.height,
        thumbnailPng: image.resize({ width: THUMB_MAX_WIDTH, height: THUMB_MAX_HEIGHT }).toPNG(),
      }
    },
  }
}

/** Resolve Electron's `globalShortcut`; absent outside a live Electron main process. */
function loadElectronGlobalShortcut(): ClipboardShortcutGlobalShortcut | null {
  try {
    const { globalShortcut } = require('electron') as { globalShortcut?: ClipboardShortcutGlobalShortcut }
    return globalShortcut ?? null
  } catch {
    return null
  }
}

/** Stable per-process shortcut deps; rebuilt only when the test seam swaps the handle. */
function getShortcutDeps(): ClipboardShortcutDeps | null {
  if (shortcutDeps) return shortcutDeps
  const globalShortcut = shortcutGlobalShortcutOverride ?? loadElectronGlobalShortcut()
  if (!globalShortcut) return null
  shortcutDeps = {
    globalShortcut,
    openHistory: () => { void openHistoryScreen() },
  }
  return shortcutDeps
}

/**
 * Focus the app window and navigate it to Rox History through the normal
 * main→renderer deep-link path (the same path the `shell:openUrl` handler uses).
 *
 * `deep-link` is imported dynamically: it eagerly pulls Electron-bound modules
 * (surface-route gating, entities flags) that have no meaning outside a live
 * main process, so a static import would drag them into every test that loads
 * this handler module — exactly like `handlers/system.ts`.
 */
async function openHistoryScreen(): Promise<void> {
  const windowManager = handlerDeps?.windowManager
  if (!windowManager) return
  const { handleDeepLink } = await import('../deep-link')
  const resolver = (webContentsId: number) => windowManager.getClientIdForWindow(webContentsId)
  const sink = pushServer ? pushServer.push.bind(pushServer) : undefined
  await handleDeepLink(
    `${ROX_DEEPLINK_SCHEME}://clipboard-history`,
    windowManager,
    sink,
    resolver,
    undefined,
    'app',
  )
}

/** Register/release the global shortcut so the stored settings are actually in effect. */
function syncShortcutFromSettings(): void {
  const active = openStore()
  if (!active) return
  const deps = getShortcutDeps()
  if (!deps) return
  const settings = active.getSettings()
  syncClipboardShortcut({ enabled: settings.globalShortcutEnabled, accelerator: settings.globalShortcut }, deps)
}

function requireId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('A clipboard entry id is required')
  return value
}

function requireText(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('A clipboard text value is required')
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error('Clipboard text exceeds the allowed size')
  return value
}

function pushChanged(reason: ClipChangedPayload['reason']): void {
  if (pushServer) pushTyped(pushServer, RPC_CHANNELS.clipboard.CHANGED, { to: 'all' }, { reason })
}

/** Owner fence identical to voice-clipboard: local window + workspace + current grant. */
function assertWriteOwner(server: RpcServer, deps: HandlerDeps, context: RequestContext): void {
  const id = context.webContentsId
  const owner = id === null ? null : deps.windowManager?.getWindowByWebContentsId(id)
  if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed() || owner.webContents.id !== id
    || !context.workspaceId || deps.windowManager?.getWorkspaceForWindow(id!) !== context.workspaceId
    || (server.isRequestContextCurrent && !server.isRequestContextCurrent(context, 'write'))) {
    throw new Error('Clipboard history owner is unavailable')
  }
}

export function registerClipboardHistoryGuiHandlers(server: RpcServer, deps: HandlerDeps): void {
  pushServer = server
  handlerDeps = deps

  server.handle(RPC_CHANNELS.clipboard.LIST, (_context, query: unknown) => {
    const active = openStore()
    return active ? active.list((query ?? {}) as ClipListQuery) : EMPTY_LIST
  })

  server.handle(RPC_CHANNELS.clipboard.GET, (_context, id: unknown) => {
    const active = openStore()
    return active ? active.get(requireId(id)) : null
  })

  server.handle(RPC_CHANNELS.clipboard.STAR, (_context, id: unknown, starred: unknown) => {
    const active = openStore()
    if (!active) throw new Error(UNAVAILABLE)
    active.setStarred(requireId(id), starred === true)
    return { ok: true }
  })

  server.handle(RPC_CHANNELS.clipboard.TAGS, (_context, id: unknown, tags: unknown) => {
    const active = openStore()
    if (!active) throw new Error(UNAVAILABLE)
    const list = Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : []
    active.setTags(requireId(id), list)
    return { ok: true }
  })

  server.handle(RPC_CHANNELS.clipboard.DELETE, (_context, id: unknown) => {
    const active = openStore()
    if (!active) throw new Error(UNAVAILABLE)
    active.delete(requireId(id))
    // The deleted row may be the content currently on the clipboard; forget the
    // cached fingerprints so it is recorded again if the user copies it back.
    void monitor?.resync()
    return { ok: true }
  })

  server.handle(RPC_CHANNELS.clipboard.CLEAR, (_context, keepStarred: unknown) => {
    const active = openStore()
    if (!active) throw new Error(UNAVAILABLE)
    const removed = active.clear(keepStarred === true)
    void monitor?.resync()
    pushChanged('cleared')
    return { removed }
  })

  server.handle(RPC_CHANNELS.clipboard.COPY, async (context, id: unknown) => {
    assertWriteOwner(server, deps, context)
    const active = openStore()
    if (!active) throw new Error(UNAVAILABLE)
    const entry = active.get(requireId(id))
    if (!entry) throw new Error('Clipboard entry was not found')
    const write = adapter ?? (adapter = createElectronClipboardAdapter())
    if (entry.kind === 'text' && entry.text !== null) {
      monitor?.notifyOwnWrite()
      await write.writeText(entry.text)
    } else if (entry.kind === 'image') {
      if (!entry.imageDataUrl || !entry.imageFormat) throw new Error('Clipboard entry content is unavailable')
      // The store keeps the original image file, so decode its raw bytes and write
      // them back byte-exact under the stored format's MIME type — never re-encode.
      const base64 = entry.imageDataUrl.slice(entry.imageDataUrl.indexOf(',') + 1)
      const bytes = Buffer.from(base64, 'base64')
      const mimeType = IMAGE_MIME_BY_FORMAT[entry.imageFormat]
      if (!mimeType) throw new Error('Clipboard entry image format is unsupported')
      monitor?.notifyOwnWrite()
      await write.writeTypeBytes(mimeType, bytes)
    }
    return { ok: true }
  }, { access: 'localElectron', nativeAction: 'write' })

  server.handle(RPC_CHANNELS.clipboard.WRITE_CONCEALED, async (context, text: unknown) => {
    assertWriteOwner(server, deps, context)
    const value = requireText(text, 1_000_000)
    await writeClipboardTextConcealed(value)
    monitor?.notifyOwnWrite()
    return { ok: true }
  }, { access: 'localElectron', nativeAction: 'write' })

  server.handle(RPC_CHANNELS.clipboard.SETTINGS_GET, (): ClipSettings => {
    const active = openStore()
    return active ? active.getSettings() : { ...DEFAULT_CLIP_SETTINGS }
  })

  server.handle(RPC_CHANNELS.clipboard.SETTINGS_SET, (_context, patch: unknown): ClipSettings => {
    const active = openStore()
    if (!active) throw new Error(UNAVAILABLE)
    const next = active.saveSettings((patch ?? {}) as Partial<ClipSettings>)
    syncShortcutFromSettings()
    pushChanged('settings')
    return next
  })

  server.handle(RPC_CHANNELS.clipboard.TAG_COUNTS, (): ClipTagCount[] => {
    const active = openStore()
    return active ? active.tagCounts() : []
  })

  server.handle(RPC_CHANNELS.clipboard.STATS, (): ClipStats => {
    const active = openStore()
    return active ? active.stats() : EMPTY_STATS
  })
}

/** Start the polling monitor once; no-op without storage or on repeat calls. */
export function startClipboardMonitor(deps: HandlerDeps): void {
  if (started) return
  started = true
  handlerDeps = deps
  const active = openStore()
  if (!active) return
  adapter = adapter ?? createElectronClipboardAdapter()
  monitor = new ClipboardMonitor({
    adapter,
    sink: active,
    onChanged: payload => {
      capturesSincePrune += 1
      if (capturesSincePrune >= PRUNE_EVERY_CAPTURES) {
        capturesSincePrune = 0
        active.prune(new Date())
      }
      pushChanged(payload.reason)
    },
    onError: error => { console.warn('[clipboard-history] monitor tick failed', error) },
  })
  active.prune(new Date())
  monitor.start()
  syncShortcutFromSettings()
}