/**
 * Electron wiring for the local meeting store (direct ipcMain, not WS RPC:
 * the microphone, the audio files and whisper.cpp live on this device).
 */
import { app, BrowserWindow, dialog, ipcMain, session, shell, systemPreferences, webContents } from 'electron'
import { join } from 'node:path'
import { CONFIG_DIR, getWorkspaceByNameOrId } from '@rox/shared/config'
import { getServerServiceKey } from '@rox/shared/config/server-services'
import { DeepgramTranscriptionAdapter } from '@rox/shared/voice'
import { MEETINGS_LOCAL_IPC as C, type LocalMeetingPatch, type LocalTranscriptSegmentUpdate } from '../../shared/meetings-local'
import { detectEngine } from './local-asr'
import { IMPORTABLE_AUDIO_EXTENSIONS, isMeetingId } from './local-model'
import { LocalMeetingStore, type LocalTranscriptionContext } from './local-store'
import { MeetingCloudAsr } from './cloud-asr'
import { WorkspaceWorkStore } from '@rox/server-core/workspace-work/store'
import { isAllowedServerEndpoint } from '../server-endpoint-policy'

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

export interface LocalMeetingsIpcDeps {
  getWorkspaceForWindow(id: number): string | null
  getWorkspaceGenerationForWindow(id: number): number | null
}

