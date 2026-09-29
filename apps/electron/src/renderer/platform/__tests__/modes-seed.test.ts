import { describe, expect, it } from 'bun:test'
import { isModeNavigable, listPinnedModes } from '@craft-agent/core/platform'
import { CORE_MODES, modeForSlot, resolveSeededModes } from '../modes-seed'
import { __resetModeRegistryForTests, getModeRegistry } from '../mode-registry-bootstrap'

describe('CORE_MODES seed', () => {
  it('pins home, chat, meetings, tasks and notes as the live modes', () => {
    const contributions = CORE_MODES.map((mode) => mode.contribution)
    const live = CORE_MODES.filter((mode) => isModeNavigable(mode.contribution))
    const { pinned, overflow } = listPinnedModes(contributions)
    expect(live.map((mode) => mode.contribution.id)).toEqual(['home', 'chat', 'meetings', 'tasks', 'notes'])
    expect(pinned.map((mode) => mode.id)).toEqual(['home', 'chat', 'meetings', 'tasks', 'notes'])
    expect(overflow.map((mode) => mode.id)).toEqual(['feed', 'inbox'])
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

  it('maps ⌥⌘1…7 to the pill order', () => {
    expect(modeForSlot(contributions, 1)?.id).toBe('home')
    expect(modeForSlot(contributions, 4)?.id).toBe('tasks')
    expect(modeForSlot(contributions, 7)?.id).toBe('inbox')
    expect(modeForSlot(contributions, 8)).toBeNull()
  })
})
