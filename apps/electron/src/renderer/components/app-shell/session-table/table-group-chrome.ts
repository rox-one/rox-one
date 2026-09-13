import type { TableGroup } from './table-empty-groups'

export const TABLE_EMPTY_LANE_HEIGHT = 40

/** Bucket keys that currently hold rows and can collapse. */
export function collapsibleTableGroupKeys<TItem>(
  groups: readonly TableGroup<TItem>[],
): string[] {
  return groups.flatMap((group) =>
    group.bucket && group.items.length > 0 ? [group.bucket.key] : [],
  )
}

/** Session ids in one table group, including rows hidden by collapse. */
export function selectTableGroupSessionIds<TItem extends { id: string }>(
  groups: readonly TableGroup<TItem>[],
  groupKey: string,
): string[] {
  const group = groups.find((entry) => entry.bucket?.key === groupKey)
  return group?.items.map((item) => item.id) ?? []
}
