export type ProjectNoteScope =
  | { kind: 'workspace' }
  | { kind: 'project'; projectId: string; folder: string; name: string }
  | { kind: 'unavailable'; projectId: string }

/** Project ownership is the canonical folder path, never a title or active chat. */
export function projectNoteScope(projectId: string | undefined, projects: Array<{ id: string; slug: string; name: string }>): ProjectNoteScope {
  if (!projectId) return { kind: 'workspace' }
  const project = projects.find(item => item.id === projectId)
  if (!project || !project.slug || /[\\/]/.test(project.slug) || project.slug === '.' || project.slug === '..') return { kind: 'unavailable', projectId }
  return { kind: 'project', projectId, folder: `projects/${project.slug}`, name: project.name }
}

export function noteInProjectScope(noteId: string, scope: ProjectNoteScope): boolean {
  return scope.kind === 'workspace' || (scope.kind === 'project' && noteId.startsWith(`${scope.folder}/`))
}

/** Explicit folders outside a selected project are rejected, never silently moved. */
export function noteCreationFolder(scope: ProjectNoteScope, explicitFolder?: string): { allowed: true; folder?: string } | { allowed: false } {
  if (scope.kind === 'unavailable') return { allowed: false }
  if (explicitFolder != null && (explicitFolder.split('/').some(part => part === '..' || part === '.') || explicitFolder.includes('\\'))) return { allowed: false }
  if (scope.kind === 'workspace') return { allowed: true, folder: explicitFolder }
  if (explicitFolder == null) return { allowed: true, folder: scope.folder }
  return explicitFolder === scope.folder || explicitFolder.startsWith(`${scope.folder}/`)
    ? { allowed: true, folder: explicitFolder } : { allowed: false }
}

/** A relative new-folder name is rooted under the selected project's real folder. */
export function newProjectNoteFolder(scope: ProjectNoteScope, value: string): { allowed: true; folder?: string } | { allowed: false } {
  const folder = value.trim().replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '')
  if (!folder) return { allowed: false }
  const explicit = scope.kind === 'project' && !folder.startsWith('projects/') ? `${scope.folder}/${folder}` : folder
  return noteCreationFolder(scope, explicit)
}
