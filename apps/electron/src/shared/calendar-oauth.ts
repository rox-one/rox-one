/**
 * Calendar OAuth broker IPC contract (Google, wave 1).
 *
 * Shared between the Electron main-process broker
 * (`main/calendar/google-oauth.ts`) and the preload orchestration that wires it
 * to the `calendar:googleConnect` RPC channel.
 */

export const CALENDAR_OAUTH_IPC = {
  /** Bind a loopback callback server; resolves `{ handle, callbackUrl }`. */
  BEGIN: 'calendarOAuth:begin',
  /** Open the prepared consent URL in the user's external browser. */
  OPEN: 'calendarOAuth:open',
  /** Await the provider redirect; resolves `{ query }` and closes the server. */
  AWAIT: 'calendarOAuth:await',
  /** Abort a pending flow (closes the callback server). */
  CANCEL: 'calendarOAuth:cancel',
} as const

export interface CalendarOAuthSession {
  handle: string
  callbackUrl: string
}

export interface CalendarOAuthCallback {
  query: Record<string, string>
}