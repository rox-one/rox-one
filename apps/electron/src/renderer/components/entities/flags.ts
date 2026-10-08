/**
 * W1-08 (#1505) — renderer gating for the entity UI.
 *
 * `entities.previews.v1` (default OFF) turns on hover cards, mention chips in
 * Notes and the "Referenced in" panel in Tasks. It only takes effect when
 * `entities.links.v1` is on as well, using the shared dependency resolver
 * from `@rox/core/platform` (no second flag system).
 *
 * Owner decision (fix8): previews follow #1499's EFFECTIVE links state
 * (`useEntitiesLinksEffectiveState`: env `CRAFT_FEATURE_ENTITIES_LINKS` >
 * saved toggle), not the saved toggle. With links forced off by the env,
 * previews and chips behave exactly as with links off: no entity calls and
 * no 'unavailable' chips. With links forced on, the saved previews toggle
 * decides.
 *
 * `entities.links.v1` is #1499's renderer atom; `entities.previews.v1` lives
 * next to it in localStorage (`craft-` prefix). Both default to false, so
 * every entity surface is inert out of the box.
 */
import { useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { WORKBENCH_FLAG, isWorkbenchFlagEnabled } from '@rox/core/platform'
import { KEYS, getKeyString } from '../../lib/local-storage'
import { featureEntitiesLinksV1Atom } from '../../atoms/entities-links'
import { getEntitiesLinksEffectiveState, useEntitiesLinksEffectiveState } from '../../lib/entities-links-sync'

/** localStorage key of #1499's `entities.links.v1` atom (`craft-feature-entities-links-v1`). */
export const ENTITIES_LINKS_STORAGE_KEY = getKeyString(KEYS.featureEntitiesLinksV1)
export const ENTITIES_PREVIEWS_STORAGE_KEY = getKeyString(KEYS.featureEntitiesPreviewsV1)

/**
 * Saved (requested) state of `entities.links.v1`: #1499's renderer atom (the
 * one the Settings toggle writes and `useEntitiesLinksFlagSync` pushes to
 * main). Entity UI does NOT gate on it directly — it gates on the effective
 * state main returns for it (see `useEntityUiFlags`).
 */
export const entitiesLinksRequestedAtom = featureEntitiesLinksV1Atom

/** Requested state of `entities.previews.v1`. Default OFF. */
export const entitiesPreviewsRequestedAtom = atomWithStorage<boolean>(
  ENTITIES_PREVIEWS_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true },
)

export interface EntityUiFlags {
  links: boolean
  previews: boolean
}

/** Resolve the effective flags (previews requires links). Pure. */
export function resolveEntityUiFlags(requested: { links?: boolean; previews?: boolean }): EntityUiFlags {
  const set = new Set<string>()
  if (requested.links === true) set.add(WORKBENCH_FLAG.entitiesLinksV1)
  if (requested.previews === true) set.add(WORKBENCH_FLAG.entitiesPreviewsV1)
  return {
    links: isWorkbenchFlagEnabled(WORKBENCH_FLAG.entitiesLinksV1, set),
    previews: isWorkbenchFlagEnabled(WORKBENCH_FLAG.entitiesPreviewsV1, set),
  }
}

/**
 * Effective entity UI flags right now, outside React: links = #1499's
 * effective state (env override included), previews = saved previews toggle
 * gated on it.
 */
export function getEntityUiFlags(previewsRequested: boolean): EntityUiFlags {
  return resolveEntityUiFlags({ links: getEntitiesLinksEffectiveState().enabled, previews: previewsRequested })
}

/** Effective entity UI flags; re-renders on effective-links and previews-toggle changes. */
export function useEntityUiFlags(): EntityUiFlags {
  const links = useEntitiesLinksEffectiveState().enabled
  const previews = useAtomValue(entitiesPreviewsRequestedAtom)
  return resolveEntityUiFlags({ links, previews })
}

/** True only while the effective `entities.links.v1` and `entities.previews.v1` are both on. */
export function useEntityPreviewsEnabled(): boolean {
  return useEntityUiFlags().previews
}
