/**
 * W1-07 (#1504) — renderer → main bridge for the unified surface route gate.
 *
 * The renderer owns the workbench flags (localStorage-backed atoms). The main
 * process parses `rox://` deep links with the shared route parser, so it needs
 * the same gate: a mode root (`rox://messenger`, …) is accepted only while
 * that mode's flag is on. Default-closed: until the renderer pushes, every
 * surface root is rejected in main exactly as with all flags off.
 */
import type { IpcMain } from 'electron'
import { isUnifiedSurfaceId, setUnifiedSurfaceRoutesEnabled, type UnifiedSurfaceId } from '../shared/surface-routes'

export const SURFACE_ROUTES_IPC_CHANNEL = 'shell:setSurfaceRoutesEnabled'

/** Validate an untrusted IPC payload and apply it; returns the applied ids. */
export function applyUnifiedSurfaceRoutes(ids: unknown): UnifiedSurfaceId[] {
  const next = Array.isArray(ids) ? ids.filter(isUnifiedSurfaceId) : []
  const unique = [...new Set(next)]
  setUnifiedSurfaceRoutesEnabled(unique)
  return unique
}

export function registerSurfaceRoutesIpc(ipcMain: Pick<IpcMain, 'handle'>): void {
  ipcMain.handle(SURFACE_ROUTES_IPC_CHANNEL, (_event, ids: unknown) => {
    applyUnifiedSurfaceRoutes(ids)
    return { ok: true as const }
  })
}
