import { atomWithStorage } from 'jotai/utils'

/** Side session (top50 #20) remembered per workspace, reopened next to any screen. */
export const sideSessionByWorkspaceAtom = atomWithStorage<Record<string, string>>('rox.sideSession.v1', {}, undefined, { getOnInit: true })
