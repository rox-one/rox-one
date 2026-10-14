import { atom } from 'jotai'
import { createContext, useContext } from 'react'
export const activeWorkspaceContextAtom = atom<string | null>(null)

/** Legacy persisted global scope from the removed sidebar «Контекст проекта» selector. */
export const LEGACY_PROJECT_CONTEXT_KEY = 'rox.workspace-project-context.v1'
/** One-time startup migration: drop the saved global scope so nothing stays silently filtered. */
export function clearLegacyProjectContext(storage: Pick<Storage, 'removeItem'> | undefined = globalThis.localStorage): void {
  try { storage?.removeItem(LEGACY_PROJECT_CONTEXT_KEY) } catch { /* storage unavailable */ }
}
clearLegacyProjectContext()

export const WorkspaceToolContext = createContext<{workspaceId: string; projectId?: string} | null>(null)
export function useWorkspaceProjectContext(workspaceId: string | null): string | undefined {
  const context = useContext(WorkspaceToolContext)
  // Only an explicit tool-panel context scopes a screen; there is no hidden shared project scope.
  return context && context.workspaceId === workspaceId ? context.projectId : undefined
}
