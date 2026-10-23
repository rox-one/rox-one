import { atomWithStorage } from 'jotai/utils'

/** Most-recently-opened note ids per workspace (renderer-only; vault-relative paths). */
export const notesRecentOpenedByWorkspaceAtom = atomWithStorage<Record<string, string[]>>(
  'rox.notes.recentOpened.v1',
  {},
  undefined,
  { getOnInit: true },
)
