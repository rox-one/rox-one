/** Only bind new pages to a real loaded project; stale or unassigned IDs never become owners. */
export function pagesCreationProject(filter: readonly string[], liveProjectIds: readonly string[]): string | undefined {
  const live = new Set(liveProjectIds)
  return filter.find(id => live.has(id))
}
