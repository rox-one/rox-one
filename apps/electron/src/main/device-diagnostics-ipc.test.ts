import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { registerDeviceDiagnosticsIpc } from './device-diagnostics-ipc'
import { DEVICE_DIAGNOSTICS_CHANNELS } from '../shared/device-diagnostics'

function harness() {
  const frame = { url: 'file:///app/renderer/index.html?workspaceId=local' }
  const sender = { id: 17, mainFrame: frame }
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: (): boolean => false,
    isVisible: (): boolean => true,
    isMinimized: (): boolean => false,
    webContents: sender,
  })
  const handlers = new Map<string, (event: any, input: unknown) => Promise<unknown>>()
  const collected: AbortSignal[] = []
  registerDeviceDiagnosticsIpc({
    ipcMain: { handle: (channel, listener) => { handlers.set(channel, listener) } },
    windowManager: { getWindowByWebContentsId: id => id === 17 ? owner : null },
    rendererFilePath: '/app/renderer/index.html',
    getLogPaths: () => ({}),
    collect: async (request, { signal }) => {
      collected.push(signal)
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      return { kind: request.kind, sampledAt: 1, platform: 'linux', result: { status: 'unavailable', reason: 'cancelled' } }
    },
  })
  return { sender, frame, owner, handlers, collected, event: { sender, senderFrame: frame } }
}

describe('native diagnostics IPC authorization and cancellation', () => {
  it('rejects unmanaged webviews, subframes, sender impersonation and non-app URLs', async () => {
    const h = harness()
    const read = h.handlers.get(DEVICE_DIAGNOSTICS_CHANNELS.READ)!
    const request = { requestId: 'read-1', kind: 'overview' }
    await expect(read({ sender: { id: 22 }, senderFrame: h.frame }, request)).rejects.toThrow('DENIED')
    await expect(read({ sender: h.sender, senderFrame: { url: h.frame.url } }, request)).rejects.toThrow('DENIED')
    await expect(read({ sender: { ...h.sender }, senderFrame: h.frame }, request)).rejects.toThrow('DENIED')
    h.frame.url = 'https://example.com/'
    await expect(read(h.event, request)).rejects.toThrow('DENIED')
    expect(h.collected).toHaveLength(0)
  })

  it('rejects arbitrary commands/paths, malformed requests, and hidden-window reads', async () => {
    const h = harness()
    const read = h.handlers.get(DEVICE_DIAGNOSTICS_CHANNELS.READ)!
    await expect(read(h.event, { requestId: 'x', kind: 'exec', command: 'anything' })).rejects.toThrow('INVALID')
    await expect(read(h.event, { requestId: 'x', kind: 'logs', source: '/etc/passwd' })).rejects.toThrow('INVALID')
    await expect(read(h.event, { requestId: '../bad', kind: 'overview' })).rejects.toThrow('INVALID')
    h.owner.isVisible = () => false
    await expect(read(h.event, { requestId: 'x', kind: 'overview' })).rejects.toThrow('HIDDEN')
    expect(h.collected).toHaveLength(0)
  })

  it('aborts in-flight sampling on close and removes per-request listeners', async () => {
    const h = harness()
    const pending = h.handlers.get(DEVICE_DIAGNOSTICS_CHANNELS.READ)!(h.event, { requestId: 'read-1', kind: 'overview' })
    await Promise.resolve()
    expect(h.collected[0]?.aborted).toBe(false)
    await h.handlers.get(DEVICE_DIAGNOSTICS_CHANNELS.CANCEL)!(h.event, 'read-1')
    await pending
    expect(h.collected[0]?.aborted).toBe(true)
    expect(h.owner.listenerCount('hide')).toBe(0)
    expect(h.owner.listenerCount('minimize')).toBe(0)
    expect(h.owner.listenerCount('closed')).toBe(0)
  })

  it('aborts native collection immediately when the window hides', async () => {
    const h = harness()
    const pending = h.handlers.get(DEVICE_DIAGNOSTICS_CHANNELS.READ)!(h.event, { requestId: 'read-1', kind: 'processes' })
    await Promise.resolve()
    h.owner.emit('hide')
    await pending
    expect(h.collected[0]?.aborted).toBe(true)
  })
})
