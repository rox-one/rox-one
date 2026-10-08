/**
 * W1-08 (#1505) — workspace scope for entity components.
 *
 * Integration points (Notes, Tasks) provide the active workspace id once;
 * chips and panels read it instead of importing the app shell context.
 */
import { createContext, useContext } from 'react'

export const EntityWorkspaceContext = createContext<string | null>(null)

export function useEntityWorkspaceId(explicit?: string | null): string | null {
  const scoped = useContext(EntityWorkspaceContext)
  return explicit ?? scoped
}
