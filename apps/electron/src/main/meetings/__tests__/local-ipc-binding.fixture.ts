import { strict as assert } from 'node:assert'
import { mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveConfig } from '@rox/shared/config/storage'
import { MEETINGS_LOCAL_IPC as C } from '../../../shared/meetings-local'

const directory = process.env.CRAFT_CONFIG_DIR!
for (const workspaceId of ['workspace-a', 'workspace-b']) mkdirSync(join(directory, workspaceId))
saveConfig({ workspaces: [{ id: 'workspace-a', slug: 'workspace-a', name: 'Synthetic A', rootPath: join(directory, 'workspace-a'), createdAt: 1,
  remoteServer: { url: 'wss://offline.example.test', remoteWorkspaceId: 'different-remote-a', token: 'synthetic-workspace-token' } },
{ id: 'workspace-b', slug: 'workspace-b', name: 'Synthetic B', rootPath: join(directory, 'workspace-b'), createdAt: 1 }],
activeWorkspaceId: 'workspace-a', activeSessionId: null })
const contents = new Map<number, FakeContents>()
const windows: FakeWindow[] = []
const handlers = new Map<string, (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown>()
let nextId = 40
class FakeContents extends EventEmitter {
  id = ++nextId
  destroyed = false
  mainFrame = { url: 'http://127.0.0.1:5175/' }
  constructor() { super(); contents.set(this.id, this) }
  isDestroyed() { return this.destroyed }
  send() {}
  setZoomFactor() {}
  setWindowOpenHandler() {}
  getURL() { return this.mainFrame.url }
}
class FakeWindow extends EventEmitter {
  webContents = new FakeContents()
  destroyed = false
  constructor() { super(); windows.push(this) }
  isDestroyed() { return this.destroyed }
  isFocused() { return false }
  isVisible() { return true }
  setTitle() {}
  loadURL() { return Promise.resolve() }
  loadFile() { return Promise.resolve() }
  destroy() { this.destroyed = true; this.webContents.destroyed = true; this.webContents.emit('destroyed'); this.emit('closed') }
  static getAllWindows() { return windows.filter(window => !window.isDestroyed()) }
  static fromWebContents(value: FakeContents) { return windows.find(window => window.webContents === value) ?? null }
}
const noEngine = { ready: false, engine: 'deepgram', model: 'nova-3', modelPath: null, binary: null, ffmpeg: null,
  missing: ['deepgram-not-configured'], cloudAvailable: false }
let dialogResult = Promise.resolve({ canceled: true, filePaths: [] as string[] })
let connectionCalls = 0
mock.module('electron', () => ({
  BrowserWindow: FakeWindow, shell: { trashItem: async () => {}, openPath: async () => '', showItemInFolder() {} },
  nativeTheme: Object.assign(new EventEmitter(), { shouldUseDarkColors: false }), Menu: { buildFromTemplate: () => ({ popup() {} }) },
  app: { getName: () => 'Synthetic Rox', isPackaged: true, on() {} },
  ipcMain: { handle(channel: string, handler: any) { handlers.set(channel, handler) }, removeHandler(channel: string) { handlers.delete(channel) } },
  session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
  dialog: { showOpenDialog: () => dialogResult }, systemPreferences: {},
  webContents: { fromId: (id: number) => contents.get(id), getAllWebContents: () => [...contents.values()] },
}))
mock.module('../../logger', () => ({ windowLog: { info() {}, warn() {}, error() {}, debug() {} } }))
mock.module('../../extension-host-manager', () => ({ getExtensionHostManager: () => ({ getStatus: () => ({ status: 'running' }) }) }))
mock.module('../../shell-material', () => ({ attachZenWindowPolicy() {}, reapplyZenShellOnWindow() {}, peekZenShellSnapshotForWindow() {},
  nativeAccessibilityPrefersSolid: () => false, setZenShellSnapshotListener() {} }))
mock.module('../local-asr', () => ({ detectEngine: () => noEngine, probeDurationMs: async () => null, remuxAudio: async () => false,
  decodeToWav: async () => ({ code: 1, stderr: '' }), runWhisper: async () => ({ code: 1, stderr: '' }) }))
mock.module('../../handlers/workspace', () => ({ async connectToRemote() { connectionCalls++; return new Promise(() => {}) } }))

const { WindowManager } = await import('../../window-manager')
const { readBoundWindowWorkspace } = await import('../../bootstrap-window-workspace')
const manager = new WindowManager()
const first = manager.createWindow({ workspaceId: 'workspace-a' })
const second = manager.createWindow({ workspaceId: 'workspace-b' })
const firstId = first.webContents.id, secondId = second.webContents.id
const bootstrapEvent = { sender: first.webContents, senderFrame: first.webContents.mainFrame } as unknown as Electron.IpcMainEvent
assert.equal(readBoundWindowWorkspace(bootstrapEvent, manager), 'workspace-a')
assert.equal(readBoundWindowWorkspace({ ...bootstrapEvent, senderFrame: null } as unknown as Electron.IpcMainEvent, manager), '')
manager.updateWindowWorkspace(firstId, 'workspace-b')
assert.equal(readBoundWindowWorkspace(bootstrapEvent, manager), 'workspace-b')
manager.updateWindowWorkspace(firstId, 'workspace-a')
const firstGeneration = manager.getWorkspaceGenerationForWindow(firstId)!
assert.equal(firstGeneration, 3)
manager.updateWindowWorkspace(firstId, 'workspace-a')
assert.equal(manager.getWorkspaceGenerationForWindow(firstId), firstGeneration)
manager.updateWindowWorkspace(firstId, 'workspace-b'); manager.updateWindowWorkspace(firstId, 'workspace-a')
assert.equal(manager.getWorkspaceGenerationForWindow(firstId), firstGeneration + 2)
manager.registerWindow(first, 'workspace-a')
assert.equal(manager.getWorkspaceGenerationForWindow(firstId), firstGeneration + 3)
first.webContents.emit('did-start-navigation', {}, 'http://127.0.0.1:5175/', false, true)
assert.equal(manager.getWorkspaceGenerationForWindow(firstId), firstGeneration + 4)
first.webContents.emit('did-start-navigation', {}, 'https://foreign.example.test', false, false)
first.webContents.emit('did-start-navigation', {}, 'http://127.0.0.1:5175/#same-page', true, true)
assert.equal(manager.getWorkspaceGenerationForWindow(firstId), firstGeneration + 4)
first.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
assert.equal(manager.getWorkspaceGenerationForWindow(firstId), firstGeneration + 5)

const { registerLocalMeetingsIpc } = await import('../local-ipc')
const store = registerLocalMeetingsIpc(undefined, {
  getWorkspaceForWindow: id => manager.getWorkspaceForWindow(id),
  getWorkspaceGenerationForWindow: id => manager.getWorkspaceGenerationForWindow(id),
})
const event = (window = first): Electron.IpcMainInvokeEvent => ({ sender: window.webContents,
  senderFrame: window.webContents.mainFrame } as Electron.IpcMainInvokeEvent)
const invoke = (channel: string, args: unknown[] = [], caller = event()) => Promise.resolve().then(() => handlers.get(channel)!(caller, ...args)) as Promise<any>
const audio = new Uint8Array(44); audio.set([82, 73, 70, 70]); audio.set([87, 65, 86, 69], 8)
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await tick()
  assert(check(), 'State did not settle')
}
async function recording() {
  const started = await invoke(C.REC_START, [{ title: 'Private synthetic recording', workspaceId: 'workspace-a', mimeType: 'audio/wav' }])
  assert(started.ok); await invoke(C.REC_CHUNK, [started.value.id, audio]); return started.value.id as string
}
const deny = async (operation: () => Promise<unknown>) => {
  let denied = false
  try { await operation() } catch { denied = true }
  assert(denied, 'Expected workspace/frame denial')
}

