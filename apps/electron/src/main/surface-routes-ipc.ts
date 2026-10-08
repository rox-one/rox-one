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
 *
 * Latch: the first wait that times out latches the gate for the rest of the
 * process. From then on nothing waits — every pending waiter resolves `false`
 * at once and later mode-root links are parsed against the current gate
 * immediately (fail fast instead of 10 s each). A late renderer push still
 * applies the flags, but never re-closes the latch, re-arms the hold or
 * re-queues links that were already dropped.
 */
import type { IpcMain } from 'electron'
import { isUnifiedSurfaceId, setUnifiedSurfaceRoutesEnabled, type UnifiedSurfaceId } from '../shared/surface-routes'

export const SURFACE_ROUTES_IPC_CHANNEL = 'shell:setSurfaceRoutesEnabled'

let gateReceived = false
/** Set by the first timed-out wait; sticky for the rest of the process. */
let gateLatched = false
const gateWaiters = new Set<(value: boolean) => void>()

/** True once the renderer has pushed the gate at least once. */
export function isSurfaceGateReceived(): boolean {
  return gateReceived
}

/** True once a wait for the first push timed out (sticky, see the latch note above). */
export function isSurfaceGateLatched(): boolean {
  return gateLatched
}

/** True when nothing should wait any more: the gate was pushed or the wait latched. */
export function isSurfaceGateSettled(): boolean {
  return gateReceived || gateLatched
}

function latchGate(): void {
  if (gateLatched) return
  gateLatched = true
  for (const settle of [...gateWaiters]) settle(false)
}

/**
 * Resolves `true` at the renderer's first gate push (immediately when it has
 * already happened), or `false` after `timeoutMs`. A timeout latches the gate:
 * every other pending waiter resolves `false` too, and later calls resolve
 * `false` at once unless the push had already arrived.
 */
export function whenSurfaceGateReady(timeoutMs: number): Promise<boolean> {
  if (gateReceived) return Promise.resolve(true)
  if (gateLatched) return Promise.resolve(false)
  return new Promise((resolve) => {
    const settle = (value: boolean) => {
      clearTimeout(timer)
      gateWaiters.delete(settle)
      resolve(value)
    }
    const timer = setTimeout(() => {
      settle(false)
      latchGate()
    }, Math.max(0, timeoutMs))
    gateWaiters.add(settle)
  })
}

/** Validate an untrusted IPC payload and apply it; returns the applied ids. */
export function applyUnifiedSurfaceRoutes(ids: unknown): UnifiedSurfaceId[] {
  const next = Array.isArray(ids) ? ids.filter(isUnifiedSurfaceId) : []
  const unique = [...new Set(next)]
  setUnifiedSurfaceRoutesEnabled(unique)
  if (!gateReceived) {
    gateReceived = true
    // After a latch there are no waiters left (all resolved false), so a
    // late push re-queues nothing.
    for (const settle of [...gateWaiters]) settle(true)
  }
  return unique
}

/** Test seam: back to the cold-start state (no push received, no latch, no waiters). */
export function __resetSurfaceGateForTests(): void {
  gateReceived = false
  gateLatched = false
  for (const settle of [...gateWaiters]) settle(false)
  gateWaiters.clear()
  setUnifiedSurfaceRoutesEnabled([])
}

export function registerSurfaceRoutesIpc(ipcMain: Pick<IpcMain, 'handle'>): void {
  ipcMain.handle(SURFACE_ROUTES_IPC_CHANNEL, (_event, ids: unknown) => {
    applyUnifiedSurfaceRoutes(ids)
    return { ok: true as const }
  })
}
