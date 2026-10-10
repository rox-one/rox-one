/**
 * Rovers renderer client (W3).
 *
 * The info-only Rovers slice exposes a single read-only board RPC, `rovers:list`
 * (contract §4), which returns every entry of the bundled signed catalog. The
 * channel is owned by the rovers RPC registration; this module is the renderer's
 * typed seam onto it, following the existing `window.electronAPI` invocation
 * pattern (same shape as the ExtensionHostDevApi cast in the settings page).
 *
 * `roversList` is optional in the client type so a build without the RPC
 * registration degrades to a typed error instead of an undefined-call crash.
 */
import type { RoversEntryFull } from '@rox/ui'

/** Result of the `rovers:list` board RPC. */
export interface RoversListResult {
  entries: RoversEntryFull[]
}

/** Renderer-facing RPC slice added by the rovers registration (contract §4). */
interface RoversClientApi {
  roversList?: () => Promise<RoversListResult>
}

export class RoversRpcUnavailableError extends Error {
  constructor() {
    super('rovers:list RPC is unavailable in this build')
    this.name = 'RoversRpcUnavailableError'
  }
}

/** Read the bundled rovers catalog through the read-only RPC. */
export async function listRoversEntries(): Promise<RoversEntryFull[]> {
  // window.electronAPI is typed by the shared ElectronAPI interface; the rovers
  // method is added by the RPC slice, so narrow through the local client type.
  const api = window.electronAPI as unknown as RoversClientApi
  const call = api.roversList
  if (typeof call !== 'function') throw new RoversRpcUnavailableError()
  const result = await call.call(api)
  return Array.isArray(result?.entries) ? result.entries : []
}