/**
 * W1-07 (#1504) review fixes: surface navigator in AppShell, reactive modes
 * for late registrations, flag-aware shortcut catalogue, Messenger-only quick
 * panels, Docs relabel everywhere, flag-gated create fallbacks.
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStore, getDefaultStore } from 'jotai'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { actions, actionsByCategory } from '@/actions/definitions'
import { actionsByCategoryFor, resolveActionHotkey } from '@/actions/hotkeys'
import { evaluateWhen, snapshotKeybindingContext, type KeybindingContext } from '@/actions/keybinding-context'
import { focusedPanelIdAtom, panelStackAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import type { ActionDefinition } from '@/actions/types'
import { DOCS_RELABEL_TITLE_KEY } from '../modes-seed'
import { __resetModeRegistryForTests, getModeRegistry, registerSeededMode, seededModeProblem } from '../mode-registry-bootstrap'
import { buildRouteTitleKeys, listShellModes, navDestinationLabelKey, notesTitleKey, surfaceTitleKey } from '../surface-shell'
import { modeRegistryStore } from '../useModes'
import { resolveLucideIcon } from '../lucide-icon'
import { isSurfaceActive } from '../surface-activity'
import {
  DEDICATED_FLAG_ATOMS,
  connectShellStore,
  createShellFlagContextKeyProvider,
  currentShellFlags,
  enabledShellFlagsAtom,
  genericFlagIds,
  installShellFlagBridges,
  pushSurfaceRoutesToMain,
  shellFlagBridgeStore,
  workbenchFlagAtom,
} from '../unified-flags'
import { getShellStore, setShellStore } from '../shell-store'
import { isActionFlagEnabled } from '@/actions/hotkeys'
import { featureWorkbenchHarnessAgentTeamsAtom } from '@/atoms/unified-shell'
import { featureEntitiesLinksV1Atom } from '@/atoms/entities-links'
import { panelRouteKey } from '@/components/app-shell/panel-route-key'
import type { NavigationState } from '../../../shared/types'
import { createSlotRegistry } from '../slots'
import {
  GLOBAL_CREATE_OWNER_FLAGS,
  buildGlobalCreateMenu,
  intentRouteFlags,
  registerCoreGlobalCreateItems,
  type GlobalCreateMenuEntry,
} from '../global-create'
import {
  UNIFIED_SURFACE_FLAGS,
  isUnifiedSurfaceId,
  isUnifiedSurfaceRouteEnabled,
  resetUnifiedSurfaceRoutes,
  setUnifiedSurfaceRoutesEnabled,
} from '../../../shared/surface-routes'
import { APP_NAV_DESTINATIONS, APP_NAV_DESTINATIONS_BY_ID } from '@/components/app-shell/nav-destinations'

const rendererDir = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(rendererDir, rel), 'utf8')
const ALL_ACTIONS = Object.values(actions) as ActionDefinition[]
const ctx = (extra: Partial<KeybindingContext> = {}): KeybindingContext =>
  ({ inputFocus: false, chatFocus: false, hasSelection: false, ...extra }) as KeybindingContext

afterEach(() => {
  __resetModeRegistryForTests()
  setShellStore(null)
  resetUnifiedSurfaceRoutes()
  const store = getDefaultStore()
  store.set(panelStackAtom, [])
  store.set(focusedPanelIdAtom, null)
})

const panel = (id: string, route: string): PanelStackEntry =>
  ({ id, route, proportion: 1, panelType: 'other', laneId: 'main' }) as PanelStackEntry

/** Two panels (Messenger + Notes); `focused` picks the focused one. */
function seedPanels(store: Pick<ReturnType<typeof createStore>, 'set'>, focused: 'm' | 'n' | null) {
  store.set(panelStackAtom, [panel('m', 'messenger'), panel('n', 'notes')])
  store.set(focusedPanelIdAtom, focused)
}

const fakeMode = (overrides: Record<string, unknown> = {}) => ({
  contribution: {
    id: 'fake-wiki', titleKey: 'workbench.mode.fakeWiki', icon: 'BookOpen', rootRoute: 'notes',
    order: 52, defaultPinned: true, layoutProfileId: 'agent', when: 'fake.wiki.v1', ...overrides,
  },
  isActive: (nav: { navigator: string }) => nav.navigator === 'notes',
}) as never

