/**
 * Electron wiring for the local meeting store (direct ipcMain, not WS RPC:
 * the microphone, the audio files and whisper.cpp live on this device).
 */
import { app, BrowserWindow, dialog, ipcMain, session, shell, systemPreferences, webContents } from 'electron'
import { join } from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config'
import { MEETINGS_LOCAL_IPC as C, type LocalMeetingPatch } from '../../shared/meetings-local'
import { detectEngine } from './local-asr'
import { IMPORTABLE_AUDIO_EXTENSIONS, isMeetingId } from './local-model'
import { LocalMeetingStore } from './local-store'

let store: LocalMeetingStore | null = null

function broadcast(id: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(C.CHANGED, { id })
  }
}

function ownerAlive(id: number): boolean {
  const wc = webContents.fromId(id)
  return !!wc && !wc.isDestroyed()
}

function isAppOrigin(url: string | undefined): boolean {
  if (!url) return false
  if (url.startsWith('file://')) return true
  try {
    const u = new URL(url)
    return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && (u.protocol === 'http:' || u.protocol === 'https:')
  } catch {
    return false
  }
}

/**
 * Microphone for the app UI only: the default session grants `media` to the
 * app's own pages (file:// or the dev server) and denies it elsewhere; every
 * other permission keeps Electron's default. Browser panes use their own
 * partitions with their own handlers.
 */
function installMediaPermissionHandler(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'media') {
      callback(isAppOrigin(details?.requestingUrl ?? wc?.getURL()))
      return
    }
    callback(true)
  })
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    if (permission === 'media') return isAppOrigin(requestingOrigin || wc?.getURL())
    return true
  })
}

async function micAccess(ask: boolean): Promise<string> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return 'unknown'
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (process.platform === 'darwin' && ask && status === 'not-determined') {
    return (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied'
  }
  return status
}

export function registerLocalMeetingsIpc(log?: (message: string, error?: unknown) => void): LocalMeetingStore {
  if (store) return store
  const root = join(CONFIG_DIR, 'meetings')
  const s = new LocalMeetingStore({ root, detectEngine: () => detectEngine(CONFIG_DIR), emit: broadcast, log })
  store = s
  try {
    installMediaPermissionHandler()
  } catch (error) {
    log?.('[meetings-local] permission handler failed', error)
  }

  const handle = (channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, fn)
  }

  handle(C.LIST, (_e, workspaceId: string | null) => s.list(workspaceId ?? null))
  handle(C.GET, (_e, id: string) => s.read(id))
  handle(C.CREATE, (_e, input: { title: string; workspaceId: string | null; scheduledAt?: number }) =>
    s.create({ title: String(input?.title ?? ''), workspaceId: input?.workspaceId ?? null, scheduledAt: typeof input?.scheduledAt === 'number' ? input.scheduledAt : undefined }))
  handle(C.UPDATE, (_e, id: string, patch: LocalMeetingPatch) => s.update(id, patch ?? {}))
  handle(C.TRASH, async (_e, id: string) => {
    if (!isMeetingId(id) || !s.canRemove(id)) return false
    try {
      await shell.trashItem(s.dir(id))
    } catch (error) {
      log?.('[meetings-local] trash failed', error)
      return false
    }
    broadcast(id)
    return true
  })

  handle(C.REC_START, (e, input: { meetingId?: string; title: string; workspaceId: string | null; mimeType: string }) =>
    s.recStart({ ...input, owner: e.sender.id }))
  handle(C.REC_CHUNK, (_e, id: string, chunk: Uint8Array) => s.recChunk(id, chunk))
  handle(C.REC_STATE, (_e, id: string, state: { paused: boolean; durationMs: number }) => s.recState(id, state))
  handle(C.REC_STOP, (_e, id: string, input: { durationMs: number }) => s.recStop(id, input))
  handle(C.RECOVER, (e) => s.recover(ownerAlive, e.sender.id))

  handle(C.IMPORT_AUDIO, async (e, input: { meetingId?: string; workspaceId: string | null; path?: string }) => {
    let path = input?.path
    if (!path) {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const picked = win
        ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Audio', extensions: IMPORTABLE_AUDIO_EXTENSIONS }] })
        : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: IMPORTABLE_AUDIO_EXTENSIONS }] })
      if (picked.canceled || !picked.filePaths[0]) return null
      path = picked.filePaths[0]
    }
    return s.importAudio({ path, meetingId: input?.meetingId, workspaceId: input?.workspaceId ?? null })
  })
  handle(C.READ_AUDIO, (_e, id: string) => s.readAudio(id))
  handle(C.READ_TRANSCRIPT, (_e, id: string) => s.readTranscript(id))
  handle(C.TRANSCRIBE, (_e, id: string) => s.transcribe(id))
  handle(C.ENGINE, () => detectEngine(CONFIG_DIR))
  handle(C.MIC_ACCESS, (_e, ask: boolean) => micAccess(!!ask))

  handle(C.ATTACH, async (e, id: string, paths?: string[]) => {
    let list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : []
    if (list.length === 0) {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const picked = win
        ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
        : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
      if (picked.canceled) return s.read(id)
      list = picked.filePaths
    }
    return s.attach(id, list)
  })
  handle(C.OPEN_DOC, async (_e, id: string, docId: string) => {
    const path = s.documentPath(id, docId)
    if (!path) return false
    return (await shell.openPath(path)) === ''
  })
  handle(C.REVEAL, (_e, id: string, docId?: string) => {
    if (!isMeetingId(id)) return false
    const path = docId ? s.documentPath(id, docId) : (s.audioPath(id) ?? join(s.dir(id), 'meeting.json'))
    if (!path) return false
    shell.showItemInFolder(path)
    return true
  })
  handle(C.REMOVE_DOC, (_e, id: string, docId: string) => s.removeDocument(id, docId))

  // A renderer that dies or reloads mid-recording can't feed chunks any more:
  // finalize what reached the disk so the recording isn't lost.
  const watch = (wc: Electron.WebContents) => {
    wc.on('render-process-gone', () => { void s.stopOwnedBy(wc.id) })
    wc.on('destroyed', () => { void s.stopOwnedBy(wc.id) })
  }
  for (const wc of webContents.getAllWebContents()) watch(wc)
  app.on('web-contents-created', (_event, wc) => watch(wc))

  // Crash/restart recovery, then resume ASR jobs cut off by a quit.
  void s.recover(() => false).then((ids) => {
    if (ids.length) log?.(`[meetings-local] recovered ${ids.length} interrupted recording(s)`)
    s.resumePending()
  })
  return s
}
