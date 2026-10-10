/**
 * DISPATCH B10 — macOS system accent colour.
 *
 * `systemPreferences.getAccentColor()` returns the user's system-wide accent as
 * an RGBA hex string (Electron docs: `"aabbccdd"` → r=aa, g=bb, b=cc, a=dd).
 * The renderer converts it to CSS; this module only reads and pushes it.
 *
 * The listener is process-level and idempotent: one
 * `AppleColorPreferencesChangedNotification` subscription drives a broadcast to
 * every window. Off macOS the snapshot is `{ source: 'brand', color: null }` so
 * the renderer falls back to the brand accent.
 */

import { systemPreferences } from 'electron'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { SystemAccentSnapshot } from '@rox/shared/protocol'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'

const ACCENT_NOTIFICATION = 'AppleColorPreferencesChangedNotification'

let accentServer: RpcServer | null = null
let subscriptionId: number | null = null

/** Read the current system accent; never throws. */
export function readSystemAccent(): SystemAccentSnapshot {
  if (process.platform !== 'darwin') return { source: 'brand', color: null }
  try {
    const color = systemPreferences.getAccentColor()
    // Keep the raw RGBA hex for the renderer; reject a missing/empty value.
    if (typeof color === 'string' && /^[0-9a-f]{6,8}$/i.test(color)) {
      return { source: 'system', color }
    }
  } catch {
    // Fall through to the brand snapshot.
  }
  return { source: 'brand', color: null }
}

/** Push the current accent to every client. No-op before the server attaches. */
export function broadcastSystemAccent(): void {
  if (!accentServer) return
  pushTyped(accentServer, RPC_CHANNELS.appearance.ACCENT_CHANGED, { to: 'all' }, readSystemAccent())
}

/**
 * Attach the single macOS accent listener. Safe to call on every boot: the
 * server reference is refreshed, the notification subscription is created once.
 */
export function attachSystemAccentSubscription(server: RpcServer): void {
  accentServer = server
  if (process.platform !== 'darwin' || subscriptionId !== null) return
  try {
    if (typeof systemPreferences.subscribeNotification === 'function') {
      subscriptionId = systemPreferences.subscribeNotification(ACCENT_NOTIFICATION, () => broadcastSystemAccent())
    }
  } catch {
    subscriptionId = null
  }
}

/** Test seam: detach the listener and clear the server reference. */
export function resetSystemAccentSubscription(): void {
  if (subscriptionId !== null && process.platform === 'darwin') {
    try {
      systemPreferences.unsubscribeNotification(subscriptionId)
    } catch {
      // Ignore — the subscription is best-effort.
    }
  }
  subscriptionId = null
  accentServer = null
}