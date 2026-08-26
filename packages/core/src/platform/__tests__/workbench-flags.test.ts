import { describe, expect, it } from 'bun:test'
import {
  WORKBENCH_FEATURE_FLAGS,
  WORKBENCH_FLAG,
  isWorkbenchFlagEnabled,
  resolveEnabledFlags,
} from '../workbench/index.ts'

describe('resolveEnabledFlags', () => {
  it('enables independent flags that were requested', () => {
    const enabled = resolveEnabledFlags(new Set([WORKBENCH_FLAG.statusBarV1, WORKBENCH_FLAG.tabGroupsV2]))
    expect(enabled.has(WORKBENCH_FLAG.statusBarV1)).toBe(true)
    expect(enabled.has(WORKBENCH_FLAG.tabGroupsV2)).toBe(true)
    expect(enabled.has(WORKBENCH_FLAG.topChromeV2)).toBe(false)
  })

  it('keeps top-chrome off unless its mode-registry dependency is also requested', () => {
    expect(isWorkbenchFlagEnabled(WORKBENCH_FLAG.topChromeV2, new Set([WORKBENCH_FLAG.topChromeV2]))).toBe(false)
    expect(
      isWorkbenchFlagEnabled(
        WORKBENCH_FLAG.topChromeV2,
        new Set([WORKBENCH_FLAG.topChromeV2, WORKBENCH_FLAG.modeRegistryV1]),
      ),
    ).toBe(true)
  })

  it('skips unknown ids and honors incompatibleWith', () => {
    const enabled = resolveEnabledFlags(
      new Set(['not-a-flag', WORKBENCH_FLAG.statusBarV1]),
      [
        ...WORKBENCH_FEATURE_FLAGS,
        {
          id: 'workbench.demo',
          defaultValue: false,
          dependencies: [],
          incompatibleWith: [WORKBENCH_FLAG.statusBarV1],
          rollbackSafe: true,
        },
      ],
    )
    expect(enabled.has('not-a-flag')).toBe(false)
    expect(enabled.has('workbench.demo')).toBe(false)
    expect(enabled.has(WORKBENCH_FLAG.statusBarV1)).toBe(true)
  })

  it('terminal flags default off', () => {
    expect(WORKBENCH_FLAG.terminalV1).toBe('workbench.terminal.v1')
    expect(WORKBENCH_FLAG.coordinatorV1).toBe('execution.coordinator.v1')
    expect(isWorkbenchFlagEnabled(WORKBENCH_FLAG.terminalV1, new Set())).toBe(false)
    expect(isWorkbenchFlagEnabled(WORKBENCH_FLAG.coordinatorV1, new Set())).toBe(false)
    expect(WORKBENCH_FEATURE_FLAGS.find((flag) => flag.id === WORKBENCH_FLAG.terminalV1)).toEqual({
      id: 'workbench.terminal.v1',
      defaultValue: false,
      dependencies: [],
      rollbackSafe: true,
    })
    expect(WORKBENCH_FEATURE_FLAGS.find((flag) => flag.id === WORKBENCH_FLAG.coordinatorV1)).toEqual({
      id: 'execution.coordinator.v1',
      defaultValue: false,
      dependencies: [],
      rollbackSafe: true,
    })
  })
})
