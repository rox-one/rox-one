/**
 * Jotai atom for the active workspace's projects (read once on workspace switch,
 * refreshed on `projects:changed` broadcast). Components that need projects in
 * isolation from AppShell read this atom.
 */

import { atom } from 'jotai'
import type { LoadedProject } from '@craft-agent/shared/projects/types'

import type { SharedProjectProjection, ProjectAuthorityState } from '../../shared/project-authority'

export interface ProjectCatalog {
  readonly local: LoadedProject[]
  readonly shared: readonly SharedProjectProjection[]
  readonly sharedWorkspaceId: string | null
  readonly sharedState: ProjectAuthorityState
}

/** One catalog; legacy consumers project only its local folder entries. */
export const projectCatalogAtom = atom<ProjectCatalog>({ local: [], shared: [], sharedWorkspaceId: null, sharedState: 'unconfigured' })
export const projectsAtom = atom(
  get => get(projectCatalogAtom).local,
  (get, set, local: LoadedProject[]) => set(projectCatalogAtom, { ...get(projectCatalogAtom), local }),
)
