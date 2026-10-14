import type { CSSProperties } from 'react'

/**
 * Off-screen rendering skip for the Лента list (perf audit: FeedPage list was not virtualized).
 *
 * Each day group gets `content-visibility: auto`, so Chromium skips style, layout and paint for groups
 * outside the scroll viewport. The DOM stays complete, so keyboard navigation (`handleListKeys`),
 * `scrollIntoView`, the product-tour reader anchor and find-in-page keep working, unlike a windowed
 * virtualizer. `contain-intrinsic-size: auto <estimate>` reserves the group's height before its first
 * render (keeps the scrollbar stable) and Chromium remembers the real height afterwards.
 */
export type FeedListDensity = 'cards' | 'list' | string

/** Estimated px heights; only used until the group has rendered once. */
export const FEED_DAY_HEADER_PX = 32
export const FEED_ROW_PX = { cards: 104, list: 44 } as const

export function feedDayGroupEstimatePx(itemCount: number, density: FeedListDensity): number {
  const row = density === 'cards' ? FEED_ROW_PX.cards : FEED_ROW_PX.list
  return FEED_DAY_HEADER_PX + Math.max(0, itemCount) * row
}

export function feedDayGroupStyle(itemCount: number, density: FeedListDensity): CSSProperties {
  return {
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${feedDayGroupEstimatePx(itemCount, density)}px`,
  }
}
