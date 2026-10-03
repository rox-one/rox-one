import { describe, expect, it } from 'bun:test'
import { createDeviceDiagnosticsBridge } from './device-diagnostics'
import { DEVICE_DIAGNOSTICS_CHANNELS } from '../shared/device-diagnostics'

describe('device-local diagnostics preload bridge', () => {
  it('projects only fixed diagnostic fields and cancellation through direct IPC', async () => {
    const calls: unknown[][] = []
    const bridge = createDeviceDiagnosticsBridge(async (channel, ...args) => { calls.push([channel, ...args]); return {} })
    expect(Object.isFrozen(bridge)).toBe(true)
    await bridge.read({ requestId: 'request-1', kind: 'logs', source: 'updates', command: 'ignored', path: '/ignored', token: 'ignored' } as any)
    await bridge.cancel('request-1')
    expect(calls).toEqual([
      [DEVICE_DIAGNOSTICS_CHANNELS.READ, { requestId: 'request-1', kind: 'logs', source: 'updates' }],
      [DEVICE_DIAGNOSTICS_CHANNELS.CANCEL, 'request-1'],
    ])
  })
})
