import { describe, expect, it } from 'bun:test'
import { DEFAULT_COLLECTION_FILTERS } from '@craft-agent/shared/sessions/collection'
import { chipsAfterRailChange } from '../collection-rail-filters'

describe('chipsAfterRailChange', () => {
  const chips = { projectId: ['p1'] }

  it('clears chips when the rail key changes', () => {
    expect(chipsAfterRailChange({ prevKey: 'allSessions', nextKey: 'flagged', prevChips: chips })).toEqual(
      DEFAULT_COLLECTION_FILTERS,
    )
  })

  it('keeps chips when the same rail key is clicked', () => {
    expect(chipsAfterRailChange({ prevKey: 'allSessions', nextKey: 'allSessions', prevChips: chips })).toEqual(chips)
  })

  it('keeps chips for jump-to-project/task', () => {
    expect(
      chipsAfterRailChange({ prevKey: 'allSessions', nextKey: 'allSessions', jump: true, prevChips: chips }),
    ).toEqual(chips)
  })
})
