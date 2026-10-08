/**
 * W1-02 — Live workbench-flag source for the entity handlers.
 *
 * The `entities.links.v1` flag is user-toggleable at runtime (renderer
 * Settings → IPC → main), so the handlers must read it live on every call —
 * never from a registration-time snapshot. `CRAFT_FEATURE_ENTITIES_LINKS`
 * stays as an explicit env override inside `isEntitiesLinksEnabled`.
 *
 * The Electron main process publishes renderer toggles here via
 * `setEntitiesWorkbenchFlags`; standalone/headless servers keep the default
 * empty set (env override only).
 */

let current = new Set<string>()
let source: (() => ReadonlySet<string> | undefined) | null = null

/** Replace the live flag source (tests + Electron main IPC sync). */
export function setEntitiesWorkbenchFlagsSource(next: (() => ReadonlySet<string> | undefined) | null): void {
  source = next
}

/** Publish a concrete enabled-flag set (Electron main mirrors the renderer atom). */
export function setEntitiesWorkbenchFlags(ids: Iterable<string>): void {
  current = new Set(ids)
  source = null
}

/** Reset to the default empty set (tests). */
export function resetEntitiesWorkbenchFlags(): void {
  current = new Set()
  source = null
}

/** Live read of the enabled workbench flag set. */
export function getEntitiesWorkbenchFlags(): ReadonlySet<string> {
  return source?.() ?? current
}
