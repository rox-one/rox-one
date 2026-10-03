import { createContext, useContext } from 'react'
export const Context = createContext<{ activeWorkspaceId: string | null; pendingPermissions: Map<string, unknown[]>; pendingCredentials: Map<string, unknown[]>; onRespondToPermission: (...args: unknown[]) => Promise<void> } | null>(null)
export const useOptionalAppShellContext = () => useContext(Context)
