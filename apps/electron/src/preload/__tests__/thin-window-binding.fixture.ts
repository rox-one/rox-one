import { strict as assert } from 'node:assert'
import { mock } from 'bun:test'
import type { ElectronAPI } from '../../shared/types'

// Each child imports the complete production preload once. Network and
// Electron boundaries are mocked; API construction and the override are real.
const scenario = process.argv[2]
assert(['remote-env', 'native-bound', 'native-unbound'].includes(scenario!))
let boundWorkspace: unknown = scenario === 'native-unbound' ? null : 'native-workspace-a'
let bindingError: Error | null = null
let exposedApi: ElectronAPI | undefined
const exposedNames: string[] = []
const syncCalls: Array<{ channel: string; args: unknown[] }> = []
const remoteCalls: Array<{ channel: string; args: unknown[] }> = []
const clients: FakeWsClient[] = []

class FakeWsClient {
  connected = false

  constructor(readonly url: string, readonly options: { workspaceId?: string; mode: string; token?: string }) {
    clients.push(this)
  }

  connect() { this.connected = true }
  handleCapability() {}
  isChannelAvailable() { return true }
  onConnectionStateChanged() { return () => {} }
  getConnectionState() {
    return { status: 'connected', mode: 'remote', url: this.url, attempt: 1, updatedAt: 1 }
  }
  reconnectNow() {}
  on() { return () => {} }
  async invoke(channel: string, ...args: unknown[]) {
    remoteCalls.push({ channel, args })
    if (channel === 'sessions:get') return []
    throw new Error(`Remote desktop-window RPC is unavailable: ${channel}`)
  }
}

mock.module('@sentry/electron/preload', () => ({}))
mock.module('electron', () => ({
  contextBridge: {
    exposeInMainWorld(name: string, value: ElectronAPI) {
      exposedNames.push(name)
      if (name === 'electronAPI') exposedApi = value
    },
  },
  ipcRenderer: {
    sendSync(channel: string, ...args: unknown[]) {
      syncCalls.push({ channel, args })
      if (channel === '__get-web-contents-id') return 42
      if (channel === '__get-workspace-id') {
        if (bindingError) throw bindingError
        return boundWorkspace
      }
      throw new Error(`Unexpected synchronous IPC: ${channel}`)
    },
    on() {},
    removeListener() {},
    send() {},
    async invoke() { throw new Error('Window binding must use synchronous native IPC') },
  },
  shell: { async openExternal() {}, async openPath() { return '' }, showItemInFolder() {} },
  webUtils: { getPathForFile() { return '' } },
}))
mock.module('../../transport/client', () => ({ WsRpcClient: FakeWsClient }))
mock.module('../../shared/remote-tls-client-options.ts', () => ({ peerTrustOptionsForRemote: () => ({}) }))
mock.module('@craft-agent/shared/auth/callback-server', () => ({
  async createCallbackServer() { throw new Error('No OAuth callback server expected') },
}))
mock.module('@craft-agent/server-core/transport', () => ({
  CLIENT_OPEN_EXTERNAL: 'test:external',
  CLIENT_OPEN_PATH: 'test:open-path',
  CLIENT_SHOW_IN_FOLDER: 'test:show-in-folder',
  CLIENT_CONFIRM_DIALOG: 'test:confirm-dialog',
  CLIENT_OPEN_FILE_DIALOG: 'test:open-file-dialog',
  CLIENT_BROWSER_INVOKE: 'test:browser-invoke',
  LOCAL_CLIENT_CAPABILITIES: [],
}))

await import('../bootstrap')
assert(exposedApi, 'Production preload must expose its actual electronAPI')
const api = exposedApi
assert.deepEqual(exposedNames, ['electronAPI'])
assert.equal(clients.length, 1, 'Thin clients must not create a local transport')
assert.equal(clients[0]!.connected, true)
assert.equal(clients[0]!.options.mode, 'remote')
assert.equal(clients[0]!.url, process.env.CRAFT_SERVER_URL)
assert.equal(clients[0]!.options.workspaceId, scenario === 'remote-env'
  ? 'remote-env-workspace'
  : scenario === 'native-bound' ? 'native-workspace-a' : undefined)

// Prove the actual channel-map API is connected to the poisoned remote
// transport. Only window ownership must bypass that transport.
assert.deepEqual(await api.getSessions(), [])
assert.deepEqual(remoteCalls, [{ channel: 'sessions:get', args: [] }])
remoteCalls.length = 0

async function checkNativeOwnership(value: unknown, expected: string | null, args: unknown[] = []) {
  boundWorkspace = value
  const before = syncCalls.length
  const result = Reflect.apply(api.getWindowWorkspace, null, args)
  assert(result instanceof Promise, 'Keep the renderer API asynchronous')
  assert.equal(await result, expected)
  assert.deepEqual(syncCalls.slice(before), [{ channel: '__get-workspace-id', args: [] }],
    'Every call must query main-process window ownership without renderer-supplied arguments')
  assert.deepEqual(remoteCalls, [], 'Never invoke remote window:getWorkspace RPC')
}

// The environment configures the remote handshake only. It is never the
// authority for current local-window ownership, even at initial startup.
await checkNativeOwnership(boundWorkspace, scenario === 'native-unbound' ? null : 'native-workspace-a')
await checkNativeOwnership('native-workspace-b', 'native-workspace-b')
await checkNativeOwnership('native-workspace-a', 'native-workspace-a')
await checkNativeOwnership('native-workspace-b', 'native-workspace-b', ['spoofed-workspace', { workspaceId: 'remote-env-workspace' }])

for (const value of [null, undefined, '', 0, 1, false, true, {}, []]) {
  await checkNativeOwnership(value, null)
}

// A destroyed/unregistered window cannot retain a previous workspace.
await checkNativeOwnership('native-workspace-a', 'native-workspace-a')
await checkNativeOwnership(undefined, null)
await checkNativeOwnership('native-workspace-b', 'native-workspace-b')
await checkNativeOwnership(null, null)

// Main-process IPC failure must reject; no stale environment or remote
// fallback is allowed to conceal loss of native window authority.
bindingError = new Error('Synthetic destroyed native renderer')
const beforeError = syncCalls.length
await assert.rejects(api.getWindowWorkspace(), /Synthetic destroyed native renderer/)
assert.deepEqual(syncCalls.slice(beforeError), [{ channel: '__get-workspace-id', args: [] }])
assert.deepEqual(remoteCalls, [])
bindingError = null
await checkNativeOwnership('native-workspace-a', 'native-workspace-a')

console.log(`thin preload ${scenario}: live native ownership, invalid and destroyed bindings, ignored arguments and IPC errors passed`)
