import { describe, expect, it } from 'bun:test'
import { isModeNavigable, listPinnedModes } from '@craft-agent/core/platform'
import { CORE_MODES } from '../modes-seed'
import { __resetModeRegistryForTests, getModeRegistry } from '../mode-registry-bootstrap'

describe('CORE_MODES seed', () => {
  it('pins chat and knowledge as the only live modes', () => {
    const contributions = CORE_MODES.map((mode) => mode.contribution)
    const live = CORE_MODES.filter((mode) => isModeNavigable(mode.contribution))
    const { pinned, overflow } = listPinnedModes(contributions)
    expect(live.map((mode) => mode.contribution.id)).toEqual(['chat', 'knowledge'])
    expect(pinned.map((mode) => mode.id)).toEqual(['chat', 'knowledge'])
    expect(overflow.map((mode) => mode.id)).toEqual(['home', 'meetings', 'tasks', 'feed', 'inbox'])
    expect(CORE_MODES.map((mode) => mode.contribution.id)).toEqual([
      'home',
      'chat',
      'meetings',
      'tasks',
      'knowledge',
      'feed',
      'inbox',
    ])
  })

  it('registers each seed once on the singleton registry', () => {
    __resetModeRegistryForTests()
    const first = getModeRegistry()
    const second = getModeRegistry()
    expect(first).toBe(second)
    expect(first.list().map((mode) => mode.id)).toEqual(CORE_MODES.map((mode) => mode.contribution.id))
  })
})
