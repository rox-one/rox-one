import { describe, expect, it } from 'bun:test'
import { HARNESS_SKIP_IDS, HARNESS_SKIP_LIST } from '../workbench/harness-skip-list.ts'

describe('H6 harness skip-list', () => {
  it('freezes session-buddy, mnemon, cordis HMR and agent-teams as not-installed', () => {
    expect(HARNESS_SKIP_IDS).toEqual([
      'sessionBuddy',
      'mnemon',
      'pluginHotReload',
      'agentTeamsRuntime',
      'visionCliPlugin',
      'searchCliPlugin',
      'extraAutomationRuntime',
      'remoteControlCompat',
    ])
    const byId = Object.fromEntries(HARNESS_SKIP_LIST.map((item) => [item.id, item.packageId]))
    expect(byId.sessionBuddy).toBe('dsh-session-buddy')
    expect(byId.mnemon).toBe('dsh-mnemon')
    expect(byId.pluginHotReload).toBe('dsh-hot-reload')
    expect(byId.agentTeamsRuntime).toBe('@nanmicoder/dsh-agent-teams')
  })
})
