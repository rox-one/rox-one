/**
 * W1-08 (#1505) — renderer gating for the entity UI.
 *
 * `entities.previews.v1` (default OFF) turns on hover cards, mention chips in
 * Notes and the "Referenced in" panel in Tasks. It only takes effect when
 * `entities.links.v1` is on as well, using the shared dependency resolver
 * from `@rox/core/platform` (no second flag system).
 *
 * Both requested values live in localStorage under the usual `craft-` prefix
 * and default to false, so every entity surface is inert out of the box.
 */
import { atom, useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { WORKBENCH_FLAG, isWorkbenchFlagEnabled } from '@rox/core/platform'

/**
 * STUB(#1499): W1-01/02 owns the renderer atom for `entities.links.v1` and is
 * still adding it. Until it lands we read the same `craft-feature-*` key
 * convention here; swap this for #1499's exported atom once available.
 */
export const ENTITIES_LINKS_STORAGE_KEY = 'craft-feature-entities-links-v1'
export const ENTITIES_PREVIEWS_STORAGE_KEY = 'craft-feature-entities-previews-v1'

/** STUB(#1499): requested state of `entities.links.v1` (see above). */
export const entitiesLinksRequestedAtom = atomWithStorage<boolean>(
  ENTITIES_LINKS_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true },
)

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
