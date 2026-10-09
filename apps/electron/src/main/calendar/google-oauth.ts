/**
 * Electron main-process OAuth broker for Google Calendar (wave 1).
 *
 * The Google Calendar connect flow reuses the sources OAuth primitives
 * (`prepareGoogleOAuth`/`exchangeGoogleOAuth`) but performs the two pieces that
 * must run on the user's machine from the main process:
 *  1. bind a loopback callback server to receive the provider redirect,
 *  2. open the consent URL in the user's external browser.
 *
 * The server half of the flow (`calendar:googleConnect`) stays in
 * `@rox/server-core`; the renderer wires the two together through the preload
 * bridge. No token ever crosses this IPC boundary.
 */

import { shell, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { createCallbackServer, type CallbackServer } from '@rox/shared/auth'
import { CALENDAR_OAUTH_IPC } from '../../shared/calendar-oauth'

export interface CalendarOAuthBrokerOptions {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  /** Reject any sender that is not a live Rox window. */
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  /** Opens a URL on the user's machine. Defaults to `shell.openExternal`. */
  openExternal?: (url: string) => Promise<void>
}

const activeCallbacks = new Map<string, CallbackServer>()

/** Register the Calendar OAuth broker channels. Returns a disposer. */
export function registerCalendarGoogleOAuthIpc(options: CalendarOAuthBrokerOptions): () => void {
  const { ipcMain, isTrustedSender } = options
  const openExternal = options.openExternal ?? ((url: string) => shell.openExternal(url))
  const channels = Object.values(CALENDAR_OAUTH_IPC)

  const handle = (
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted calendar OAuth sender')
      return fn(event, ...args)
    })
  }

  handle(CALENDAR_OAUTH_IPC.BEGIN, async () => {
    const handleId = `gcal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const server = await createCallbackServer({ appType: 'electron' })
    activeCallbacks.set(handleId, server)
    // A rejected/aborted callback must not leak the bound port.
    server.promise.catch(() => {}).finally(() => {
      if (activeCallbacks.get(handleId) === server) activeCallbacks.delete(handleId)
    })
    return { handle: handleId, callbackUrl: `${server.url}/callback` }
  })

  handle(CALENDAR_OAUTH_IPC.OPEN, async (_event, url) => {
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('Invalid consent URL')
    await openExternal(url)
    return true
  })

  handle(CALENDAR_OAUTH_IPC.AWAIT, async (_event, handleId) => {
    if (typeof handleId !== 'string') throw new Error('Invalid callback handle')
    const server = activeCallbacks.get(handleId)
    if (!server) throw new Error('Unknown or expired calendar OAuth flow')
    try {
      const payload = await server.promise
      return { query: payload.query }
    } finally {
      activeCallbacks.delete(handleId)
      await server.close()
    }
  })

  handle(CALENDAR_OAUTH_IPC.CANCEL, async (_event, handleId) => {
    if (typeof handleId !== 'string') return false
    const server = activeCallbacks.get(handleId)
    if (!server) return false
    activeCallbacks.delete(handleId)
    await server.close()
    return true
  })

  return () => {
    for (const [handleId, server] of activeCallbacks) {
      activeCallbacks.delete(handleId)
      void server.close()
    }
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}