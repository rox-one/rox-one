import { describe, expect, it } from 'bun:test'
import {
  extractRecentSettings,
  parsePreferences,
  SETTINGS_RECENT_KEY,
  upsertRecentSetting,
} from '../settings-recent'
import type { SettingsSubpage } from '../../../shared/settings-registry'

describe('settings recent history', () => {
  it('records newest-first per workspace and isolates workspaces', () => {
    let prefs: Record<string, unknown> = {}
    prefs = upsertRecentSetting(prefs, 'ws-a', 'runtime').prefs
    expect(extractRecentSettings(prefs, 'ws-a')).toEqual(['runtime'])
    prefs = upsertRecentSetting(prefs, 'ws-a', 'ai').prefs
    expect(extractRecentSettings(prefs, 'ws-a')).toEqual(['ai', 'runtime'])
    const recorded = upsertRecentSetting(prefs, 'ws-a', 'runtime')
    expect(recorded.recents).toEqual(['runtime', 'ai'])
    expect(extractRecentSettings(recorded.prefs, 'ws-b')).toEqual([])
  })

  it('ignores a missing workspace id', () => {
    expect(upsertRecentSetting({}, '', 'runtime').recents).toEqual([])
    expect(extractRecentSettings({}, undefined)).toEqual([])
    expect(extractRecentSettings({}, null)).toEqual([])
  })

  it('reads only valid ids from malformed storage', () => {
    expect(extractRecentSettings(parsePreferences('{not json'), 'ws-a')).toEqual([])
    expect(extractRecentSettings({ [SETTINGS_RECENT_KEY]: { runtime: true } }, 'ws-a')).toEqual([])
    expect(
      extractRecentSettings(
        { [SETTINGS_RECENT_KEY]: { byWorkspace: { 'ws-a': ['runtime', 'obsolete', 5] } } },
        'ws-a',
      ),
    ).toEqual(['runtime'])
  })

  it('caps recents at five unique ids and preserves unrelated preferences', () => {
    let prefs: Record<string, unknown> = { diffViewer: { diffStyle: 'split' } }
    const ids = ['runtime', 'ai', 'permissions', 'marketplace', 'accounts', 'appearance'] as const
    let latest: SettingsSubpage[] = []
    for (const id of ids) {
      const next = upsertRecentSetting(prefs, 'ws-a', id)
      prefs = next.prefs
      latest = next.recents
    }
    expect(latest).toEqual(['appearance', 'accounts', 'marketplace', 'permissions', 'ai'])
    expect(extractRecentSettings(prefs, 'ws-a')).toEqual(latest)
    expect(prefs.diffViewer).toEqual({ diffStyle: 'split' })
  })
})
