import { describe, expect, it } from 'bun:test'
import { SETTINGS_PAGES } from '../settings-registry'
import {
  filterSettingsPages,
  getSettingsGroup,
  groupSettingsPages,
  SETTINGS_GROUPS,
} from '../settings-presentation'

describe('settings presentation', () => {
  it('covers every registered settings page exactly once', () => {
    const ids = SETTINGS_GROUPS.flatMap(group => group.pageIds)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids)).toEqual(new Set(SETTINGS_PAGES.map(page => page.id)))
  })

  it('filters translated rows without reordering matching pages', () => {
    const rows = [
      { id: 'runtime' as const, label: 'Runtime', description: 'Agent runtime' },
      { id: 'appearance' as const, label: 'Appearance', description: 'Theme and font' },
    ]
    expect(filterSettingsPages(rows, 'theme')).toEqual([rows[1]])
  })

  it('returns the original ordered rows for a blank query', () => {
    const rows = [
      { id: 'runtime' as const, label: 'Runtime', description: 'Agent runtime' },
      { id: 'ai' as const, label: 'AI', description: 'Model' },
    ]
    expect(filterSettingsPages(rows, '   ')).toEqual(rows)
  })

  it('looks up the group for a registered page', () => {
    expect(getSettingsGroup('runtime').id).toBe('agent')
    expect(getSettingsGroup('permissions').id).toBe('agent')
    expect(getSettingsGroup('ai').id).toBe('agent')
    expect(getSettingsGroup('account').id).toBe('application')
    expect(getSettingsGroup('marketplace').id).toBe('integrations')
  })

  it('groups filtered rows and hides empty groups', () => {
    const rows = [
      { id: 'ai' as const, label: 'AI', description: 'Model' },
      { id: 'shortcuts' as const, label: 'Shortcuts', description: 'Keys' },
    ]
    const grouped = groupSettingsPages(rows)
    expect(grouped.map((entry) => entry.group.id)).toEqual(['agent', 'application'])
    expect(grouped[0]?.pages.map((page) => page.id)).toEqual(['ai'])
    expect(grouped[1]?.pages.map((page) => page.id)).toEqual(['shortcuts'])
  })

  it('places permissions in Agent after ai (not Application)', () => {
    const agent = SETTINGS_GROUPS.find(group => group.id === 'agent')
    expect(agent?.pageIds).toEqual(['runtime', 'context', 'ai', 'permissions', 'input'])
    const application = SETTINGS_GROUPS.find(group => group.id === 'application')
    expect(application?.pageIds).not.toContain('permissions')
  })
})
