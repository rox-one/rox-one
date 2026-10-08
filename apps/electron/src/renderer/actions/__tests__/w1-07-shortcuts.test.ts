/**
 * W1-07 (#1504): new shell shortcuts register without collisions on macOS
 * (⌘) and Windows/Linux (Ctrl). UI-SPEC §15 v2.1 audit:
 * ⌃1…4 quick panels (⌘⇧1…4 = collection.view*), ⌘J agent panel, ⌘⇧J ask
 * @rox, ⌘F find in doc as a mode-aware takeover of `app.search`.
 */
import { describe, expect, it } from 'bun:test'
import { actions, actionList, actionsByCategory } from '../definitions'
import type { ActionDefinition } from '../types'
import { findHotkeyCollisions, isActionFlagEnabled, physicalChord, resolveDefaultHotkey } from '../hotkeys'
import { matchesHotkey } from '../registry'
import { MODE_AWARE_TAKEOVERS, isTakeoverActive } from '../shell-shortcuts'
import { formatHotkeyDisplay } from '@/lib/platform'

const ALL = Object.values(actions) as ActionDefinition[]
const W107_IDS = [
  'agent.togglePanel', 'agent.askAboutSelection',
  'messenger.quickPanelDocs', 'messenger.quickPanelTasks', 'messenger.quickPanelCalendar', 'messenger.quickPanelContacts',
  'docs.findInDoc',
]
const W107 = ALL.filter((action) => W107_IDS.includes(action.id))

function key(init: Partial<KeyboardEvent> & { key: string }) {
  return { code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init }
}

describe('W1-07 shortcut chords', () => {
  it('declares the spec chords', () => {
    const chord = (id: string, mac: boolean) => resolveDefaultHotkey(actions[id as keyof typeof actions] as ActionDefinition, mac)
    expect(chord('agent.togglePanel', true)).toBe('mod+j')
    expect(chord('agent.askAboutSelection', true)).toBe('mod+shift+j')
    expect(['Docs', 'Tasks', 'Calendar', 'Contacts'].map((name) => chord(`messenger.quickPanel${name}`, true))).toEqual(['ctrl+1', 'ctrl+2', 'ctrl+3', 'ctrl+4'])
    expect(['Docs', 'Tasks', 'Calendar', 'Contacts'].map((name) => chord(`messenger.quickPanel${name}`, false))).toEqual(['alt+1', 'alt+2', 'alt+3', 'alt+4'])
    expect(chord('docs.findInDoc', true)).toBeNull()
    expect(actions['app.search'].defaultHotkey).toBe('mod+f')
  })

  for (const [platform, mac] of [['macOS', true], ['Windows/Linux', false]] as const) {
    it(`${platform}: no W1-07 chord collides with any other action`, () => {
      const collisions = findHotkeyCollisions(ALL, mac).filter(([a, b]) => W107_IDS.includes(a) || W107_IDS.includes(b))
      expect(collisions).toEqual([])
    })

    it(`${platform}: the baseline collision set is unchanged`, () => {
      const base = ALL.filter((action) => !W107_IDS.includes(action.id))
      expect(findHotkeyCollisions(ALL, mac)).toEqual(findHotkeyCollisions(base, mac))
    })
  }

  it('physical chords: ⌃1 differs from ⌘1 on macOS but equals Ctrl+1 elsewhere', () => {
    expect(physicalChord('ctrl+1', true)).not.toBe(physicalChord('mod+1', true))
    expect(physicalChord('ctrl+1', false)).toBe(physicalChord('mod+1', false))
    expect(physicalChord('alt+1', false)).not.toBe(physicalChord('mod+1', false))
    expect(physicalChord('mod+shift+1', true)).not.toBe(physicalChord('ctrl+1', true))
  })
})

