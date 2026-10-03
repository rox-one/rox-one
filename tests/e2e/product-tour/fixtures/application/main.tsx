/** TEST ONLY. Production App, domain pages, transport, native replica bridge; synthetic shell bootstrap. */
import '../../../../../apps/webui/src/browser-globals'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { setupI18n } from '../../../../../packages/shared/src/i18n'
import { initReactI18next } from 'react-i18next'
import { WsRpcClient } from '../../../../../apps/electron/src/transport/client'
import { buildClientApi } from '../../../../../apps/electron/src/transport/build-api'
import { CHANNEL_MAP } from '../../../../../apps/electron/src/transport/channel-map'
import { createNativeReplicaBridge } from '../../../../../apps/electron/src/preload/native-replica'
import { ThemeProvider } from '../../../../../apps/electron/src/renderer/context/ThemeContext'
import { Toaster } from '../../../../../apps/electron/src/renderer/components/ui/sonner'
import '../../../../../apps/electron/src/renderer/index.css'

async function initializeOwnedApplication() {
const setup = await fetch('/__fixture/bootstrap').then(response => response.json())
if (setup.marker !== 'rox-product-tour-application-test-only') throw new Error('Wrong application harness on loopback port')
setupI18n([initReactI18next]).changeLanguage('en')
const restricted = new URLSearchParams(location.search).get('mode') === 'web'
const client = new WsRpcClient(setup.serverUrl, { token: setup.token, workspaceId: setup.workspaceId, autoReconnect: false, mode: restricted ? 'remote' : 'local', ...(restricted ? {} : { localClientProof: setup.proof, webContentsId: 101 }) })
client.connect()
await new Promise<void>((done, fail) => {
  const timer = setTimeout(() => fail(new Error('Harness transport handshake timed out')), 12_000)
  const off = client.onConnectionStateChanged(state => {
    if (state.status === 'connected') { clearTimeout(timer); queueMicrotask(() => off()); done() }
    else if (state.status === 'failed') { clearTimeout(timer); fail(new Error(state.lastError?.message)) }
  })
})
const bridge = createNativeReplicaBridge({ client, invokeIpc: async (channel, input) => {
  const reply = await fetch('/__fixture/ipc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, input }) }).then(response => response.json())
  if (reply.error) throw new Error(reply.error)
  return reply.value
} })
const api = buildClientApi(client, CHANNEL_MAP, channel => client.isChannelAvailable(channel))
Object.assign(api, {
  getRuntimeEnvironment: () => restricted ? 'web' : 'electron',
  getPlatform: () => 'linux', getVersions: () => ({ electron: 'application-test-adapter', node: 'browser', chrome: navigator.userAgent }),
  getWindowWorkspace: async () => setup.workspaceId, getSystemTheme: async () => false,
  isDebugMode: async () => false, getSystemWarnings: async () => ({ vcredistMissing: false }),
  getTransportConnectionState: async () => client.getConnectionState(), onTransportConnectionStateChanged: client.onConnectionStateChanged.bind(client),
  getWindowMode: async () => 'main', getIsFullScreen: async () => false, getWindowFocusState: async () => true,
  changeLanguage: async () => {}, setMenuBarVisible: async () => {}, setWindowBackgroundColor: async () => {},
  onSystemThemeChange: () => () => {}, onWindowFocus: () => () => {}, onWindowBlur: () => () => {}, onFullscreenChanged: () => () => {}, onWindowCloseRequested: () => () => {},
  nativeReplica: bridge.nativeReplica, nativeData: { readEntity: bridge.readEntity, mutate: bridge.mutate }, readNote: bridge.readNote, createNote: bridge.createNote,
})
window.electronAPI = api
;(window as any).__productTourApplication = { marker: setup.marker, client, api, restricted, workspaceId: setup.workspaceId }
const { default: App } = await import('../../../../../apps/electron/src/renderer/App').catch(error => {
  ;(window as any).__productTourApplicationImportError = String(error)
  throw error
})
function HarnessRoot() {
  return <Provider><ThemeProvider activeWorkspaceId={setup.workspaceId}><App {...(restricted ? { webTransportBootstrap: { kind: 'authenticated-web-transport' as const, workspaceId: setup.workspaceId } } : {})} /><Toaster /></ThemeProvider></Provider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><HarnessRoot /></React.StrictMode>)

}
void initializeOwnedApplication().catch(error => {
  ;(window as any).__productTourApplicationImportError = String(error)
  console.error('Owned application acceptance bootstrap failed:', error)
})
