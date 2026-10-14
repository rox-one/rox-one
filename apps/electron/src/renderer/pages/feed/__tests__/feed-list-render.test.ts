import { describe, expect, it } from 'bun:test'
import { FEED_DAY_HEADER_PX, FEED_ROW_PX, feedDayGroupEstimatePx, feedDayGroupStyle } from '../feed-list-render'

describe('feed list off-screen rendering', () => {
  it('estimates a day group from its row count and density', () => {
    expect(feedDayGroupEstimatePx(3, 'cards')).toBe(FEED_DAY_HEADER_PX + 3 * FEED_ROW_PX.cards)
    expect(feedDayGroupEstimatePx(3, 'list')).toBe(FEED_DAY_HEADER_PX + 3 * FEED_ROW_PX.list)
    expect(feedDayGroupEstimatePx(-1, 'list')).toBe(FEED_DAY_HEADER_PX)
  })

  it('skips off-screen groups but remembers their real size', () => {
    const style = feedDayGroupStyle(2, 'cards')
    expect(style.contentVisibility).toBe('auto')
    expect(style.containIntrinsicSize).toBe(`auto ${FEED_DAY_HEADER_PX + 2 * FEED_ROW_PX.cards}px`)
  })
})
