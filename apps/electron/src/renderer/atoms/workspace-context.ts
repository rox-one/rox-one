import { atomWithStorage } from 'jotai/utils'
import { atom } from 'jotai'
import { createContext, useContext } from 'react'
import { useAtomValue } from 'jotai'
export const activeWorkspaceContextAtom = atom<string | null>(null)

/** Explicit workspace-qualified project selection. Never infer ownership from names. */
const savedWorkspaceProjectsAtom = atomWithStorage<Record<string, string | null>>('rox.workspace-project-context.v1', {})
function validProjects(raw: unknown): Record<string, string | null> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter(([key, value]) => key && (value === null || typeof value === 'string'))) as Record<string, string | null>
}
export const workspaceProjectContextsAtom = atom(
  get => validProjects(get(savedWorkspaceProjectsAtom)),
  (get, set, value: Record<string, string | null> | ((current: Record<string, string | null>) => Record<string, string | null>)) =>
    set(savedWorkspaceProjectsAtom, typeof value === 'function' ? value(validProjects(get(savedWorkspaceProjectsAtom))) : value),
)
export const WorkspaceToolContext = createContext<{workspaceId: string; projectId?: string} | null>(null)
export function useWorkspaceProjectContext(workspaceId: string | null): string | undefined {
  const context = useContext(WorkspaceToolContext)
  const projects = useAtomValue(workspaceProjectContextsAtom)
  return context && context.workspaceId === workspaceId ? context.projectId : workspaceId ? projects[workspaceId] ?? undefined : undefined
}
export const selectedProjectForWorkspaceAtom = atom(
  get => get(workspaceProjectContextsAtom),
  (get, set, input: { workspaceId: string; projectId: string | null }) => {
    set(workspaceProjectContextsAtom, { ...get(workspaceProjectContextsAtom), [input.workspaceId]: input.projectId })
  },
)
