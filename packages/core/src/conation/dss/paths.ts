/** Path builders for DSS read routes (WP-DSS). Adjust if live OpenAPI differs. */

export function dssProjectsPath(): string {
  return '/projects'
}

export function dssEntriesPath(projectId: string, path?: string, cursor?: string): string {
  const q = new URLSearchParams()
  if (path != null && path !== '') q.set('path', path)
  if (cursor != null && cursor !== '') q.set('cursor', cursor)
  const qs = q.toString()
  return `/projects/${encodeURIComponent(projectId)}/entries${qs ? `?${qs}` : ''}`
}

export function dssMetaPath(projectId: string, path: string): string {
  const q = new URLSearchParams({ path })
  return `/projects/${encodeURIComponent(projectId)}/meta?${q.toString()}`
}

export function dssContentPath(projectId: string, path: string): string {
  const q = new URLSearchParams({ path })
  return `/projects/${encodeURIComponent(projectId)}/content?${q.toString()}`
}
