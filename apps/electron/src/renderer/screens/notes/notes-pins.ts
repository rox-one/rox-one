import { atomWithStorage } from 'jotai/utils'

/** Pinned note ids per workspace (renderer-only; ids are vault-relative paths). */
export const notesPinnedByWorkspaceAtom = atomWithStorage<Record<string, string[]>>('rox.notes.pinned.v1', {}, undefined, { getOnInit: true })
