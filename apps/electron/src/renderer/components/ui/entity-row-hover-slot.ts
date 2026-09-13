/**
 * Hover / more controls on EntityRow belong in the title-row trailing slot.
 * They must not overlay the title.
 *
 * New sessions and comfortable density omit timestamps (`titleTrailing`),
 * which previously skipped that slot and painted flag/archive/more at
 * `absolute right-2 top-2` on top of the name.
 */
export type EntityRowHoverPlacement = 'title-slot' | 'none'

export function entityRowHoverPlacement(input: {
  hasMenu: boolean
  hideMoreButton?: boolean
}): EntityRowHoverPlacement {
  if (!input.hasMenu || input.hideMoreButton === true) return 'none'
  return 'title-slot'
}
