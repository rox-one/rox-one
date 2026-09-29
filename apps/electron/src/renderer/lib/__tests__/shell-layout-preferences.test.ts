import { describe, expect, it } from 'bun:test'
import type { StorageKey } from '../local-storage'
import {
  NAVIGATOR_WIDTH_DEFAULT,
  SHELL_LAYOUT_KEYBOARD_DEBOUNCE_MS,
  SIDEBAR_WIDTH_DEFAULT,
  SIDE_PANEL_DEFAULT_WIDTH,
  migrateSidePanelDefaults,
  SIDEBAR_WIDTH_MAX,
  clampNavigatorWidth,
  clampSidebarWidth,
  commitShellLayout,
  createLayoutCommitDebouncer,
  effectiveSidebarWidth,
  loadShellLayout,
  parseShellLayout,
  type ShellLayoutStore,
} from '../shell-layout-preferences'

function memoryStore(seed: Record<string, unknown> = {}): ShellLayoutStore & { writes: string[]; data: Record<string, unknown> } {
  const data = { ...seed }
  const writes: string[] = []
  const keyOf = (key: StorageKey, suffix?: string) => (suffix ? `${key}:${suffix}` : key)
  return {
    data,
    writes,
    get<T>(key: StorageKey, fallback: T, suffix?: string): T {
      const slot = keyOf(key, suffix)
      return (slot in data ? data[slot] : fallback) as T
    },
    set<T>(key: StorageKey, value: T, suffix?: string): void {
      const slot = keyOf(key, suffix)
      data[slot] = value
      writes.push(slot)
    },
  }
}

describe('shell layout preferences (ZS-06)', () => {
  it('clamps sidebar 180–360 and navigator 240–480', () => {
    expect(clampSidebarWidth(100)).toBe(180)
    expect(clampSidebarWidth(400)).toBe(SIDEBAR_WIDTH_MAX)
    expect(clampNavigatorWidth(100)).toBe(240)
    expect(clampNavigatorWidth(900)).toBe(480)
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('migrates legacy keys without deleting them', () => {
    const store = memoryStore({
      'sidebar-width': 250,
      'session-list-width': 310,
      'collapsed-sidebar-items:ws-1': ['nav:status'],
    })
    const loaded = loadShellLayout('ws-1', store)
    expect(loaded.schemaVersion).toBe(1)
    expect(loaded.sidebarWidth).toBe(250)
    expect(loaded.navigatorWidth).toBe(310)
    expect(loaded.collapsedSectionIds).toEqual(['nav:status'])
    expect(store.data['sidebar-width']).toBe(250)
    expect(store.data['session-list-width']).toBe(310)
  })

  it('commit dual-writes snapshot and legacy keys; preview is not a write', () => {
    const store = memoryStore()
    const loaded = loadShellLayout('ws-a', store)
    expect(loaded.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(loaded.navigatorWidth).toBe(NAVIGATOR_WIDTH_DEFAULT)
    expect(store.writes).toEqual([])

    const committed = commitShellLayout({ workspaceId: 'ws-a', sidebarWidth: 300 }, store)
    expect(committed.sidebarWidth).toBe(300)
    expect(store.data['shell-layout-v1:ws-a']).toMatchObject({ schemaVersion: 1, sidebarWidth: 300 })
    expect(store.data['sidebar-width']).toBe(300)
    expect(store.data['session-list-width']).toBe(NAVIGATOR_WIDTH_DEFAULT)
    expect(store.writes.filter((k) => k === 'sidebar-width').length).toBe(1)
  })

  it('rejects foreign workspace snapshots and extra schema versions', () => {
    expect(parseShellLayout({ schemaVersion: 1, workspaceId: 'other', sidebarWidth: 200, navigatorWidth: 300, collapsedSectionIds: [] }, 'mine')).toBeNull()
    expect(parseShellLayout({ schemaVersion: 2, workspaceId: 'mine' }, 'mine')).toBeNull()
    expect(parseShellLayout({ url: '/chat/secret' }, 'mine')).toBeNull()
  })

  it('treats a tight-window clamp as derived effective width, not a new preference', () => {
    expect(effectiveSidebarWidth(360, 200)).toBe(200)
    expect(effectiveSidebarWidth(220, 2000)).toBe(220)
  })

  it('keyboard debounce is 250ms and cancel prevents the write', async () => {
    expect(SHELL_LAYOUT_KEYBOARD_DEBOUNCE_MS).toBe(250)
    let commits = 0
    const debounce = createLayoutCommitDebouncer(() => { commits += 1 }, 20)
    debounce.schedule()
    debounce.schedule()
    debounce.cancel()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(commits).toBe(0)
    debounce.schedule()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(commits).toBe(1)
  })

  it('two workspaces keep independent snapshots', () => {
    const store = memoryStore()
    commitShellLayout({ workspaceId: 'a', sidebarWidth: 200 }, store)
    commitShellLayout({ workspaceId: 'b', sidebarWidth: 330 }, store)
    expect(loadShellLayout('a', store).sidebarWidth).toBe(200)
    expect(loadShellLayout('b', store).sidebarWidth).toBe(330)
  })
})

describe('side panel defaults (layout v2)', () => {
  it('left sidebar and right inspector share one default width', async () => {
    expect(SIDEBAR_WIDTH_DEFAULT).toBe(SIDE_PANEL_DEFAULT_WIDTH)
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const atoms = readFileSync(join(import.meta.dir, '..', '..', 'atoms', 'unified-shell.ts'), 'utf8')
    expect(atoms).toMatch(/inspectorPanelWidthAtom = atomWithStorage<number>\(\s*getKeyString\(KEYS\.inspectorPanelWidth\),\s*SIDE_PANEL_DEFAULT_WIDTH,/)
  })

  it('narrows wider stored widths once, keeps narrower ones, expands the rail', () => {
    const store = memoryStore({
      'sidebar-width': 360,
      'inspector-panel-width': 1205,
      'activity-rail-collapsed': true,
    })
    expect(migrateSidePanelDefaults(store)).toBe(true)
    expect(store.data['sidebar-width']).toBe(SIDE_PANEL_DEFAULT_WIDTH)
    expect(store.data['inspector-panel-width']).toBe(SIDE_PANEL_DEFAULT_WIDTH)
    expect(store.data['activity-rail-collapsed']).toBe(false)
    // Later user resizes stick: the migration never runs again.
    store.data['sidebar-width'] = 350
    store.data['activity-rail-collapsed'] = true
    expect(migrateSidePanelDefaults(store)).toBe(false)
    expect(store.data['sidebar-width']).toBe(350)
    expect(store.data['activity-rail-collapsed']).toBe(true)
    expect(loadShellLayout(null, store).sidebarWidth).toBe(350)
  })

  it('leaves narrower user widths and fresh installs untouched', () => {
    const narrow = memoryStore({ 'sidebar-width': 200, 'inspector-panel-width': 300 })
    migrateSidePanelDefaults(narrow)
    expect(narrow.data['sidebar-width']).toBe(200)
    expect(narrow.data['inspector-panel-width']).toBe(300)
    const fresh = memoryStore()
    migrateSidePanelDefaults(fresh)
    expect(fresh.data['sidebar-width']).toBeUndefined()
    expect(loadShellLayout(null, fresh).sidebarWidth).toBe(SIDE_PANEL_DEFAULT_WIDTH)
  })
})
