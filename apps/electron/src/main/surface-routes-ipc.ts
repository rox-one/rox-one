/**
 * W1-07 (#1504) — renderer → main bridge for the unified surface route gate.
 *
 * The renderer owns the workbench flags (localStorage-backed atoms). The main
 * process parses `rox://` deep links with the shared route parser, so it needs
 * the same gate: a mode root (`rox://messenger`, …) is accepted only while
 * that mode's flag is on. Default-closed: until the renderer pushes, every
 * surface root is rejected in main exactly as with all flags off.
 *
 * Cold start: a `rox://messenger` that launched the app is processed before
 * the renderer's first push. `whenSurfaceGateReady()` lets the deep-link
 * handler hold such a link until that first push (or a timeout, after which it
 * is dropped and logged) — the same outcome as main once the gate is known.
 */
import type { IpcMain } from 'electron'
import { isUnifiedSurfaceId, setUnifiedSurfaceRoutesEnabled, type UnifiedSurfaceId } from '../shared/surface-routes'

export const SURFACE_ROUTES_IPC_CHANNEL = 'shell:setSurfaceRoutesEnabled'

let gateReceived = false
const gateWaiters = new Set<() => void>()

/** True once the renderer has pushed the gate at least once. */
export function isSurfaceGateReceived(): boolean {
  return gateReceived
}

/**
 * Resolves `true` at the renderer's first gate push (immediately when it has
 * already happened), or `false` after `timeoutMs`.
 */
export function whenSurfaceGateReady(timeoutMs: number): Promise<boolean> {
  if (gateReceived) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (value: boolean) => {
      clearTimeout(timer)
      gateWaiters.delete(onReady)
      resolve(value)
    }
    const onReady = () => done(true)
    const timer = setTimeout(() => done(false), Math.max(0, timeoutMs))
    gateWaiters.add(onReady)
  })
}

/** Validate an untrusted IPC payload and apply it; returns the applied ids. */
export function applyUnifiedSurfaceRoutes(ids: unknown): UnifiedSurfaceId[] {
  const next = Array.isArray(ids) ? ids.filter(isUnifiedSurfaceId) : []
  const unique = [...new Set(next)]
  setUnifiedSurfaceRoutesEnabled(unique)
  if (!gateReceived) {
    gateReceived = true
    for (const notify of [...gateWaiters]) notify()
  }
  return unique
}

/** Test seam: back to the cold-start state (no push received, no waiters). */
export function __resetSurfaceGateForTests(): void {
  gateReceived = false
  gateWaiters.clear()
  setUnifiedSurfaceRoutesEnabled([])
}

export function registerSurfaceRoutesIpc(ipcMain: Pick<IpcMain, 'handle'>): void {
  ipcMain.handle(SURFACE_ROUTES_IPC_CHANNEL, (_event, ids: unknown) => {
    applyUnifiedSurfaceRoutes(ids)
    return { ok: true as const }
  })
}
