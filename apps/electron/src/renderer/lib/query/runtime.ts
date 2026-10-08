import type { ElectronAPI } from '../../../shared/types'
import { roxQueryClient } from './client'
import { startRoxQueryEventBridge } from './event-bridge'
import { idbRoxQueryStorage, readPersistencePrincipal, startRoxQueryPersistence, type RoxQueryStorage } from './persist'

let stopActive: (() => void) | null = null

/**
 * PERF-09 (#1576): start the shared cache's event bridge and its disk
 * persistence once per renderer (main.tsx). The bridge runs in every
 * runtime (desktop and authenticated web share the cache, so both need
 * invalidation, reconnect refetch and the identity clear); only the desktop
 * runtime persists. Restarting (HMR) replaces the previous instance.
 */
export function startRoxQueryRuntime(
  api: (Partial<ElectronAPI> & Pick<ElectronAPI, 'getRuntimeEnvironment'>) | undefined,
  storage: RoxQueryStorage | null = typeof indexedDB !== 'undefined' ? idbRoxQueryStorage() : null,
): () => void {
  stopActive?.()
  const client = roxQueryClient()
  const desktop = api?.getRuntimeEnvironment?.() === 'electron'
  const persistence = desktop && storage ? startRoxQueryPersistence(client, storage, { principal: () => readPersistencePrincipal(api) }) : null
  const stopBridge = startRoxQueryEventBridge(client, api, {
    onIdentityChanged: () => { void persistence?.clear() },
  })
  const stop = () => {
    stopBridge()
    persistence?.stop()
    if (stopActive === stop) stopActive = null
  }
  stopActive = stop
  return stop
}
