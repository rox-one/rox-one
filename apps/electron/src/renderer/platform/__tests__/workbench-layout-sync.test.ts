import { describe, it, expect } from 'bun:test'
import { coreModeIsActive } from '../mode-rail-model'
import { workbenchLayoutFromPanelEntries } from '../workbench-layout-sync'
import type { NavigationState } from '../../../shared/types'

const sessionsNav = { navigator: 'sessions' } as NavigationState
const knowledgeNav = { navigator: 'knowledge' } as NavigationState
const settingsNav = { navigator: 'settings' } as NavigationState

describe('coreModeIsActive', () => {
  it('matches Chat / Knowledge / Settings navigators', () => {
    expect(coreModeIsActive('core.chat', sessionsNav)).toBe(true)
    expect(coreModeIsActive('core.chat', knowledgeNav)).toBe(false)
    expect(coreModeIsActive('core.knowledge', knowledgeNav)).toBe(true)
    expect(coreModeIsActive('core.settings', settingsNav)).toBe(true)
  })
})

describe('workbenchLayoutFromPanelEntries', () => {
  it('migrates surface panels to v2 groups keyed by panel id', () => {
    const layout = workbenchLayoutFromPanelEntries(
      'ws-1',
      [
        { id: 'panel-0', route: 'allSessions/session/session-a', proportion: 0.5 },
        { id: 'panel-1', route: 'browser/instance/browser-x', proportion: 0.5 },
        { id: 'panel-2', route: 'settings', proportion: 1 },
      ],
      'panel-1',
      1_754_500_000_000,
    )

    expect(layout.version).toBe(2)
    expect(layout.groups.map((g) => g.id)).toEqual(['panel-0', 'panel-1'])
    expect(layout.activeGroupId).toBe('panel-1')
    expect(layout.groups[0]?.tabs[0]?.tab).toEqual({ kind: 'session', sessionId: 'session-a' })
    expect(layout.groups[1]?.tabs[0]?.tab).toEqual({ kind: 'browser', tabId: 'browser-x' })
  })
})
