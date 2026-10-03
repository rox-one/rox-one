import { createContext, useContext } from 'react'

export const FixtureWorkspace = createContext({ id: 'workspace-a' })
export const useActiveWorkspace = () => useContext(FixtureWorkspace)
