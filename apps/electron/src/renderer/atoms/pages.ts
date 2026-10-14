/**
 * Jotai atoms for workspace Pages (agent-authored mini dashboards).
 *
 * `pagesAtom` is the single source of truth for the loaded page list —
 * `usePages` writes it and every consumer (sidebar count, grid, detail view)
 * reads it. There is deliberately no local-state mirror.
 *
 * `pagesProjectFilterAtom` follows the Kanban board's filter semantics
 * (empty = all), with one addition: the `PAGES_UNASSIGNED_PROJECT` sentinel
 * selects pages that have no project. It survives board remounts within a
 * session and is keyed per workspace, so switching workspaces never carries
 * one workspace's project ids into another (each starts at «all»).
 */

import { atom } from 'jotai'
import type { LoadedPage } from '@rox/shared/pages/types'

export const pagesAtom = atom<LoadedPage[]>([])

/** Sentinel id representing "pages without a project" in the project filter. */
export const PAGES_UNASSIGNED_PROJECT = '__unassigned__'

const EMPTY_FILTER: readonly string[] = Object.freeze([]) as readonly string[]
const pagesProjectFiltersByWorkspaceAtom = atom<Record<string, string[]>>({})

/**
 * Selected project ids for the active workspace's pages grid. Empty array = all pages.
 * Read/write via `pagesProjectFilterAtom(workspaceId)`-style helper below.
 */
export const pagesProjectFilterAtom = atom(
  get => get(pagesProjectFiltersByWorkspaceAtom),
  (get, set, input: { workspaceId: string; ids: string[] }) =>
    set(pagesProjectFiltersByWorkspaceAtom, { ...get(pagesProjectFiltersByWorkspaceAtom), [input.workspaceId]: input.ids }),
)

/** The filter for one workspace; a workspace that never picked a project sees all pages. */
export function pagesFilterForWorkspace(filters: Record<string, string[]>, workspaceId: string | null | undefined): readonly string[] {
  return (workspaceId && filters[workspaceId]) || EMPTY_FILTER
}
