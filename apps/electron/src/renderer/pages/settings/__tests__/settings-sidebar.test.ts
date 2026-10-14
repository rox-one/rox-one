import { describe, expect, it, mock } from 'bun:test'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry'
import { buildSettingsSidebarGroups, SETTINGS_SIDEBAR_GROUPS } from '../settings-sidebar'

describe('settings sidebar', () => {
  it('covers every registered settings page exactly once', () => {
    const ids = SETTINGS_SIDEBAR_GROUPS.flatMap((g) => g.pages.map((p) => p.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(SETTINGS_PAGES.map((p) => p.id).sort())
  })
  it('groups in spec order, marks the active page and navigates', () => {
    const onOpen = mock()
    const g = buildSettingsSidebarGroups({ active: 'developers', t: (k) => k, onOpen })
    expect(g.map((x) => x.id)).toEqual(['account', 'app', 'ai', 'data', 'developers'])
    const dev = g[4]!.items.find((i) => i.id === 'developers')!
    expect(dev.active).toBe(true)
    expect(dev.label).toBe('settings.developers.title')
    g[0]!.items[0]!.onSelect()
    expect(onOpen).toHaveBeenCalledWith('account')
  })
})
