/** A single real project is a workspace context; multi-project and unassigned are library filters. */
export function pagesProjectContext(filter: readonly string[], unassignedId: string): string | null {
  const ids = [...new Set(filter)]
  return ids.length === 1 && ids[0] !== unassignedId ? ids[0]! : null
}

export function pagesContextFilter(projectId: string | null | undefined): string[] {
  return projectId ? [projectId] : []
}

/** Only bind new pages to a real loaded project; stale or unassigned IDs never become owners. */
export function pagesCreationProject(filter: readonly string[], liveProjectIds: readonly string[]): string | undefined {
  const live = new Set(liveProjectIds)
  return filter.find(id => live.has(id))
}
import { atom } from 'jotai'

/** Same lifetime as the library filter, so remounts retain advanced filters within their workspace. */
export const pagesFilterContextKeyAtom = atom<string | null>(null)
