/**
 * Status columns remain visible as drop targets unless nested grouping would
 * otherwise hide an empty group. Enabling "Show empty groups" must never
 * remove an empty column.
 */
export function shouldHideEmptyNestedKanbanColumns(
  groupBy: string | undefined,
  showEmptyGroups: boolean,
): boolean {
  return !showEmptyGroups && groupBy !== 'none' && groupBy !== 'status'
}
