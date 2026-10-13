import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { RPC_CHANNELS } from '../../shared/types'
import type { WindowManager } from '../window-manager'

let clickHandler: (() => void) | null = null

mock.module('electron', () => {
  class MockNotification {
    constructor(_opts: unknown) {}
    static isSupported(): boolean { return true }
    on(event: string, cb: () => void): void { if (event === 'click') clickHandler = cb }
    show(): void {}
  }
  return {
    Notification: MockNotification,
    app: { dock: { setIcon: () => {} }, setBadgeCount: () => {} },
    BrowserWindow: { getAllWindows: () => [] },
    nativeImage: { createFromPath: () => ({}), createFromDataURL: () => ({}) },
  }
})

describe('notification deep-link routing', () => {
  beforeEach(() => { clickHandler = null })

  it('dispatches a structured shell:action to the focused window on click', async () => {
    const notifications = await import('../notifications')

    const relayed: Array<{ window: unknown; channel: string; payload: unknown }> = []
    const focused = { isDestroyed: () => false, webContents: { id: 7, isDestroyed: () => false } }
    // Delivery goes through the window-manager relay (`pushToWindow`); the sink
    // and its raw pre-handshake fallback are covered by window-manager-relay.test.ts.
    const manager = {
      getFocusedWindow: () => focused,
      getLastActiveWindow: () => focused,
      pushToWindow: (window: unknown, channel: string, ...args: unknown[]) => {
        relayed.push({ window, channel, payload: args[0] })
      },
    } as unknown as WindowManager

    notifications.initNotificationService(manager)
    notifications.showNotification('Title', 'Body', 'ws-1', 'sess-1', { route: 'inbox' })
    expect(clickHandler).toBeTruthy()
    clickHandler?.()

    expect(relayed).toEqual([{
      window: focused,
      channel: RPC_CHANNELS.shell.ACTION,
      payload: { action: 'navigate', deepLink: { route: 'inbox' } },
    }])
  })
})