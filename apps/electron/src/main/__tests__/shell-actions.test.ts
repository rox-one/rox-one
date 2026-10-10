import { describe, expect, it } from 'bun:test'

import { RPC_CHANNELS } from '../../shared/types'
import type { WindowManager } from '../window-manager'
import { dispatchShellAction } from '../shell-actions'

interface FakeWindow {
  webContents: { id: number; isDestroyed: () => boolean }
  isDestroyed: () => boolean
}

function createFakeWindow(id: number, destroyed = false): FakeWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: {
      id,
      isDestroyed: () => destroyed,
    },
  }
}

/** Records each relay call so the test can assert window selection and passthrough. */
function createManager(options: {
  focused?: FakeWindow | null
  lastActive?: FakeWindow | null
}) {
  const pushed: Array<{ window: FakeWindow; channel: string; args: unknown[] }> = []
  const manager = {
    getFocusedWindow: () => options.focused ?? null,
    getLastActiveWindow: () => options.lastActive ?? null,
    pushToWindow: (window: FakeWindow, channel: string, ...args: unknown[]) => {
      pushed.push({ window, channel, args })
    },
    pushed,
  }
  return manager as unknown as WindowManager & typeof manager
}

describe('dispatchShellAction', () => {
  it('routes through the window-manager relay for the focused window', () => {
    const focused = createFakeWindow(7)
    const manager = createManager({ focused })

    expect(dispatchShellAction(manager, { action: 'new-note' })).toBe(true)
    expect(manager.pushed).toEqual([{
      window: focused,
      channel: RPC_CHANNELS.shell.ACTION,
      args: [{ action: 'new-note' }],
    }])
  })

  it('passes the action payload through the relay unchanged', () => {
    const focused = createFakeWindow(3)
    const manager = createManager({ focused })
    const payload = { action: 'navigate' as const, deepLink: { view: 'inbox' } as never }

    expect(dispatchShellAction(manager, payload)).toBe(true)
    expect(manager.pushed).toEqual([{
      window: focused,
      channel: RPC_CHANNELS.shell.ACTION,
      args: [payload],
    }])
  })

  it('falls back to the last-active window when nothing is focused', () => {
    const lastActive = createFakeWindow(9)
    const manager = createManager({ focused: null, lastActive })

    expect(dispatchShellAction(manager, { action: 'open-inbox' })).toBe(true)
    expect(manager.pushed).toEqual([{
      window: lastActive,
      channel: RPC_CHANNELS.shell.ACTION,
      args: [{ action: 'open-inbox' }],
    }])
  })

  it('returns false when there is no target window', () => {
    expect(dispatchShellAction(createManager({}), { action: 'new-task' })).toBe(false)
    expect(dispatchShellAction(null, { action: 'new-task' })).toBe(false)
  })

  it('returns false and does not relay for a destroyed target window', () => {
    const manager = createManager({ focused: createFakeWindow(11, true) })

    expect(dispatchShellAction(manager, { action: 'new-task' })).toBe(false)
    expect(manager.pushed).toEqual([])
  })
})