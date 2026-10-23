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

/**
 * Wave 14 (F11): the outline numerals of a document's headings.
 *
 * One counter per heading level, joined with dots: the first H1 is `1`, the H2
 * under it `1.1`, the H3 under that `1.1.1` — and a heading of a shallower level
 * RESETS every counter below it, so the H1 after `1.1.1` numbers `2` and the
 * next H2 under it `2.1` (Markdown's own outline numbering). A level that was
 * skipped on the way down (an H1 followed by an H3, which `HEADING_PATTERN`
 * allows) counts as the first child of the missing level, so the numerals stay
 * contiguous instead of carrying a hole.
 *
 * The input is one level per heading, in document order — the page keeps
 * measuring and rendering, this function owns the numbering.
 *
 * @param levels The heading levels — one `#` count each, in document order.
 * @returns One dotted numeral per heading, in the same order.
 */
export function numberHeadings(levels: readonly number[]): string[] {
  const counters: number[] = []
  return levels.map((rawLevel) => {
    const depth = Math.min(Math.max(Math.trunc(rawLevel), 1), 6)
    // Dropping the tail is the reset: every deeper counter starts over.
    counters.length = depth
    counters[depth - 1] = (counters[depth - 1] ?? 0) + 1
    // `Array.from` (not `.map`) — the counters above the first one are array
    // HOLES, and `.map` skips holes, which would leave empty dot segments.
    return Array.from(counters, (count) => count ?? 1).join('.')
  })
}
