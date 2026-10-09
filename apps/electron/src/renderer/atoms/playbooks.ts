/**
 * Playbooks surface flag (`playbooks.v1`, spec 2026-10-09, D12) — master
 * renderer atom. Mirrors `atoms/entities-links.ts` (atomWithStorage + KEYS +
 * getKeyString). Default OFF; the rail entry and the notebook surface stay
 * hidden until the user enables it explicitly.
 */
import { atomWithStorage } from 'jotai/utils'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { KEYS, getKeyString } from '@/lib/local-storage'

export const PLAYBOOKS_FLAG_ID = WORKBENCH_FLAG.playbooksV1

const opts = { getOnInit: true } as const

/** Master switch for the Playbooks surface (`playbooks.v1`). Default OFF. */
export const playbooksEnabledAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.playbooksV1),
  false,
  undefined,
  opts,
)