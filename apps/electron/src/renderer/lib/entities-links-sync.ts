/**
 * Push the renderer's `entities.links.v1` atom into the shared route parser
 * and over IPC into the main-process deep-link parser, so main and renderer
 * always agree. `CRAFT_FEATURE_ENTITIES_LINKS` stays as the env override
 * inside `isEntitiesLinksEnabled`.
 */
import { useEffect } from 'react'
import { setEntityRoutesEnabled } from '../../shared/route-parser'

export function pushEntitiesLinksFlag(enabled: boolean): void {
  setEntityRoutesEnabled(enabled)
  try {
    void window.electronAPI?.setEntitiesLinksEnabled?.(enabled)?.catch(() => {})
  } catch {
    // Tests / non-electron hosts have no bridge — the in-process parser is set.
  }
}

/** Keep the route parser (and main, over IPC) in sync with the atom. */
export function useEntitiesLinksFlagSync(enabled: boolean): void {
  useEffect(() => {
    pushEntitiesLinksFlag(enabled)
  }, [enabled])
}