describe('AppShell: surface navigator (source contract)', () => {
  const shell = read('components/app-shell/AppShell.tsx')

  it('a surface route is a mode screen: no module middle nav, no navigator', () => {
    const modeScreen = shell.slice(shell.indexOf('const isModeScreenView'), shell.indexOf('const hideModuleMiddleNav'))
    expect(modeScreen).toContain('isSurfaceNavigation(navState)')
    // isModeScreenView → hideModuleMiddleNav covers the navigator slot and width;
    // no redundant isSurfaceNavigation checks there.
    const hide = shell.slice(shell.indexOf('const hideModuleMiddleNav'), shell.indexOf('// Derive source filter'))
    expect(hide).toContain('isModeScreenView')
    expect(hide).not.toContain('isSurfaceNavigation')
    expect(shell).toMatch(/navigatorSlot=\{\([^?]*hideModuleMiddleNav\)/)
    expect(shell).toMatch(/navigatorWidth=\{[^?]*hideModuleMiddleNav/)
    expect(shell).not.toMatch(/navigatorSlot=\{\([^?]*isSurfaceNavigation/)
    expect(shell).not.toMatch(/navigatorWidth=\{[^?]*isSurfaceNavigation/)
  })

  it('header title: workbench.mode.<surface>, Notes relabelled under docs.shared.v1', () => {
    expect(shell).toContain('t(surfaceTitleKey(navState.surface))')
    expect(shell).toContain('notesTitleKey(shellFlags, "sidebar.notes")')
  })
})

describe('shell title helpers', () => {
  it('surface and Notes title keys', () => {
    expect(surfaceTitleKey('messenger')).toBe('workbench.mode.messenger')
    expect(notesTitleKey(new Set(), 'sidebar.notes')).toBe('sidebar.notes')
    expect(notesTitleKey(new Set([WORKBENCH_FLAG.docsSharedV1]), 'sidebar.notes')).toBe(DOCS_RELABEL_TITLE_KEY)
  })

  it('tab titles follow the Docs relabel and late registrations', () => {
    const titles = (flags: ReadonlySet<string>) =>
      buildRouteTitleKeys({ destinations: [], modes: listShellModes(getModeRegistry(), {}, flags), extraScreens: [] })
    expect(titles(new Set()).get('notes')).toBe('workbench.mode.notes')
    expect(titles(new Set([WORKBENCH_FLAG.docsSharedV1])).get('notes')).toBe(DOCS_RELABEL_TITLE_KEY)
    expect(titles(new Set()).has('messenger')).toBe(false)
    expect(titles(new Set([WORKBENCH_FLAG.modeMessengerV1])).get('messenger')).toBe('workbench.mode.messenger')
    registerSeededMode(fakeMode({ id: 'fake-board', titleKey: 'workbench.mode.fakeBoard', rootRoute: 'fake-board' }))
    expect(titles(new Set(['fake.wiki.v1'])).get('fake-board')).toBe('workbench.mode.fakeBoard')
  })

  it('consumers read the shared reactive list (no static useMemo([]) map)', () => {
    expect(read('platform/SurfaceTabs.tsx')).toContain('buildRouteTitleKeys(')
    expect(read('platform/SurfaceTabs.tsx')).not.toContain('UNIFIED_MODES')
    expect(read('platform/useModeHotkeys.ts')).toContain('useShellModes()')
    expect(read('platform/ModeBar.tsx')).toContain('resolveLucideIcon(mode.icon) ?? MODE_ICONS[mode.icon]')
  })
})

describe('late mode registration', () => {
  it('registerSeededMode notifies the store behind useShellModes', () => {
    let calls = 0
    const unsubscribe = modeRegistryStore.subscribe(() => calls++)
    const before = modeRegistryStore.getSnapshot()
    const handle = registerSeededMode(fakeMode())
    expect(modeRegistryStore.getSnapshot()).toBeGreaterThan(before)
    expect(calls).toBeGreaterThan(0)
    handle.dispose()
    unsubscribe()
  })

  it('registration icons resolve from Lucide by name', () => {
    expect(resolveLucideIcon('BookOpen')).not.toBeNull()
    expect(resolveLucideIcon('NoSuchIconName')).toBeNull()
  })

  it('negative: a wave-2 mode without a usable rootRoute or isActive is rejected', () => {
    expect(seededModeProblem(fakeMode())).toBeNull()
    expect(() => registerSeededMode(fakeMode({ rootRoute: null }))).toThrow(/rootRoute/)
    expect(() => registerSeededMode(fakeMode({ rootRoute: '  ' }))).toThrow(/rootRoute/)
    expect(() => registerSeededMode(fakeMode({ rootRoute: 'rox://notes' }))).toThrow(/rootRoute/)
    expect(() => registerSeededMode(fakeMode({ id: 'Bad Id' }))).toThrow(/id/)
    expect(() => registerSeededMode({ contribution: (fakeMode() as { contribution: object }).contribution } as never)).toThrow(/isActive/)
    expect(getModeRegistry().list({ 'fake.wiki.v1': true }).some((mode) => mode.id === 'fake-wiki')).toBe(false)
  })
})

describe('flag-aware shortcut catalogue', () => {
  const ids = (grouped: Record<string, ActionDefinition[]>) => Object.values(grouped).flat().map((action) => action.id)

  it('flags off: equals the static baseline lists', () => {
    expect(actionsByCategoryFor(ALL_ACTIONS, new Set())).toEqual(actionsByCategory)
  })

  it('flag on: its actions appear (quick panels, find in doc)', () => {
    const messenger = ids(actionsByCategoryFor(ALL_ACTIONS, new Set([WORKBENCH_FLAG.modeMessengerV1])))
    expect(messenger).toContain('messenger.quickPanelDocs')
    expect(messenger).not.toContain('docs.findInDoc')
    const docs = ids(actionsByCategoryFor(ALL_ACTIONS, new Set([WORKBENCH_FLAG.docsSharedV1])))
    expect(docs).toContain('docs.findInDoc')
  })

  it('flagged actions are rebindable through registry overrides', () => {
    const quick = actions['messenger.quickPanelDocs'] as ActionDefinition
    expect(resolveActionHotkey(quick, new Map(), true)).toBe('ctrl+1')
    expect(resolveActionHotkey(quick, new Map(), false)).toBe('alt+1')
    expect(resolveActionHotkey(quick, new Map([[quick.id, 'mod+alt+d']]), true)).toBe('mod+alt+d')
    expect(resolveActionHotkey(quick, new Map([[quick.id, null]]), false)).toBeNull()
  })

  it('every shortcut page uses the flag-aware hook', () => {
    for (const file of ['pages/settings/ShortcutsPage.tsx', 'pages/ShortcutsPage.tsx', 'components/KeyboardShortcuts.tsx', 'components/KeyboardShortcutsDialog.tsx']) {
      expect(read(file)).toContain('const actionsByCategory = useActionsByCategory()')
    }
  })
})

describe('quick panels are Messenger-only (UI-SPEC §15)', () => {
  const QUICK = ['messenger.quickPanelDocs', 'messenger.quickPanelTasks', 'messenger.quickPanelCalendar', 'messenger.quickPanelContacts'] as const

  it('carry when: messengerActive', () => {
    for (const id of QUICK) expect((actions[id] as ActionDefinition).when).toBe('messengerActive')
  })

  it('messengerActive follows the focused panel, not a mounted (hidden) one', () => {
    setUnifiedSurfaceRoutesEnabled(['messenger'])
    const store = createStore()
    expect(isSurfaceActive('messenger', store)).toBe(false)
    seedPanels(store, 'm')
    expect(isSurfaceActive('messenger', store)).toBe(true)
    expect(isSurfaceActive('calendar', store)).toBe(false)
    // Messenger stays mounted (hidden) after focus moves to Notes.
    seedPanels(store, 'n')
    expect(isSurfaceActive('messenger', store)).toBe(false)
  })

  it('negative: a closed mode gate never counts as Messenger', () => {
    const store = createStore()
    seedPanels(store, 'm')
    expect(isSurfaceActive('messenger', store)).toBe(false)
  })

  it('the keymap context reads the focused panel from the connected Provider store', () => {
    const provider = createStore()
    const disconnect = connectShellStore(provider)
    provider.set(workbenchFlagAtom(WORKBENCH_FLAG.modeMessengerV1), true)
    seedPanels(provider, 'm')
    expect(evaluateWhen('messengerActive', snapshotKeybindingContext())).toBe(true)
    seedPanels(provider, 'n')
    expect(evaluateWhen('messengerActive', snapshotKeybindingContext())).toBe(false)
    // The default store's panel stack is irrelevant once connected.
    seedPanels(getDefaultStore(), 'm')
    expect(evaluateWhen('messengerActive', snapshotKeybindingContext())).toBe(false)
    disconnect()
  })

  it('messengerActive is lazy: not computed unless a when-clause reads it, then memoised', () => {
    const provider = createStore()
    const disconnect = connectShellStore(provider)
    provider.set(workbenchFlagAtom(WORKBENCH_FLAG.modeMessengerV1), true)
    seedPanels(provider, 'n')
    const kb = snapshotKeybindingContext()
    // Baseline bindings never read it (flags-off keydown cost = main).
    expect(evaluateWhen('!inputFocus', kb)).toBe(true)
    expect(evaluateWhen(undefined, kb)).toBe(true)
    // Focus moves to Messenger AFTER the snapshot: a lazy getter sees it.
    seedPanels(provider, 'm')
    expect(evaluateWhen('messengerActive', kb)).toBe(true)
    // …and memoises it for the rest of this keydown.
    seedPanels(provider, 'n')
    expect(kb.messengerActive).toBe(true)
    expect(Object.keys(kb)).toContain('messengerActive')
    disconnect()
  })

  it('the omnibox context provider exposes messengerActive for its store', () => {
    setUnifiedSurfaceRoutesEnabled(['messenger'])
    const store = createStore()
    const provider = createShellFlagContextKeyProvider(store)
    expect(provider.keys).toContain('messengerActive')
    expect(provider.pull().messengerActive).toBe(false)
    seedPanels(store, 'm')
    expect(provider.pull().messengerActive).toBe(true)
    seedPanels(store, 'n')
    expect(provider.pull().messengerActive).toBe(false)
  })

  it('SurfaceHost no longer marks itself (mount ≠ active)', () => {
    expect(read('platform/SurfaceHost.tsx')).not.toContain('markSurfaceMounted')
    expect(read('actions/keybinding-context.ts')).toContain("isSurfaceActive('messenger')")
  })
})

describe('global create: keys and fallback route gates', () => {
  const seeded = () => {
    const registry = createSlotRegistry()
    registerCoreGlobalCreateItems(registry)
    return registry
  }
  const walk = (entries: GlobalCreateMenuEntry[]): GlobalCreateMenuEntry[] => entries.flatMap((entry) => [entry, ...walk(entry.children)])

  it('GlobalCreateMenu passes flag context keys', () => {
    expect(read('platform/GlobalCreateMenu.tsx')).toContain('buildGlobalCreateMenu({ flags, keys: flagContextKeys(flags) })')
  })

  it('owner flag without its mode flag: no entry falls back into a closed mode', () => {
    const flags = new Set<string>(Object.values(GLOBAL_CREATE_OWNER_FLAGS))
    const model = buildGlobalCreateMenu({ flags }, seeded())
    const ids = walk([...model.create, ...model.tools]).map((entry) => entry.id)
    expect(ids).not.toContain('spaces.new-space')
    expect(ids).not.toContain('identity.new-team')
  })

  it('any flag set: every visible fallback route is open for that flag set', () => {
    const owner = Object.values(GLOBAL_CREATE_OWNER_FLAGS)
    const modes = Object.values(UNIFIED_SURFACE_FLAGS)
    const sets = [new Set<string>(), new Set(owner), new Set(modes), new Set([...owner, ...modes]), new Set([...owner, WORKBENCH_FLAG.modeGoalsV1])]
    for (const flags of sets) {
      const model = buildGlobalCreateMenu({ flags }, seeded())
      for (const entry of walk([...model.create, ...model.tools])) {
        for (const flag of intentRouteFlags(entry.intent)) expect(flags.has(flag)).toBe(true)
        const route = entry.intent?.type === 'command' ? entry.intent.fallbackRoute : undefined
        if (route && isUnifiedSurfaceId(route)) expect(flags.has(UNIFIED_SURFACE_FLAGS[route])).toBe(true)
      }
    }
    const ids = walk(buildGlobalCreateMenu({ flags: new Set([...owner, WORKBENCH_FLAG.modeGoalsV1]) }, seeded()).create).map((e) => e.id)
    expect(ids).toContain('spaces.new-space')
  })

  it('a wave-2 entry whose route targets a closed mode is dropped', () => {
    expect(intentRouteFlags({ type: 'route', route: 'calendar?d=1' })).toEqual([WORKBENCH_FLAG.modeCalendarV1])
    expect(intentRouteFlags({ type: 'command', name: 'x', fallbackRoute: 'notes' })).toEqual([])
    const registry = createSlotRegistry()
    registry.register({ id: 'pkg.cal', slot: 'global.create', source: 'pkg', titleKey: 'surfaces.create.newEvent', payload: { group: 'create', intent: { type: 'route', route: 'calendar' } } })
    expect(buildGlobalCreateMenu({ flags: new Set() }, registry).create).toEqual([])
    const on = buildGlobalCreateMenu({ flags: new Set([WORKBENCH_FLAG.modeCalendarV1]) }, registry)
    expect(on.create.map((entry) => entry.id)).toEqual(['pkg.cal'])
    expect(on.hasFlaggedItems).toBe(true)
  })
})

describe('surface gate → main', () => {
  it('push is a safe no-op without an Electron bridge', () => {
    expect(() => pushSurfaceRoutesToMain(['messenger'])).not.toThrow()
  })

  it('a failed push is logged, not swallowed', async () => {
    const g = globalThis as { window?: unknown }
    const hadWindow = 'window' in g
    const prevWindow = g.window
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      g.window = { electronAPI: { setUnifiedSurfaceRoutesEnabled: () => Promise.reject(new Error('No handler registered')) } }
      pushSurfaceRoutesToMain(['messenger'])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('surface route gate push to main failed')
      warn.mockClear()
      g.window = { electronAPI: { setUnifiedSurfaceRoutesEnabled: () => { throw new Error('boom') } } }
      expect(() => pushSurfaceRoutesToMain([])).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
      if (hadWindow) g.window = prevWindow
      else delete g.window
    }
  })

  it('the bridge pushes the enabled surfaces when flags change', () => {
    const src = read('platform/unified-flags.ts')
    expect(src).toContain('pushSurfaceRoutesToMain(ids)')
    expect(src).toContain('setUnifiedSurfaceRoutesEnabled?.(')
    // the atom used by the bridge exists for every unified flag
    for (const flag of Object.values(UNIFIED_SURFACE_FLAGS)) expect(workbenchFlagAtom(flag)).toBeDefined()
  })
})

describe('W1-07 gates read the <JotaiProvider> store (main.tsx unchanged)', () => {
  it('main.tsx keeps the baseline Provider (no store prop) and mounts the bridge', () => {
    const main = read('main.tsx')
    expect(main).toContain('<JotaiProvider>')
    expect(main).not.toMatch(/<JotaiProvider[^>]*store=/)
    expect(main).not.toContain('getDefaultStore')
    expect(main).toContain('<ShellStoreBridge />')
    const bridge = read('platform/ShellStoreBridge.tsx')
    expect(bridge).toContain('const store = useStore()')
    expect(bridge).toContain('useLayoutEffect(() => connectShellStore(store), [store])')
  })

  it('gates outside React use the shell store; baseline Omnibox providers keep getDefaultStore()', () => {
    expect(read('actions/registry.tsx')).toContain('shellFlags ??= currentShellFlags()')
    expect(read('actions/registry.tsx')).not.toContain('getDefaultStore')
    expect(read('actions/shell-shortcuts.ts')).toContain('isTakeoverActive(takeover, currentShellFlags())')
    expect(read('actions/shell-shortcuts.ts')).not.toContain('getDefaultStore')
    expect(read('platform/surface-activity.ts')).toContain('store: StoreReader = getShellStore()')
    const bootstrap = read('platform/omnibox-bootstrap.ts')
    expect(bootstrap).toContain('getFlags: () => currentShellFlags()')
    expect(bootstrap).toContain('const store = getDefaultStore()')
    expect(bootstrap).toContain('() => Array.from(store.get(sessionMetaMapAtom).values())')
    expect(read('platform/OmniboxHost.tsx')).toContain('const store = getDefaultStore()')
  })

  it('a runtime flag flip in the Provider store updates the route gate and the hotkey gate', () => {
    const provider = createStore()
    const quick = actions['messenger.quickPanelDocs'] as ActionDefinition
    installShellFlagBridges(getDefaultStore())
    const disconnect = connectShellStore(provider)
    expect(getShellStore()).toBe(provider)
    expect(shellFlagBridgeStore()).toBe(provider)
    expect(isUnifiedSurfaceRouteEnabled('messenger')).toBe(false)
    expect(isActionFlagEnabled(quick, currentShellFlags())).toBe(false)

    provider.set(workbenchFlagAtom(WORKBENCH_FLAG.modeMessengerV1), true)
    expect(isUnifiedSurfaceRouteEnabled('messenger')).toBe(true)
    expect(isActionFlagEnabled(quick, currentShellFlags())).toBe(true)
    // The default store did not change and no longer drives the gate.
    expect(getDefaultStore().get(enabledShellFlagsAtom).has(WORKBENCH_FLAG.modeMessengerV1)).toBe(false)
    getDefaultStore().set(workbenchFlagAtom(WORKBENCH_FLAG.modeCalendarV1), true)
    expect(isUnifiedSurfaceRouteEnabled('calendar')).toBe(false)
    getDefaultStore().set(workbenchFlagAtom(WORKBENCH_FLAG.modeCalendarV1), false)

    provider.set(workbenchFlagAtom(WORKBENCH_FLAG.modeMessengerV1), false)
    expect(isUnifiedSurfaceRouteEnabled('messenger')).toBe(false)
    expect(isActionFlagEnabled(quick, currentShellFlags())).toBe(false)

    disconnect()
    expect(getShellStore()).toBe(getDefaultStore())
    expect(shellFlagBridgeStore()).toBeNull()
  })

  it('the Omnibox shell-flag provider resolves the store per pull (created before connect)', () => {
    const omnibox = createShellFlagContextKeyProvider()
    const provider = createStore()
    const disconnect = connectShellStore(provider)
    expect(omnibox.pull()[WORKBENCH_FLAG.modeMessengerV1]).toBe(false)
    provider.set(workbenchFlagAtom(WORKBENCH_FLAG.modeMessengerV1), true)
    expect(omnibox.pull()[WORKBENCH_FLAG.modeMessengerV1]).toBe(true)
    disconnect()
  })
})

describe('panel route key resets per unified surface', () => {
  const ctx = { activeWorkspaceId: 'ws1', unavailableWorkspaceSlug: null, activeSessionWorkingDirectory: null }
  const surface = (id: string) => ({ navigator: 'surface', surface: id, details: null }) as unknown as NavigationState

  it('messenger, calendar, goals and contacts get distinct keys', () => {
    const keys = ['messenger', 'calendar', 'goals', 'contacts'].map((id) => panelRouteKey(surface(id), ctx))
    expect(new Set(keys).size).toBe(4)
  })

  it('every non-surface key is byte-identical to the baseline array', () => {
    const notes = { navigator: 'notes', details: null } as unknown as NavigationState
    expect(panelRouteKey(notes, ctx)).toBe(JSON.stringify(['ws1', null, 'notes', null, null, null, null, null, null, null, null]))
    expect(read('components/app-shell/MainContentPanel.tsx')).toContain('const routeKey = panelRouteKey(navState, {')
  })
})

describe('dedicated flag atoms report their real value', () => {
  it('harnessAgentTeams follows its Appearance atom in the shell flags and Omnibox keys', () => {
    const id = WORKBENCH_FLAG.harnessAgentTeams
    expect(DEDICATED_FLAG_ATOMS.get(id)).toBe(featureWorkbenchHarnessAgentTeamsAtom)
    expect(genericFlagIds()).not.toContain(id)
    const store = createStore()
    const omnibox = createShellFlagContextKeyProvider(store)
    expect(omnibox.keys).toContain(id)
    store.set(featureWorkbenchHarnessAgentTeamsAtom, true)
    expect(store.get(enabledShellFlagsAtom).has(id)).toBe(true)
    expect(omnibox.pull()[id]).toBe(true)
    store.set(featureWorkbenchHarnessAgentTeamsAtom, false)
    expect(store.get(enabledShellFlagsAtom).has(id)).toBe(false)
    expect(omnibox.pull()[id]).toBe(false)
  })
})

describe('entities.links.v1 reuses the #1499 renderer atom', () => {
  it('maps to featureEntitiesLinksV1Atom and reports its real value', () => {
    const id = WORKBENCH_FLAG.entitiesLinksV1
    expect(DEDICATED_FLAG_ATOMS.get(id)).toBe(featureEntitiesLinksV1Atom)
    expect(genericFlagIds()).not.toContain(id)
    expect(read('platform/unified-flags.ts')).not.toContain('workbenchFlagAtom(WORKBENCH_FLAG.entitiesLinksV1)')
    const store = createStore()
    const omnibox = createShellFlagContextKeyProvider(store)
    expect(store.get(enabledShellFlagsAtom).has(id)).toBe(false)
    expect(omnibox.pull()[id]).toBe(false)
    store.set(featureEntitiesLinksV1Atom, true)
    expect(store.get(enabledShellFlagsAtom).has(id)).toBe(true)
    expect(omnibox.pull()[id]).toBe(true)
  })
})

describe('global create menu icons and flags', () => {
  it('icons resolve through resolveLucideIcon (helpers never render)', () => {
    const menu = read('platform/GlobalCreateMenu.tsx')
    expect(menu).toContain('resolveLucideIcon(entry.icon)')
    expect(menu).not.toContain('function iconFor')
    expect(menu).not.toContain("from 'lucide-react'")
    expect(resolveLucideIcon('Plus')).not.toBeNull()
    expect(resolveLucideIcon('createLucideIcon')).toBeNull()
    expect(resolveLucideIcon('icons')).toBeNull()
  })

  it('hasFlag is flagList(flag).length > 0', () => {
    expect(read('platform/global-create.ts')).toContain('return flagList(flag).length > 0')
  })
})

describe('«Документы» relabel reaches every Notes label', () => {
  const docsOn = new Set<string>([WORKBENCH_FLAG.docsSharedV1])

  it('nav destinations: only Notes is relabelled, only with docs.shared.v1', () => {
    expect(navDestinationLabelKey(APP_NAV_DESTINATIONS_BY_ID.notes, new Set())).toBe('sidebar.notes')
    expect(navDestinationLabelKey(APP_NAV_DESTINATIONS_BY_ID.notes, docsOn)).toBe(DOCS_RELABEL_TITLE_KEY)
    for (const dest of APP_NAV_DESTINATIONS) {
      if (dest.id === 'notes') continue
      expect(navDestinationLabelKey(dest, docsOn)).toBe(dest.labelKey)
      expect(navDestinationLabelKey(dest, new Set())).toBe(dest.labelKey)
    }
  })

  it('rail, inspector, compact menu and sidebar link use the flag-aware key', () => {
    // The rail renders the seven core modes (not APP_NAV_DESTINATIONS), so its
    // Notes title is relabelled through the flag-aware `resolveSeededModes(…,
    // shellFlags)`; pinned end-to-end by the «docs.shared.v1 relabels the rail
    // Notes mode» render case in w1-07-rail-modes.test.tsx.
    const rail = read('platform/ActivityRail.tsx')
    expect(rail).toContain('const { shellFlags } = useShellModes()')
    expect(rail).toContain('modeFlags,\n    shellFlags,')
    expect(read('platform/InspectorHost.tsx')).toContain('t(navDestinationLabelKey(destination, shellFlags))')
    const compact = read('components/app-shell/CompactWorkspaceMenu.tsx')
    expect(compact).toContain('t(navDestinationLabelKey(service, shellFlags))')
    expect(compact).toContain('t(navDestinationLabelKey(destination, shellFlags))')
    expect(read('components/app-shell/AppShell.tsx')).toContain('t(notesTitleKey(shellFlags, APP_NAV_DESTINATIONS_BY_ID.notes.labelKey))')
  })

  it('pages naming Notes go through useNotesTitleKey', () => {
    const cases: Array<[string, string]> = [
      ['knowledge/KnowledgeHome.tsx', "useNotesTitleKey('sidebar.notes')"],
      ['pages/settings/AccountsSettingsPage.tsx', "useNotesTitleKey('sidebar.notes')"],
      ['pages/NotesPage.tsx', "useNotesTitleKey('notes.header.title')"],
      ['pages/notes/NotesDocumentChrome.tsx', "useNotesTitleKey('notes.breadcrumb.vault')"],
      ['platform/home/widgets.tsx', "useNotesTitleKey('workbench.home.w.notes')"],
      ['pages/SearchPage.tsx', "useNotesTitleKey('searchPage.notes')"],
      ['pages/settings/PreferencesPage.tsx', "useNotesTitleKey('settings.preferences.notes')"],
    ]
    for (const [file, hook] of cases) {
      const src = read(file)
      expect(src).toContain(hook)
      const key = hook.slice(hook.indexOf("'") + 1, hook.lastIndexOf("'"))
      expect(src).not.toContain(`t('${key}')`)
    }
  })
})
