/**
 * Tests for WindowManager.pushToWindow — the sanctioned main→renderer delivery
 * relay.
 *
 * The typed RPC event sink is preferred when a client id is known for the
 * window; otherwise the raw `webContents.send` fallback is used (the path
 * allowlisted by `scripts/check-raw-sends.sh`). A destroyed window is never
 * sent to. `electron` is mocked for module import the same way as sibling
 * main-process tests (`electron-mock-exports`).
 */

import { describe, expect, it, mock } from 'bun:test'

import { electronMockExports } from './electron-mock-exports'

mock.module('electron', () => ({ ...electronMockExports }))

mock.module('../logger', () => {
  const stubLog = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }
  return {
    mainLog: stubLog,
    sessionLog: stubLog,
    handlerLog: stubLog,
    windowLog: stubLog,
    agentLog: stubLog,
    searchLog: stubLog,
    isDebugMode: false,
    getLogFilePath: () => '/tmp/main.log',
  }
})

// Static imports would evaluate `window-manager` (and its `electron` import)
// before the mocks above register; sibling tests load the module under test
// with `await import` after mocking for exactly this reason.
const { WindowManager } = await import('../window-manager')
const { RPC_CHANNELS } = await import('../../shared/types')

function createWindow(id: number, destroyed = false) {
  const sent: Array<unknown[]> = []
  const window = {
    webContents: {
      id,
      mainFrame: {},
      isDestroyed: () => destroyed,
      send: mock((...args: unknown[]) => { sent.push(args) }),
    },
    isDestroyed: () => destroyed,
    sent,
  }
  return window
}

describe('WindowManager.pushToWindow', () => {
  it('delivers through the RPC event sink for the resolved client and never raw-sends', () => {
    const manager = new WindowManager()
    const calls: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    manager.setRpcEventSink(
      (channel, target, ...args) => { calls.push({ channel, target, args }) },
      (wcId) => (wcId === 7 ? 'client-7' : undefined),
    )

    const window = createWindow(7)
    manager.pushToWindow(window as never, RPC_CHANNELS.shell.ACTION, { action: 'new-note' })

    expect(calls).toEqual([{
      channel: RPC_CHANNELS.shell.ACTION,
      target: { to: 'client', clientId: 'client-7' },
      args: [{ action: 'new-note' }],
    }])
    expect(window.sent).toEqual([])
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('falls back to a raw webContents.send when no client id is known', () => {
    const manager = new WindowManager()
    const calls: unknown[][] = []
    manager.setRpcEventSink(
      (...args) => { calls.push(args) },
      () => undefined,
    )

    const window = createWindow(9)
    manager.pushToWindow(window as never, RPC_CHANNELS.shell.ACTION, { action: 'open-inbox' })

    expect(calls).toEqual([])
    expect(window.sent).toEqual([[RPC_CHANNELS.shell.ACTION, { action: 'open-inbox' }]])
  })

  it('falls back to a raw send when no event sink has been installed', () => {
    const manager = new WindowManager()

    const window = createWindow(11)
    manager.pushToWindow(window as never, RPC_CHANNELS.shell.ACTION, { action: 'new-task' })

    expect(window.sent).toEqual([[RPC_CHANNELS.shell.ACTION, { action: 'new-task' }]])
  })

  it('sends nothing to a destroyed window', () => {
    const manager = new WindowManager()

    const window = createWindow(13, true)
    manager.pushToWindow(window as never, RPC_CHANNELS.shell.ACTION, { action: 'new-task' })

    expect(window.sent).toEqual([])
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})