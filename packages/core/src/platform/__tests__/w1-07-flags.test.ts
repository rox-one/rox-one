/** W1-07 (#1504): unified-shell flags are registered, unique and default OFF. */
import { describe, expect, it } from 'bun:test'
import { WORKBENCH_FEATURE_FLAGS, WORKBENCH_FLAG, resolveEnabledFlags } from '../workbench/index.ts'

const W1_07 = [
  WORKBENCH_FLAG.modeMessengerV1,
  WORKBENCH_FLAG.modeCalendarV1,
  WORKBENCH_FLAG.modeGoalsV1,
  WORKBENCH_FLAG.modeContactsV1,
  WORKBENCH_FLAG.docsSharedV1,
]

describe('W1-07 workbench flags', () => {
  it('uses the spec ids', () => {
    expect(W1_07).toEqual([
      'workbench.mode.messenger.v1',
      'workbench.mode.calendar.v1',
      'workbench.mode.goals.v1',
      'workbench.mode.contacts.v1',
      'docs.shared.v1',
    ])
  })

  it('registers each flag once, default OFF, no dependencies, rollback-safe', () => {
    for (const id of W1_07) {
      const definitions = WORKBENCH_FEATURE_FLAGS.filter((flag) => flag.id === id)
      expect(definitions).toEqual([{ id, defaultValue: false, dependencies: [], rollbackSafe: true }])
    }
  })

  it('keeps every flag id unique across the registry', () => {
    const ids = WORKBENCH_FEATURE_FLAGS.map((flag) => flag.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('resolves only when requested', () => {
    expect([...resolveEnabledFlags(new Set())].filter((id) => W1_07.includes(id as never))).toEqual([])
    expect(resolveEnabledFlags(new Set([WORKBENCH_FLAG.modeGoalsV1])).has(WORKBENCH_FLAG.modeGoalsV1)).toBe(true)
  })
})
