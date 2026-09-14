import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEVICE_DIAGNOSTICS_CHANNELS, type DeviceDiagnosticRequest, type DeviceDiagnosticSnapshot, type DeviceDiagnosticLogSource } from '../shared/device-diagnostics'
import type { DeviceDiagnosticCollectorOptions } from './device-diagnostics-collector'

type Sender = { id: number; mainFrame: { url: string } }
type DiagnosticEvent = { sender: Sender; senderFrame: { url: string } | null }
type ManagedWindow = {
  webContents: Sender
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  once(event: 'hide' | 'minimize' | 'closed', callback: () => void): unknown
  removeListener(event: 'hide' | 'minimize' | 'closed', callback: () => void): unknown
}

interface DeviceDiagnosticsIpcDependencies {
  ipcMain: { handle(channel: string, listener: (event: DiagnosticEvent, input: unknown) => Promise<unknown>): void }
  windowManager: { getWindowByWebContentsId(id: number): ManagedWindow | null }
  rendererFilePath: string
  devServerUrl?: string
  getLogPaths(): Partial<Record<DeviceDiagnosticLogSource, string | undefined>>
  collect?(request: DeviceDiagnosticRequest, options: DeviceDiagnosticCollectorOptions): Promise<DeviceDiagnosticSnapshot>
}

function parseRequest(input: unknown): DeviceDiagnosticRequest {
  if (!input || typeof input !== 'object') throw new Error('DEVICE_DIAGNOSTICS_INVALID')
  const value = input as Record<string, unknown>
  if (typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.requestId)
    || !['overview', 'network', 'processes', 'launchAgents', 'logs'].includes(String(value.kind))
    || (value.source !== undefined && !['main', 'messaging', 'updates'].includes(String(value.source)))
    || Object.keys(value).some(key => !['requestId', 'kind', 'source'].includes(key))) {
    throw new Error('DEVICE_DIAGNOSTICS_INVALID')
  }
  return { requestId: value.requestId, kind: value.kind as DeviceDiagnosticRequest['kind'], source: value.source as DeviceDiagnosticRequest['source'] }
}

function isAppUrl(url: string, deps: DeviceDiagnosticsIpcDependencies): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return resolve(fileURLToPath(parsed)) === resolve(deps.rendererFilePath)
    if (!deps.devServerUrl) return false
    const dev = new URL(deps.devServerUrl)
    return parsed.origin === dev.origin && (parsed.pathname === dev.pathname || parsed.pathname === '/index.html')
  } catch { return false }
}

/** Direct IPC, authorized against the managed app window and its main frame. */
export function registerDeviceDiagnosticsIpc(deps: DeviceDiagnosticsIpcDependencies): void {
  const pending = new Map<number, { requestId: string; controller: AbortController }>()
  const authorize = (event: DiagnosticEvent): ManagedWindow => {
    const owner = deps.windowManager.getWindowByWebContentsId(event.sender.id)
    if (!owner || owner.isDestroyed() || owner.webContents !== event.sender
      || !event.senderFrame || event.senderFrame !== event.sender.mainFrame
      || !isAppUrl(event.senderFrame.url, deps)) throw new Error('DEVICE_DIAGNOSTICS_DENIED')
    return owner
  }

  deps.ipcMain.handle(DEVICE_DIAGNOSTICS_CHANNELS.READ, async (event, input) => {
    const owner = authorize(event)
    const request = parseRequest(input)
    if (!owner.isVisible() || owner.isMinimized()) throw new Error('DEVICE_DIAGNOSTICS_HIDDEN')
    pending.get(event.sender.id)?.controller.abort()
    const controller = new AbortController()
    const entry = { requestId: request.requestId, controller }
    pending.set(event.sender.id, entry)
    const abort = () => controller.abort()
    owner.once('hide', abort)
    owner.once('minimize', abort)
    owner.once('closed', abort)
    try {
      // Loading native collection and reading log paths happen only after the
      // user opens diagnostics, behind sender and visibility checks.
      const collect = deps.collect ?? (await import('./device-diagnostics-collector')).collectDeviceDiagnostics
      return await collect(request, { signal: controller.signal, logPaths: request.kind === 'logs' ? deps.getLogPaths() : {} })
    } finally {
      owner.removeListener('hide', abort)
      owner.removeListener('minimize', abort)
      owner.removeListener('closed', abort)
      if (pending.get(event.sender.id) === entry) pending.delete(event.sender.id)
    }
  })

  deps.ipcMain.handle(DEVICE_DIAGNOSTICS_CHANNELS.CANCEL, async (event, input) => {
    authorize(event)
    if (typeof input !== 'string') return
    const entry = pending.get(event.sender.id)
    if (entry?.requestId === input) entry.controller.abort()
  })
}
