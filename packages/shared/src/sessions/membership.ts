/**
 * Multi-project session membership (issue #335).
 * `projectId` stays the primary/legacy binding; `projectIds` is the full set.
 * Unlink never deletes the entity.
 */

export type ProjectLinkRole = 'primary' | 'member' | 'reference'

export type ProjectMembership = {
  entityId: string
  projectId: string
  linkRole: ProjectLinkRole
}

export type ProjectVisibility = {
  id: string
  closedAt?: number
  archivedAt?: number
  name?: string
  details?: string
}

export function isProjectClosed(project: Pick<ProjectVisibility, 'closedAt' | 'archivedAt'>): boolean {
  return project.closedAt != null || project.archivedAt != null
}

export function sessionProjectIds(session: { projectId?: string | null; projectIds?: string[] | null }): string[] {
  const ids: string[] = []
  if (session.projectId) ids.push(session.projectId)
  for (const id of session.projectIds ?? []) {
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export function sessionBelongsToProject(
  session: { projectId?: string | null; projectIds?: string[] | null },
  projectId: string,
): boolean {
  return sessionProjectIds(session).includes(projectId)
}

export function withProjectMembership(projectIds: readonly string[]): { projectId?: string; projectIds: string[] } {
  const unique = [...new Set(projectIds.filter((id) => Boolean(id)))]
  return {
    projectId: unique[0],
    projectIds: unique,
  }
}

export function membershipsFromSession(
  session: { id: string; projectId?: string | null; projectIds?: string[] | null },
): ProjectMembership[] {
  const ids = sessionProjectIds(session)
  return ids.map((projectId, index) => ({
    entityId: session.id,
    projectId,
    linkRole: index === 0 ? 'primary' : 'member',
  }))
}

/** Unlink one project. The entity id is preserved; remaining memberships stay. */
export function unlinkProjectMembership(
  memberships: readonly ProjectMembership[],
  entityId: string,
  projectId: string,
): ProjectMembership[] {
  const remaining = memberships.filter((item) => !(item.entityId === entityId && item.projectId === projectId))
  const forEntity = remaining.filter((item) => item.entityId === entityId)
  if (forEntity.length > 0 && !forEntity.some((item) => item.linkRole === 'primary')) {
    return remaining.map((item) =>
      item.entityId === entityId && item.projectId === forEntity[0]!.projectId
        ? { ...item, linkRole: 'primary' as const }
        : item,
    )
  }
  return remaining
}

export function uniquePortfolioSessionIds(memberships: readonly ProjectMembership[]): string[] {
  return [...new Set(memberships.map((item) => item.entityId))]
}

export function visibleMembershipsForViewer(input: {
  memberships: readonly ProjectMembership[]
  viewerProjectId: string
  projects: readonly ProjectVisibility[]
}): ProjectMembership[] {
  const closed = new Set(input.projects.filter(isProjectClosed).map((project) => project.id))
  const inViewer = new Set(
    input.memberships.filter((item) => item.projectId === input.viewerProjectId).map((item) => item.entityId),
  )
  return input.memberships.filter((item) => {
    if (!inViewer.has(item.entityId)) return false
    if (closed.has(item.projectId) && item.projectId !== input.viewerProjectId) return false
    return true
  })
}

export function projectContextVisibleToViewer(input: {
  project: ProjectVisibility
  viewerProjectId: string
}): boolean {
  if (input.project.id !== input.viewerProjectId && isProjectClosed(input.project)) return false
  return true
}

export function filterProjectContextForViewer<T extends ProjectVisibility>(
  projects: readonly T[],
  viewerProjectId: string,
): T[] {
  return projects.filter((project) => projectContextVisibleToViewer({ project, viewerProjectId }))
}
