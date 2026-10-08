import type { ElectronAPI } from '../../../shared/types'
import { roxQueryClient } from './client'
import { startRoxQueryEventBridge } from './event-bridge'
import { idbRoxQueryStorage, readPersistencePrincipal, startRoxQueryPersistence, type RoxQueryStorage } from './persist'

let stopActive: (() => void) | null = null

/**
 * PERF-09 (#1576): start the shared cache's event bridge and its disk
 * persistence once per renderer (main.tsx). The bridge runs in every
 * runtime (desktop and authenticated web share the cache, so both need
 * invalidation, reconnect refetch and the principal checks); only the
 * desktop runtime persists (and only it creates the IndexedDB storage).
 * Restarting (HMR) replaces the previous instance.
 */
export function startRoxQueryRuntime(
  api: (Partial<ElectronAPI> & Pick<ElectronAPI, 'getRuntimeEnvironment'>) | undefined,
  /** Defaults to IndexedDB, created only on desktop (the web runtime never opens it). */
  storage?: RoxQueryStorage | null,
): () => void {
  stopActive?.()
  const client = roxQueryClient()
  const desktop = api?.getRuntimeEnvironment?.() === 'electron'
  const store = !desktop ? null
    : storage !== undefined ? storage
    : typeof indexedDB !== 'undefined' ? idbRoxQueryStorage() : null
  // One principal read opens the first identity epoch for both the bridge and persistence.
  const principal = () => readPersistencePrincipal(api)
  const initialPrincipal = principal()
  const persistence = store ? startRoxQueryPersistence(client, store, { principal, initialPrincipal }) : null
  const stopBridge = startRoxQueryEventBridge(client, api, {
    principal,
    initialPrincipal,
    onIdentityChanged: next => { void persistence?.clear(next) },
    onIdentityConfirmed: next => { persistence?.reopen(next) },
  })
  const stop = () => {
    stopBridge()
    persistence?.stop()
    if (stopActive === stop) stopActive = null
  }
  stopActive = stop
  return stop
}