export function registerLocalMeetingsIpc(log?: (message: string, error?: unknown) => void, windowBindings?: LocalMeetingsIpcDeps): LocalMeetingStore {
  if (store) return store
  const root = join(CONFIG_DIR, 'meetings')
  const isContextCurrent = (workspaceId: string, context: LocalTranscriptionContext) => ownerAlive(context.ownerId)
    && windowBindings?.getWorkspaceForWindow(context.ownerId) === workspaceId
    && windowBindings?.getWorkspaceGenerationForWindow(context.ownerId) === context.bindingGeneration
  const cloud = new MeetingCloudAsr({
    getWorkspace: getWorkspaceByNameOrId,
    localEngine: () => detectEngine(CONFIG_DIR),
    localTranscribe: (input) => new DeepgramTranscriptionAdapter({
      apiKey: getServerServiceKey('DEEPGRAM_API_KEY') ?? '', model: process.env.DEEPGRAM_MODEL,
    }).transcribe(input),
    isContextCurrent,
    async connect(remote) {
      const { resolveRemoteConnection } = await import('../ssh-tunnel/connection-resolver')
      const { getSshTunnelManager } = await import('../ssh-tunnel/ssh-tunnel-manager')
      const target = remote.sshHostId
        ? await resolveRemoteConnection(remote, getSshTunnelManager().connectionResolverDeps())
        : remote
      if (!isAllowedServerEndpoint(target.url).ok) throw new Error('cloud-transcription-unavailable')
      const { connectToRemote } = await import('../handlers/workspace')
      const { client } = await connectToRemote(target.url, target.token, target.remoteWorkspaceId,
        { requestTimeout: 240_000, tlsTrust: remote.tlsTrust })
      if (!client) throw new Error('cloud-transcription-unavailable')
      return client
    },
  })
  const s = new LocalMeetingStore({ root, detectEngine: (meeting) => cloud.engine(meeting?.workspaceId ?? null),
    validateTaskReference: (meeting, actionId, ref) => {
      if (ref.scope === 'personal') return true
      if (!meeting.workspaceId || ref.workspaceId !== meeting.workspaceId) return false
      const workspace = getWorkspaceByNameOrId(meeting.workspaceId)
      if (!workspace || workspace.id !== ref.workspaceId || workspace.remoteServer) return false
      const resolution = new WorkspaceWorkStore(workspace.rootPath, workspace.id).resolveTask(ref.id)
      return resolution.status === 'available' && resolution.task.links.some(link => link.kind === 'meeting' &&
        link.workspaceId === workspace.id && link.id === meeting.id && link.anchor === actionId)
    },
    transcribeCloud: (input, meeting, context) => cloud.transcribe(input, meeting, context),
    getTranscriptionContext: (meeting) => {
      if (!meeting.workspaceId) return undefined
      for (const win of BrowserWindow.getAllWindows()) {
        const ownerId = win.webContents.id
        const bindingGeneration = windowBindings?.getWorkspaceGenerationForWindow(ownerId)
        if (bindingGeneration != null && isContextCurrent(meeting.workspaceId, { ownerId, bindingGeneration })) return { ownerId, bindingGeneration }
      }
      return undefined
    }, emit: broadcast, log })
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
  const assertSender = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame || !isAppOrigin(event.senderFrame?.url)) throw new Error('WORKSPACE_MISMATCH')
  }
  const contextFor = (event: Electron.IpcMainInvokeEvent, workspaceId: string | null): LocalTranscriptionContext => {
    assertSender(event)
    const bound = windowBindings?.getWorkspaceForWindow(event.sender.id)
    const bindingGeneration = windowBindings?.getWorkspaceGenerationForWindow(event.sender.id)
    if (!bound || workspaceId !== null && workspaceId !== bound || bindingGeneration == null) throw new Error('WORKSPACE_MISMATCH')
    return { ownerId: event.sender.id, bindingGeneration }
  }
  const meetingContext = (event: Electron.IpcMainInvokeEvent, id: string) => {
    let meeting = s.read(id)
    if (!meeting) throw new Error('meeting-not-found')
    // Legacy recordings had no workspace. The first explicit native access
    // binds them once to this verified window; another workspace cannot claim
    // or read their audio afterward.
    if (!meeting.workspaceId) {
      contextFor(event, null)
      meeting = s.bindLegacyWorkspace(id, windowBindings!.getWorkspaceForWindow(event.sender.id)!)
      if (!meeting) throw new Error('WORKSPACE_MISMATCH')
    }
    return { meeting, context: contextFor(event, meeting.workspaceId) }
  }
  const importRequests = new Map<string, { ownerId: number; cancelled: boolean }>()

  handle(C.LIST, (e, workspaceId: string | null) => {
    contextFor(e, workspaceId)
    return s.list(windowBindings!.getWorkspaceForWindow(e.sender.id)!)
  })
  handle(C.GET, (e, id: string) => { if (!s.read(id)) return null; meetingContext(e, id); return s.read(id) })
  handle(C.CREATE, (e, input: { title: string; workspaceId: string | null; scheduledAt?: number }) => {
    contextFor(e, input.workspaceId)
    return s.create({ title: String(input?.title ?? ''), workspaceId: windowBindings!.getWorkspaceForWindow(e.sender.id)!, scheduledAt: typeof input?.scheduledAt === 'number' ? input.scheduledAt : undefined })
  })
  handle(C.UPDATE, (e, id: string, patch: LocalMeetingPatch) => { meetingContext(e, id); return s.update(id, patch ?? {}) })
  handle(C.EXTRACTION_CLAIM, (e, id: string, input: Parameters<LocalMeetingStore['claimExtraction']>[1]) => { meetingContext(e, id); return s.claimExtraction(id, input) })
  handle(C.EXTRACTION_ATTACH, (e, id: string, input: Parameters<LocalMeetingStore['attachExtraction']>[1]) => { meetingContext(e, id); return s.attachExtraction(id, input) })
  handle(C.EXTRACTION_FINISH, (e, id: string, input: Parameters<LocalMeetingStore['finishExtraction']>[1]) => { meetingContext(e, id); return s.finishExtraction(id, input) })
  handle(C.EXTRACTION_FAIL, (e, id: string, input: Parameters<LocalMeetingStore['failExtraction']>[1]) => { meetingContext(e, id); return s.failExtraction(id, input) })
  handle(C.ACTION_SAVE, (e, id: string, input: Parameters<LocalMeetingStore['saveAction']>[1]) => {
    const { meeting } = meetingContext(e, id)
    const ref = input?.patch?.taskRef
    if (ref?.scope === 'workspace') {
      if (!meeting.workspaceId || ref.workspaceId !== meeting.workspaceId) return { ok: false, code: 'WORKSPACE_MISMATCH' }
      const workspace = getWorkspaceByNameOrId(meeting.workspaceId)
      if (!workspace || workspace.id !== ref.workspaceId || workspace.remoteServer) return { ok: false, code: 'task-storage-unavailable' }
      const resolution = new WorkspaceWorkStore(workspace.rootPath, workspace.id).resolveTask(ref.id)
      if (resolution.status !== 'available' || !resolution.task.links.some(link => link.kind === 'meeting' && link.workspaceId === workspace.id && link.id === id && link.anchor === input.actionId)) {
        return { ok: false, code: 'task-link-unavailable' }
      }
    }
    return s.saveAction(id, input)
  })
  handle(C.TRASH, async (e, id: string) => {
    if (!isMeetingId(id) || !s.canRemove(id)) return false
    meetingContext(e, id)
    try {
      await shell.trashItem(s.dir(id))
    } catch (error) {
      log?.('[meetings-local] trash failed', error)
      return false
    }
    broadcast(id)
    return true
  })

  handle(C.REC_START, (e, input: { meetingId?: string; title: string; workspaceId: string | null; mimeType: string }) => {
    const context = contextFor(e, input.workspaceId)
    if (input.meetingId) meetingContext(e, input.meetingId)
    return s.recStart({ ...input, workspaceId: windowBindings!.getWorkspaceForWindow(e.sender.id)!, owner: e.sender.id, transcriptionContext: context })
  })
  handle(C.REC_CHUNK, (e, id: string, chunk: Uint8Array) => {
    meetingContext(e, id)
    if (!s.isRecordingOwnedBy(id, e.sender.id)) throw new Error('WORKSPACE_MISMATCH')
    return s.recChunk(id, chunk)
  })
  handle(C.REC_STATE, (e, id: string, state: { paused: boolean; durationMs: number }) => {
    meetingContext(e, id)
    if (!s.isRecordingOwnedBy(id, e.sender.id)) throw new Error('WORKSPACE_MISMATCH')
    return s.recState(id, state)
  })
  handle(C.REC_STOP, async (e, id: string, input: { durationMs: number }) => {
    assertSender(e)
    if (s.isRecording(id) && !s.isRecordingOwnedBy(id, e.sender.id)) throw new Error('WORKSPACE_MISMATCH')
    try { meetingContext(e, id) } catch (error) {
      if (!s.isRecordingOwnedBy(id, e.sender.id)) throw error
      // Stop the owner's recording even if their window switched workspace.
      // Its captured lease prevents ASR upload; the current workspace receives
      // no previous-workspace metadata. Offline discovery never delays saving.
      await s.recStop(id, input)
      return { ok: false, code: 'recording-context-changed' }
    }
    return s.recStop(id, input)
  })
  handle(C.RECOVER, async (e) => {
    contextFor(e, null)
    const workspaceId = windowBindings!.getWorkspaceForWindow(e.sender.id)!
    return (await s.recover(ownerAlive, e.sender.id)).filter(id => {
      const meeting = s.read(id)
      return meeting?.workspaceId === workspaceId || meeting?.workspaceId === null
    })
  })

  handle(C.IMPORT_AUDIO, async (e, input: { requestId: string; meetingId?: string; workspaceId: string | null; path?: string }) => {
    const context = contextFor(e, input.workspaceId)
    const workspaceId = windowBindings!.getWorkspaceForWindow(e.sender.id)!
    if (input.meetingId) meetingContext(e, input.meetingId)
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)) return { ok: false, code: 'invalid-import-request' }
    if (importRequests.has(input.requestId)) return { ok: false, code: 'import-in-progress' }
    const request = { ownerId: e.sender.id, cancelled: false }
    importRequests.set(input.requestId, request)
    try {
      let path = input.path
      if (!path) {
        const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
        const picked = win
          ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Audio', extensions: IMPORTABLE_AUDIO_EXTENSIONS }] })
          : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: IMPORTABLE_AUDIO_EXTENSIONS }] })
        if (picked.canceled || !picked.filePaths[0]) return null
        path = picked.filePaths[0]
      }
      if (request.cancelled) return { ok: false, code: 'import-cancelled' }
      await cloud.inspect(workspaceId, context)
      if (request.cancelled) return { ok: false, code: 'import-cancelled' }
      if (!isContextCurrent(workspaceId, context)) throw new Error('WORKSPACE_MISMATCH')
      const result = await s.importAudio({ requestId: input.requestId, path, meetingId: input.meetingId, workspaceId,
        transcriptionContext: context })
      if (!isContextCurrent(workspaceId, context)) throw new Error('WORKSPACE_MISMATCH')
      return result
    } finally {
      importRequests.delete(input.requestId)
    }
  })
  handle(C.IMPORT_CANCEL, (e, requestId: string) => {
    assertSender(e)
    const request = importRequests.get(requestId)
    if (!request) return false
    if (request.ownerId !== e.sender.id) throw new Error('WORKSPACE_MISMATCH')
    request.cancelled = true
    s.cancelImport(requestId)
    return true
  })
  handle(C.READ_AUDIO, (e, id: string) => { meetingContext(e, id); return s.readAudio(id) })
  handle(C.READ_TRANSCRIPT, (e, id: string) => { meetingContext(e, id); return s.readTranscript(id) })
  handle(C.READ_TRANSCRIPT_REVISION, (e, id: string, revision: number) => { meetingContext(e, id); return s.readTranscriptRevision(id, revision) })
  handle(C.RESTORE_TRANSCRIPT_REVISION, (e, id: string, input: { expectedRevision: number; restoreRevision: number }) => {
    meetingContext(e, id)
    return s.restoreTranscriptRevision(id, input)
  })
  handle(C.TRANSCRIBE, async (e, id: string) => {
    const { meeting, context } = meetingContext(e, id)
    await cloud.inspect(meeting.workspaceId, context)
    if (context && !isContextCurrent(meeting.workspaceId!, context)) throw new Error('WORKSPACE_MISMATCH')
    return s.transcribe(id, context)
  })
  handle(C.TRANSCRIBE_CANCEL, (e, id: string) => { meetingContext(e, id); return s.cancelTranscription(id) })
  handle(C.TRANSCRIPT_SEGMENT_UPDATE, (e, id: string, input: LocalTranscriptSegmentUpdate) => { meetingContext(e, id); return s.updateTranscriptSegment(id, input) })
  handle(C.ENGINE, (e) => {
    const workspaceId = windowBindings?.getWorkspaceForWindow(e.sender.id) ?? null
    return cloud.inspect(workspaceId, contextFor(e, workspaceId))
  })
  handle(C.MIC_ACCESS, (e, ask: boolean) => { assertSender(e); return micAccess(!!ask) })

  handle(C.ATTACH, async (e, id: string, paths?: string[]) => {
    const { meeting, context } = meetingContext(e, id)
    let list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : []
    if (list.length === 0) {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const picked = win
        ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
        : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
      if (picked.canceled) {
        if (!isContextCurrent(meeting.workspaceId!, context)) throw new Error('WORKSPACE_MISMATCH')
        return s.read(id)
      }
      list = picked.filePaths
    }
    if (context && !isContextCurrent(meeting.workspaceId!, context)) throw new Error('WORKSPACE_MISMATCH')
    return s.attach(id, list)
  })
  handle(C.OPEN_DOC, async (e, id: string, docId: string) => {
    meetingContext(e, id)
    const path = s.documentPath(id, docId)
    if (!path) return false
    return (await shell.openPath(path)) === ''
  })
  handle(C.REVEAL, (e, id: string, docId?: string) => {
    if (!isMeetingId(id)) return false
    meetingContext(e, id)
    const path = docId ? s.documentPath(id, docId) : (s.audioPath(id) ?? join(s.dir(id), 'meeting.json'))
    if (!path) return false
    shell.showItemInFolder(path)
    return true
  })
  handle(C.REMOVE_DOC, (e, id: string, docId: string) => { meetingContext(e, id); return s.removeDocument(id, docId) })

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
