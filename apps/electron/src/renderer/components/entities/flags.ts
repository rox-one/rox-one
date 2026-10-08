/**
 * W1-08 (#1505) — renderer gating for the entity UI.
 *
 * `entities.previews.v1` (default OFF) turns on hover cards, mention chips in
 * Notes and the "Referenced in" panel in Tasks. It only takes effect when
 * `entities.links.v1` is on as well, using the shared dependency resolver
 * from `@rox/core/platform` (no second flag system).
 *
 * `entities.links.v1` is #1499's renderer atom; `entities.previews.v1` lives
 * next to it in localStorage (`craft-` prefix). Both default to false, so
 * every entity surface is inert out of the box.
 */
import { atom, useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { WORKBENCH_FLAG, isWorkbenchFlagEnabled } from '@rox/core/platform'
import { KEYS, getKeyString } from '../../lib/local-storage'
import { featureEntitiesLinksV1Atom } from '../../atoms/entities-links'

/** localStorage key of #1499's `entities.links.v1` atom (`craft-feature-entities-links-v1`). */
export const ENTITIES_LINKS_STORAGE_KEY = getKeyString(KEYS.featureEntitiesLinksV1)
export const ENTITIES_PREVIEWS_STORAGE_KEY = getKeyString(KEYS.featureEntitiesPreviewsV1)

/**
 * Requested state of `entities.links.v1`: #1499's renderer atom (the one the
 * Settings toggle writes and `useEntitiesLinksFlagSync` pushes to main), so
 * entity UI and the links subsystem can never disagree within a session.
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

export const entityUiFlagsAtom = atom<EntityUiFlags>((get) =>
  resolveEntityUiFlags({ links: get(entitiesLinksRequestedAtom), previews: get(entitiesPreviewsRequestedAtom) }),
)

/** True only while both `entities.links.v1` and `entities.previews.v1` are on. */
export function useEntityPreviewsEnabled(): boolean {
  return useAtomValue(entityUiFlagsAtom).previews
}
