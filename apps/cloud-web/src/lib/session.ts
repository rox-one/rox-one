/**
 * Browser session state.
 *
 * Both keys live in `sessionStorage`, so they die with the tab: the customer
 * key is never written to the address bar, a cookie, localStorage or a log,
 * and a staff key is never shared with the customer surface.
 */

export const SESSION_KEYS = {
  client: 'rox_cloud_key',
  admin: 'rox_admin_key',
  staff: 'rox_admin_staff',
} as const

function read(name: string): string {
  try {
    return sessionStorage.getItem(name) ?? ''
  } catch {
    return ''
  }
}

function write(name: string, value: string): void {
  try {
    if (value.length === 0) sessionStorage.removeItem(name)
    else sessionStorage.setItem(name, value)
  } catch {
    /* private mode: the session simply is not remembered */
  }
}

function clear(name: string): void {
  try {
    sessionStorage.removeItem(name)
  } catch {
    /* nothing to remove */
  }
}

export function getClientKey(): string {
  return read(SESSION_KEYS.client)
}

export function setClientKey(key: string): void {
  write(SESSION_KEYS.client, key.trim())
}

export function clearClientKey(): void {
  clear(SESSION_KEYS.client)
}

export function getAdminKey(): string {
  return read(SESSION_KEYS.admin)
}

export function setAdminKey(key: string): void {
  write(SESSION_KEYS.admin, key.trim())
}

export function clearAdminKey(): void {
  clear(SESSION_KEYS.admin)
}

/** The name a staff member signs actions with in the panel. */
export function getStaffName(): string {
  return read(SESSION_KEYS.staff)
}

export function setStaffName(name: string): void {
  write(SESSION_KEYS.staff, name.trim())
}

export function clearStaffName(): void {
  clear(SESSION_KEYS.staff)
}

/** Forget everything this tab held: used by «Выйти» on both surfaces. */
export function clearSession(): void {
  clearClientKey()
  clearAdminKey()
  clearStaffName()
}

/** The API and the application share one origin; the client never guesses one. */
export function apiBaseUrl(): string {
  return location.origin
}

/** Absolute same-origin URL for a path that starts with `/`. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
}
