/**
 * Worker task: copy/read/parse a History DB snapshot off the RPC thread.
 */
import { getWorkerPool, registerWorkerHandler } from '../workers/index.ts'
import { readNativeBrowserData } from './profile-native-data.ts'
import type { DiscoveredProfile, IndexedItem } from './profile-import.ts'

type BrowserHistoryReadResult = { history: IndexedItem[]; bookmarks: IndexedItem[] }

declare module '../workers/handlers.ts' {
  interface WorkerTaskMap {
    'browser.readHistory': {
      payload: {
        family: DiscoveredProfile['family']
        path: string
        history: boolean
        bookmarks: boolean
        sinceVisitTime?: number
      }
      result: BrowserHistoryReadResult
    }
  }
}

registerWorkerHandler('browser.readHistory', (payload) => {
  const data = readNativeBrowserData(
    { family: payload.family, path: payload.path },
    { history: payload.history, bookmarks: payload.bookmarks },
    { sinceVisitTime: payload.sinceVisitTime },
  )
  return {
    history: data.history ?? [],
    bookmarks: data.bookmarks ?? [],
  }
})

export async function readBrowserHistoryInPool(payload: {
  family: DiscoveredProfile['family']
  path: string
  history: boolean
  bookmarks: boolean
  sinceVisitTime?: number
}): Promise<BrowserHistoryReadResult> {
  return getWorkerPool().run('browser.readHistory', payload)
}