describe('matchesHotkey with ctrl', () => {
  it('macOS: ⌃1 fires ctrl+1 only; ⌘1 still fires mod+1 only', () => {
    expect(matchesHotkey(key({ key: '1', ctrlKey: true }), 'ctrl+1', true)).toBe(true)
    expect(matchesHotkey(key({ key: '1', ctrlKey: true }), 'mod+1', true)).toBe(false)
    expect(matchesHotkey(key({ key: '1', metaKey: true }), 'ctrl+1', true)).toBe(false)
    expect(matchesHotkey(key({ key: '1', metaKey: true }), 'mod+1', true)).toBe(true)
    expect(matchesHotkey(key({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }), 'ctrl+1', true)).toBe(false)
  })

  it('Windows/Linux: Alt+1 fires alt+1, Ctrl+1 stays mod+1', () => {
    expect(matchesHotkey(key({ key: '1', code: 'Digit1', altKey: true }), 'alt+1', false)).toBe(true)
    expect(matchesHotkey(key({ key: '1', ctrlKey: true }), 'alt+1', false)).toBe(false)
    expect(matchesHotkey(key({ key: '1', ctrlKey: true }), 'mod+1', false)).toBe(true)
    // A user override `ctrl+…` off macOS means Ctrl (= mod).
    expect(matchesHotkey(key({ key: '1', ctrlKey: true }), 'ctrl+1', false)).toBe(true)
  })

  it('⌘J / Ctrl+J and ⌘⇧J / Ctrl+Shift+J', () => {
    expect(matchesHotkey(key({ key: 'j', metaKey: true }), 'mod+j', true)).toBe(true)
    expect(matchesHotkey(key({ key: 'j', ctrlKey: true }), 'mod+j', false)).toBe(true)
    expect(matchesHotkey(key({ key: 'J', metaKey: true, shiftKey: true }), 'mod+shift+j', true)).toBe(true)
    expect(matchesHotkey(key({ key: 'J', ctrlKey: true, shiftKey: true }), 'mod+shift+j', false)).toBe(true)
    expect(matchesHotkey(key({ key: 'J', metaKey: true, shiftKey: true }), 'mod+j', true)).toBe(false)
  })

  it('displays ⌃ on macOS and Ctrl elsewhere', () => {
    expect(formatHotkeyDisplay('ctrl+1', true)).toBe('⌃1')
    expect(formatHotkeyDisplay('alt+1', false)).toBe('Alt+1')
    expect(formatHotkeyDisplay('mod+shift+j', true)).toBe('⌘⇧J')
    expect(formatHotkeyDisplay('mod+shift+j', false)).toBe('Ctrl+Shift+J')
  })
})

describe('flag gating', () => {
  it('every W1-07 action is flag-gated and absent from the shortcut lists', () => {
    expect(W107).toHaveLength(W107_IDS.length)
    for (const action of W107) {
      expect(action.flag).toBeTruthy()
      expect(isActionFlagEnabled(action, new Set())).toBe(false)
      expect(isActionFlagEnabled(action, new Set([action.flag!]))).toBe(true)
    }
    const listed = new Set(actionList.map((action) => action.id))
    const categorized = new Set(Object.values(actionsByCategory).flat().map((action) => action.id))
    for (const id of W107_IDS) {
      expect(listed.has(id)).toBe(false)
      expect(categorized.has(id)).toBe(false)
    }
  })

  it('⌘J is gated by the #1512 agent panel flag (STUB until registered)', () => {
    expect(actions['agent.togglePanel'].flag).toBe('agent.panel.v1')
  })

  it('⌘F takeover: declared once over app.search, active only with docs.shared.v1', () => {
    expect(MODE_AWARE_TAKEOVERS).toEqual([{ chord: 'mod+f', baseActionId: 'app.search', takeoverActionId: 'docs.findInDoc', priority: 20 }])
    const takeover = MODE_AWARE_TAKEOVERS[0]!
    expect(isTakeoverActive(takeover, new Set())).toBe(false)
    expect(isTakeoverActive(takeover, new Set(['docs.shared.v1']))).toBe(true)
    // No second mod+f binding exists.
    expect(ALL.filter((action) => resolveDefaultHotkey(action, true) === 'mod+f').map((action) => action.id)).toEqual(['app.search'])
  })
})
