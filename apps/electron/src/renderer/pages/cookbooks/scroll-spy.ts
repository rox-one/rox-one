/**
 * Wave 13 (F8): the outline scroll-spy, as one pure decision.
 *
 * The document pane reports the scroll offset of its own scroll container; the
 * page turns every outline entry into an offset inside that container and asks
 * this function which entry is current. Keeping the decision here — instead of
 * inside the page's `onScroll` — is what makes «which heading am I reading»
 * checkable without a DOM: the page owns measurement, this module owns meaning.
 */

/**
 * A heading counts as reached once it is within this many pixels of the
 * container's top edge. The slack absorbs sub-pixel layout and a heading whose
 * own margin keeps its border box a few pixels below the fold, so the outline
 * does not flicker between two neighbours while the reader scrolls slowly.
 */
const ACTIVE_SLACK_PX = 4

/**
 * The index of the current outline entry for a scroll offset.
 *
 * The entries are in document order, so the last one at or above
 * `scrollTop + ACTIVE_SLACK_PX` is the section the reader is in; before the
 * first heading the first entry is current (a document starts at its top, and
 * an outline with no current entry would read as «nothing here»).
 *
 * @param offsets Top offset of every outline entry, in document order (px).
 * @param scrollTop Current scroll offset of the container (px).
 * @returns The current entry's index, or `null` when there is no outline.
 */
export function pickActiveEntry(offsets: readonly number[], scrollTop: number): number | null {
  if (offsets.length === 0) return null
  let active = 0
  for (let index = 0; index < offsets.length; index += 1) {
    if (offsets[index] <= scrollTop + ACTIVE_SLACK_PX) active = index
  }
  return active
}
