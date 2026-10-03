/** Project membership metadata never grants access to a project or its context. */
export type SessionProjectMembership = { projectId?: string | null; projectIds?: readonly string[] | null }

export function sessionProjectIds(session: SessionProjectMembership): string[] {
  const raw: unknown[] = [session.projectId, ...(Array.isArray(session.projectIds) ? session.projectIds : [])]
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

export function sessionBelongsToProject(session: SessionProjectMembership, projectId: string): boolean {
  return sessionProjectIds(session).includes(projectId)
}

export function withProjectMembership(ids: readonly string[]): { projectId?: string; projectIds: string[] } {
  const projectIds = sessionProjectIds({ projectIds: ids })
  return { projectId: projectIds[0], projectIds }
}
