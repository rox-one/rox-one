import { createContext, useContext } from 'react'
export const FixtureWorkspace = createContext({ id: 'workspace-a', name: 'Workspace A', remoteServer: undefined as object | undefined })
export const useActiveWorkspace = () => useContext(FixtureWorkspace)
export const useAppShellContext = () => ({ llmConnections: [{ slug: 'rox', providerType: 'omp', defaultModel: 'rox/r1-max', isDefault: true, name: 'Rox' }] })
