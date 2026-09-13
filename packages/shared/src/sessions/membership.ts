/**
 * Multi-project session membership (issue #335).
 * `projectId` stays the primary/legacy binding; `projectIds` is the full set.
 */

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
