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

  it('harness flags default off and agent-intel needs inspector', () => {
    expect(WORKBENCH_FLAG.harnessInspectorV1).toBe('workbench.harness.inspector.v1')
    expect(WORKBENCH_FLAG.harnessChatChromeV1).toBe('workbench.harness.chat-chrome.v1')
    expect(WORKBENCH_FLAG.harnessAgentIntelV1).toBe('workbench.harness.agent-intel.v1')
    expect(WORKBENCH_FLAG.harnessExtCenterV1).toBe('workbench.harness.ext-center.v1')
    for (const id of [
      WORKBENCH_FLAG.harnessInspectorV1,
      WORKBENCH_FLAG.harnessChatChromeV1,
      WORKBENCH_FLAG.harnessAgentIntelV1,
      WORKBENCH_FLAG.harnessExtCenterV1,
    ]) {
      expect(isWorkbenchFlagEnabled(id, new Set())).toBe(false)
      const definition = WORKBENCH_FEATURE_FLAGS.find((flag) => flag.id === id)
      expect(definition?.defaultValue).toBe(false)
      expect(definition?.rollbackSafe).toBe(true)
    }
    expect(isWorkbenchFlagEnabled(WORKBENCH_FLAG.harnessAgentIntelV1, new Set([WORKBENCH_FLAG.harnessAgentIntelV1]))).toBe(
      false,
    )
    expect(
      isWorkbenchFlagEnabled(
        WORKBENCH_FLAG.harnessAgentIntelV1,
        new Set([WORKBENCH_FLAG.harnessAgentIntelV1, WORKBENCH_FLAG.harnessInspectorV1]),
      ),
    ).toBe(true)
    expect(
      isWorkbenchFlagEnabled(WORKBENCH_FLAG.harnessChatChromeV1, new Set([WORKBENCH_FLAG.harnessChatChromeV1])),
    ).toBe(true)
  })
})
