/**
 * Renderer flags for the extra workbench screens (`workbench.mode.<id>.v1`).
 * Default ON; persisted in localStorage like the other workbench.* flags.
 */
import { atom, type PrimitiveAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { EXTRA_SCREEN_FLAG } from '@rox/core/platform'
import { EXTRA_SCREEN_IDS, type ExtraScreenId } from '../../shared/extra-screens'

export function extraScreenFlagStorageKey(id: ExtraScreenId): string {
  return `rox-flag:${EXTRA_SCREEN_FLAG[id]}`
}

export const extraScreenFlagAtoms: Record<ExtraScreenId, PrimitiveAtom<boolean>> = Object.fromEntries(
  EXTRA_SCREEN_IDS.map((id) => [
    id,
    atomWithStorage<boolean>(extraScreenFlagStorageKey(id), true, undefined, { getOnInit: true }),
  ]),
) as Record<ExtraScreenId, PrimitiveAtom<boolean>>

/** Ids of screens whose flag is on, in registry order. */
export const enabledExtraScreenIdsAtom = atom((get) =>
  EXTRA_SCREEN_IDS.filter((id) => get(extraScreenFlagAtoms[id])),
)
