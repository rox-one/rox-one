import { createContext, useContext } from 'react'
export const Context = createContext<{ activeWorkspaceId: string | null } | null>(null)
export const useOptionalAppShellContext = () => useContext(Context)
