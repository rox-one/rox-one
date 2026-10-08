/**
 * Retained embedded-browser helpers (Issue 14).
 * Closing or switching surfaces must hide/reuse a pane, not destroy it.
 */

export const INTERNAL_BROWSER_OPEN_EVENT = 'craft:open-internal-browser'
export const ROX_BROWSER_PROFILE_LABEL = 'Rox'
export const ROX_BROWSER_PARTITION = 'persist:browser-pane'
/**
 * Cookie-isolated partition used when the user opts into imported cookies.
 * Isolation is fixed at creation time, so a retained pane created without this
 * partition can never gain it by navigation — it must be recreated.
 */
export const ROX_BROWSER_COOKIE_IMPORT_PARTITION = 'persist:browser-cookie-import'

export function pickRetainedEmbeddedId(
  instances: Array<{ id: string; embedded?: boolean }>,
): string | null {
  return instances.find((item) => item.embedded)?.id ?? null
}

export function planRetainedBrowserOpen(
  instances: Array<{ id: string; embedded?: boolean }>,
  url?: string,
): { action: 'navigate'; id: string; url?: string } | { action: 'create'; url?: string } {
  const id = pickRetainedEmbeddedId(instances)
  if (id) return { action: 'navigate', id, url }
  return { action: 'create', url }
}