try {
  const id = await recording()
  const stopped = await Promise.race([invoke(C.REC_STOP, [id, { durationMs: 1000 }]), new Promise(resolve => setTimeout(() => resolve('blocked'), 150))])
  assert.notEqual(stopped, 'blocked'); assert(stopped.ok)
  assert.equal(store.read(id)?.status, 'ready'); assert(existsSync(store.audioPath(id)!))
  assert.equal(readFileSync(store.audioPath(id)!).byteLength, 44)
  await until(() => connectionCalls === 1)
  await invoke(C.TRANSCRIBE_CANCEL, [id])
  await deny(() => invoke(C.READ_AUDIO, [id], event(second)))
  await deny(() => invoke(C.GET, [id], event(second)))
  await deny(() => invoke(C.LIST, ['workspace-a'], event(second)))
  const spoofed = { ...event(), senderFrame: { url: 'https://foreign.example.test' } } as Electron.IpcMainInvokeEvent
  await deny(() => invoke(C.READ_AUDIO, [id], spoofed))

  const switched = await recording()
  manager.updateWindowWorkspace(firstId, 'workspace-b')
  const stoppedAfterSwitch = await invoke(C.REC_STOP, [switched, { durationMs: 2000 }])
  assert.deepEqual(stoppedAfterSwitch, { ok: false, code: 'recording-context-changed' })
  assert.equal(store.isRecording(switched), false); assert.equal(store.read(switched)?.status, 'ready')
  assert.equal(store.read(switched)?.durationMs, 2000); assert(existsSync(store.audioPath(switched)!))
  await until(() => store.read(switched)?.transcript.status === 'failed')
  assert.equal(connectionCalls, 1); assert.equal(store.readTranscript(switched), null)
  manager.updateWindowWorkspace(firstId, 'workspace-a')

  const aba = await recording()
  manager.updateWindowWorkspace(firstId, 'workspace-b'); manager.updateWindowWorkspace(firstId, 'workspace-a')
  assert((await invoke(C.REC_STOP, [aba, { durationMs: 1500 }])).ok)
  await until(() => store.read(aba)?.transcript.status === 'failed')
  assert.equal(connectionCalls, 1); assert.equal(store.readTranscript(aba), null)

  const legacy = store.create({ title: 'Synthetic legacy meeting', workspaceId: null })
  assert((await invoke(C.LIST, [null])).some((meeting: { id: string }) => meeting.id === legacy.id))
  assert.equal((await invoke(C.GET, [legacy.id])).workspaceId, 'workspace-a')
  assert.equal(store.read(legacy.id)?.workspaceId, 'workspace-a')
  await deny(() => invoke(C.GET, [legacy.id], event(second)))
  assert(!(await invoke(C.LIST, [null], event(second))).some((meeting: { id: string }) => meeting.id === legacy.id))
  assert.equal((await invoke(C.CREATE, [{ title: 'Nullable client input', workspaceId: null }])).workspaceId, 'workspace-a')

  const attachment = join(directory, 'synthetic-document.txt'); writeFileSync(attachment, 'private synthetic document')
  const picked = Promise.withResolvers<{ canceled: boolean; filePaths: string[] }>(); dialogResult = picked.promise
  const attaching = invoke(C.ATTACH, [legacy.id]).then(value => ({ value }), error => ({ error }))
  await tick(); manager.updateWindowWorkspace(firstId, 'workspace-b'); manager.updateWindowWorkspace(firstId, 'workspace-a')
  picked.resolve({ canceled: false, filePaths: [attachment] })
  assert('error' in await attaching); assert.equal(store.read(legacy.id)?.documents.length, 0)

  const audioPath = join(directory, 'synthetic-import.wav'); writeFileSync(audioPath, audio)
  const importDialog = Promise.withResolvers<{ canceled: boolean; filePaths: string[] }>(); dialogResult = importDialog.promise
  const beforeImport = store.list(null).length
  const importing = invoke(C.IMPORT_AUDIO, [{ requestId: 'native-owned-import', workspaceId: 'workspace-a' }])
  await tick()
  await deny(() => invoke(C.IMPORT_CANCEL, ['native-owned-import'], event(second)))
  assert.equal(await invoke(C.IMPORT_CANCEL, ['native-owned-import']), true)
  importDialog.resolve({ canceled: false, filePaths: [audioPath] })
  assert.deepEqual(await importing, { ok: false, code: 'import-cancelled' })
  assert.equal(store.list(null).length, beforeImport)

  const staleImportDialog = Promise.withResolvers<{ canceled: boolean; filePaths: string[] }>(); dialogResult = staleImportDialog.promise
  const staleImport = invoke(C.IMPORT_AUDIO, [{ requestId: 'native-stale-import', workspaceId: 'workspace-b' }], event(second))
    .then(value => ({ value }), error => ({ error }))
  await tick(); manager.updateWindowWorkspace(secondId, 'workspace-a'); manager.updateWindowWorkspace(secondId, 'workspace-b')
  staleImportDialog.resolve({ canceled: false, filePaths: [audioPath] })
  assert('error' in await staleImport); assert.equal(store.list(null).length, beforeImport)

  ;(second as unknown as FakeWindow).destroy()
  assert.equal(manager.getWorkspaceForWindow(secondId), null)
  assert.equal(manager.getWorkspaceGenerationForWindow(secondId), null)
  console.log('meeting IPC: actual window generations, offline finalization, private audio, legacy binding and stale dialog fences passed')
} finally {
  for (const window of windows) if (!window.destroyed) window.destroy()
}
process.exit(0)
