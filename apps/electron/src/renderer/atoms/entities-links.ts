/**
 * Renderer flag for the entity links subsystem (`entities.links.v1`).
 *
 * Mirrors the `workbench.mode.*` pattern (atomWithStorage + KEYS, persisted
 * in localStorage). Default OFF — the subsystem stays inert until the user
 * enables it in Settings or `CRAFT_FEATURE_ENTITIES_LINKS=1` overrides it.
 */
import { atomWithStorage } from 'jotai/utils'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { KEYS, getKeyString } from '@/lib/local-storage'

export const ENTITIES_LINKS_FLAG_ID = WORKBENCH_FLAG.entitiesLinksV1

const opts = { getOnInit: true } as const

export const featureEntitiesLinksV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureEntitiesLinksV1),
  false,
  undefined,
  opts,
)
