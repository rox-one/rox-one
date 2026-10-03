import { describe, expect, it } from 'bun:test'
import { isModeNavigable, listPinnedModes } from '@rox/core/platform'
import { CORE_MODES, modeForSlot, resolveSeededModes } from '../modes-seed'
import { __resetModeRegistryForTests, getModeRegistry } from '../mode-registry-bootstrap'

describe('CORE_MODES seed', () => {
  it('pins every core mode (incl. Лента and Входящие) as live', () => {
    const contributions = CORE_MODES.map((mode) => mode.contribution)
    const live = CORE_MODES.filter((mode) => isModeNavigable(mode.contribution))
    const { pinned, overflow } = listPinnedModes(contributions)
    expect(live.map((mode) => mode.contribution.id)).toEqual(['home', 'chat', 'meetings', 'tasks', 'notes', 'feed', 'inbox'])
    expect(pinned.map((mode) => mode.id)).toEqual(['home', 'chat', 'meetings', 'tasks', 'notes', 'feed', 'inbox'])
    expect(overflow.map((mode) => mode.id)).toEqual([])
    expect(CORE_MODES.map((mode) => mode.contribution.id)).toEqual([
      'home',
      'chat',
      'meetings',
      'tasks',
      'notes',
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

describe('mode-screen flags (workbench.mode.<id>.v1)', () => {
  const contributions = CORE_MODES.map((mode) => mode.contribution)

  it('keeps Задачи navigable while its flag is on and disables it when off', () => {
    const on = resolveSeededModes(contributions, { tasks: true })
    const off = resolveSeededModes(contributions, { tasks: false })
    expect(on.find((mode) => mode.id === 'tasks')?.rootRoute).toBe('tasks')
    expect(off.find((mode) => mode.id === 'tasks')?.rootRoute).toBeNull()
    // Unflagged modes are untouched.
    expect(off.find((mode) => mode.id === 'chat')?.rootRoute).toBe(on.find((mode) => mode.id === 'chat')?.rootRoute)
  })

  it('keeps Встречи navigable while its flag is on and disables it when off', () => {
    const on = resolveSeededModes(contributions, { meetings: true })
    const off = resolveSeededModes(contributions, { meetings: false })
    expect(on.find((mode) => mode.id === 'meetings')?.rootRoute).toBe('meetings')
    expect(off.find((mode) => mode.id === 'meetings')?.rootRoute).toBeNull()
  })

  it('keeps Входящие navigable while its flag is on and disables it when off', () => {
    const on = resolveSeededModes(contributions, { inbox: true })
    const off = resolveSeededModes(contributions, { inbox: false })
    expect(on.find((mode) => mode.id === 'inbox')?.rootRoute).toBe('inbox')
    expect(off.find((mode) => mode.id === 'inbox')?.rootRoute).toBeNull()
    const seeded = CORE_MODES.find((mode) => mode.contribution.id === 'inbox')
    expect(seeded?.isActive({ navigator: 'inbox', details: null })).toBe(true)
  })

  it('keeps Лента navigable while its flag is on and disables it when off', () => {
    const on = resolveSeededModes(contributions, { feed: true })
    const off = resolveSeededModes(contributions, { feed: false })
    expect(on.find((mode) => mode.id === 'feed')?.rootRoute).toBe('feed')
    expect(off.find((mode) => mode.id === 'feed')?.rootRoute).toBeNull()
    const seeded = CORE_MODES.find((mode) => mode.contribution.id === 'feed')
    expect(seeded?.isActive({ navigator: 'feed', details: null })).toBe(true)
    expect(seeded?.contribution.requiredCapabilities).toBeUndefined()
  })

  it('maps ⌘/Ctrl 1…7 to the pill order', () => {
    expect(modeForSlot(contributions, 1)?.id).toBe('home')
    expect(modeForSlot(contributions, 4)?.id).toBe('tasks')
    expect(modeForSlot(contributions, 6)?.id).toBe('feed')
    expect(modeForSlot(contributions, 7)?.id).toBe('inbox')
    expect(modeForSlot(contributions, 8)).toBeNull()
  })
  it('keeps all seven native routes available with fresh default flags', () => {
    const modes = resolveSeededModes(CORE_MODES.map(seed => seed.contribution), {})
    expect(modes.map(mode => mode.id)).toEqual(['home', 'chat', 'meetings', 'tasks', 'notes', 'feed', 'inbox'])
    for (let slot = 1; slot <= 7; slot++) expect(modeForSlot(modes, slot)?.rootRoute).toBeTruthy()
  })

})
