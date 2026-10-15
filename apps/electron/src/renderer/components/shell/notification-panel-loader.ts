/**
 * Shared dynamic import for the notification panel: used by `React.lazy` in
 * `NotificationCenter.tsx` and by the idle startup preload
 * (`lib/idle-preload.ts`), so both reuse one module promise and the first open
 * of the popover waits for nothing.
 */
let pending: Promise<typeof import('./NotificationPanel')> | null = null

export function loadNotificationPanel(): Promise<typeof import('./NotificationPanel')> {
  pending ??= import('./NotificationPanel').catch((error) => {
    pending = null
    throw error
  })
  return pending
}
