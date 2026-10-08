/**
 * W1-07 (#1504) review fixes: surface navigator in AppShell, reactive modes
 * for late registrations, flag-aware shortcut catalogue, Messenger-only quick
 * panels, Docs relabel everywhere, flag-gated create fallbacks.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStore } from 'jotai'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { actions, actionsByCategory } from '@/actions/definitions'
import { actionsByCategoryFor, resolveActionHotkey } from '@/actions/hotkeys'
import { evaluateWhen, type KeybindingContext } from '@/actions/keybinding-context'
import type { ActionDefinition } from '@/actions/types'
import { DOCS_RELABEL_TITLE_KEY } from '../modes-seed'
import { __resetModeRegistryForTests, getModeRegistry, registerSeededMode, seededModeProblem } from '../mode-registry-bootstrap'
import { buildRouteTitleKeys, listShellModes, notesTitleKey, surfaceTitleKey } from '../surface-shell'
import { modeRegistryStore } from '../useModes'
import { resolveLucideIcon } from '../lucide-icon'
import { __resetSurfaceActivityForTests, isSurfaceMounted, markSurfaceMounted } from '../surface-activity'
import { createShellFlagContextKeyProvider, pushSurfaceRoutesToMain, workbenchFlagAtom } from '../unified-flags'
import { createSlotRegistry } from '../slots'
import {
  GLOBAL_CREATE_OWNER_FLAGS,
  buildGlobalCreateMenu,
  intentRouteFlags,
  registerCoreGlobalCreateItems,
  type GlobalCreateMenuEntry,
} from '../global-create'
import { UNIFIED_SURFACE_FLAGS, isUnifiedSurfaceId } from '../../../shared/surface-routes'

const rendererDir = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(rendererDir, rel), 'utf8')
const ALL_ACTIONS = Object.values(actions) as ActionDefinition[]
const ctx = (extra: Partial<KeybindingContext> = {}): KeybindingContext =>
  ({ inputFocus: false, chatFocus: false, hasSelection: false, ...extra }) as KeybindingContext

afterEach(() => {
  __resetModeRegistryForTests()
  __resetSurfaceActivityForTests()
})

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

  it('messengerActive follows the mounted Messenger surface', () => {
    expect(evaluateWhen('messengerActive', ctx({ messengerActive: isSurfaceMounted('messenger') }))).toBe(false)
    const unmark = markSurfaceMounted('messenger')
    expect(evaluateWhen('messengerActive', ctx({ messengerActive: isSurfaceMounted('messenger') }))).toBe(true)
    unmark()
    unmark()
    expect(isSurfaceMounted('messenger')).toBe(false)
  })

  it('the omnibox context provider exposes messengerActive', () => {
    const provider = createShellFlagContextKeyProvider(createStore())
    expect(provider.keys).toContain('messengerActive')
    expect(provider.pull().messengerActive).toBe(false)
    const unmark = markSurfaceMounted('messenger')
    expect(provider.pull().messengerActive).toBe(true)
    unmark()
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

  it('the bridge pushes the enabled surfaces when flags change', () => {
    const src = read('platform/unified-flags.ts')
    expect(src).toContain('pushSurfaceRoutesToMain(ids)')
    expect(src).toContain('setUnifiedSurfaceRoutesEnabled?.(')
    // the atom used by the bridge exists for every unified flag
    for (const flag of Object.values(UNIFIED_SURFACE_FLAGS)) expect(workbenchFlagAtom(flag)).toBeDefined()
  })
})
