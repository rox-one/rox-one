import { atom, useAtomValue } from 'jotai'
export const workspaceAtom = atom('a')
export const useActiveWorkspace = () => ({ id: useAtomValue(workspaceAtom) })
