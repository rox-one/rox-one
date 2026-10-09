import { describe, expect, it } from 'bun:test'

import { RPC_CHANNELS } from '../../shared/types'
import type { WindowManager } from '../window-manager'
import { dispatchShellAction } from '../shell-actions'

interface FakeWindow {
  webContents: { id: number; isDestroyed: () => boolean; send: (channel: string, payload: unknown) => void }
  sent: Array<{ channel: string; payload: unknown }>
  isDestroyed: () => boolean
}

function createFakeWindow(id: number): FakeWindow {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const window: FakeWindow = {
    sent,
    isDestroyed: () => false,
    webContents: {
      id,
      isDestroyed: () => false,
      send: (channel, payload) => { sent.push({ channel, payload }) },
    },
  }
  return window
}

function createManager(options: {
  focused?: FakeWindow | null
  lastActive?: FakeWindow | null
  sink?: ((channel: string, target: unknown, ...args: unknown[]) => void) | null
  clientId?: string | undefined
}) {
  const manager = {
    getFocusedWindow: () => options.focused ?? null,
    getLastActiveWindow: () => options.lastActive ?? null,
    getRpcEventSink: () => options.sink ?? null,
    getClientIdForWindow: () => options.clientId,
  } as unknown as WindowManager
  return manager
}

describe('dispatchShellAction', () => {
  it('routes through the RPC event sink for the focused window', () => {
    const calls: Array<{ channel: string; target: unknown; payload: unknown }> = []
    const window = createFakeWindow(7)
    const manager = createManager({
      focused: window,
      sink: (channel, target, ...args) => { calls.push({ channel, target, payload: args[0] }) },
      clientId: 'client-7',
    })

    expect(dispatchShellAction(manager, { action: 'new-note' })).toBe(true)
    expect(calls).toEqual([{
      channel: RPC_CHANNELS.shell.ACTION,
      target: { to: 'client', clientId: 'client-7' },
      payload: { action: 'new-note' },
    }])
    expect(window.sent).toEqual([])
  })

  it('falls back to the last-active window and a raw send without a client id', () => {
    const window = createFakeWindow(9)
    const manager = createManager({ focused: null, lastActive: window, sink: () => {} })

    expect(dispatchShellAction(manager, { action: 'open-inbox' })).toBe(true)
    expect(window.sent).toEqual([{ channel: RPC_CHANNELS.shell.ACTION, payload: { action: 'open-inbox' } }])
  })

  it('returns false when there is no target window', () => {
    expect(dispatchShellAction(createManager({}), { action: 'new-task' })).toBe(false)
    expect(dispatchShellAction(null, { action: 'new-task' })).toBe(false)
  })
})