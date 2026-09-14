/** Catalog `kanban.column.*` for known statuses; custom ids keep the identifier. */
export function bulkStatusColumnLabel(
  status: string,
  t: (key: string) => unknown,
  exists: (key: string) => boolean,
): string {
  const key = `kanban.column.${status}`
  if (!exists(key)) return status
  const value = t(key)
  return typeof value === 'string' && value !== key ? value : status
}
