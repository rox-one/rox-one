import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME_FETCH_CHANNELS, parseHomeFetchRequest, parseHomeSearchRequest } from '../../shared/home-fetch'
import type { HomeFetchService } from './service'
import { listDockerContainers, readSystemStats } from './local'

type Sender = { id: number; mainFrame: { url: string } }
type FetchEvent = { sender: Sender; senderFrame: { url: string } | null }

export interface HomeFetchIpcDeps {
  ipcMain: { handle(channel: string, listener: (event: FetchEvent, input: unknown) => Promise<unknown>): void }
  windowManager: { getWindowByWebContentsId(id: number): { webContents: Sender; isDestroyed(): boolean } | null }
  rendererFilePath: string
  devServerUrl?: string
  service: HomeFetchService
}

function isAppUrl(url: string, deps: HomeFetchIpcDeps): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return resolve(fileURLToPath(parsed)) === resolve(deps.rendererFilePath)
    if (!deps.devServerUrl) return false
    const dev = new URL(deps.devServerUrl)
    return parsed.origin === dev.origin && (parsed.pathname === dev.pathname || parsed.pathname === '/index.html')
  } catch {
    return false
  }
}

/** Only the managed app window's main frame may use the Home fetch bridge (never iframes or remote pages). */
export function registerHomeFetchIpc(deps: HomeFetchIpcDeps): void {
  const authorize = (event: FetchEvent) => {
    const owner = deps.windowManager.getWindowByWebContentsId(event.sender.id)
    if (!owner || owner.isDestroyed() || owner.webContents !== event.sender || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isAppUrl(event.senderFrame.url, deps)) {
      throw new Error('HOME_FETCH_DENIED')
    }
  }
  deps.ipcMain.handle(HOME_FETCH_CHANNELS.FETCH, async (event, input) => {
    authorize(event)
    const request = parseHomeFetchRequest(input)
    if (!request) return { status: 'error', reason: 'invalid' }
    return deps.service.fetch(request)
  })
  deps.ipcMain.handle(HOME_FETCH_CHANNELS.SEARCH, async (event, input) => {
    authorize(event)
    const request = parseHomeSearchRequest(input)
    if (!request) return { status: 'error', reason: 'invalid' }
    return deps.service.search(request)
  })
  deps.ipcMain.handle(HOME_FETCH_CHANNELS.STATUS, async (event) => {
    authorize(event)
    return deps.service.status()
  })
  deps.ipcMain.handle(HOME_FETCH_CHANNELS.SYSTEM, async (event) => {
    authorize(event)
    return readSystemStats()
  })
  deps.ipcMain.handle(HOME_FETCH_CHANNELS.DOCKER, async (event) => {
    authorize(event)
    return listDockerContainers()
  })
}
