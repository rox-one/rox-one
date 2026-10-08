/**
 * W1-07 (#1504): global create menu (UI-SPEC §3.2) fed by `global.create`.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { createSlotRegistry } from '../slots'
import {
  CORE_GLOBAL_CREATE_ITEMS,
  GLOBAL_CREATE_OWNER_FLAGS,
  GLOBAL_CREATE_SLOT,
  buildGlobalCreateMenu,
  registerCoreGlobalCreateItems,
  registerGlobalCreateItems,
  runGlobalCreateIntent,
  setGlobalCreateCommandDispatcher,
} from '../global-create'

afterEach(() => setGlobalCreateCommandDispatcher(null))

function seeded() {
  const registry = createSlotRegistry()
  registerCoreGlobalCreateItems(registry)
  return registry
}

describe('global create menu', () => {
  it('flags OFF: only baseline actions, no flagged entry → rail keeps its plain «+»', () => {
    const model = buildGlobalCreateMenu({ flags: new Set() }, seeded())
    expect(model.create.map((entry) => entry.id)).toEqual(['core.new-session', 'tasks.new-task', 'docs.new-doc', 'calendar.new-event'])
    expect(model.tools.map((entry) => entry.id)).toEqual(['core.browser', 'core.terminal'])
    expect(model.hasFlaggedItems).toBe(false)
    expect(model.showMenu).toBe(false)
    expect([...model.create, ...model.tools].every((entry) => !entry.custom)).toBe(true)
    // «Новый документ» collapses to a plain item (only the unflagged Note child).
    expect(model.create.find((entry) => entry.id === 'docs.new-doc')?.children).toEqual([])
  })

  it('flags OFF: an unflagged wave-2/plugin entry still shows the menu', () => {
    const registry = seeded()
    registry.register({
      id: 'wiki.new-page', slot: GLOBAL_CREATE_SLOT, order: 45, source: 'wave2.wiki', titleKey: 'wiki.create.page',
      payload: { intent: { type: 'route', route: 'notes' } },
    })
    const model = buildGlobalCreateMenu({ flags: new Set() }, registry)
    expect(model.hasFlaggedItems).toBe(false)
    expect(model.showMenu).toBe(true)
    expect(model.create.find((entry) => entry.id === 'wiki.new-page')?.custom).toBe(true)
    expect(model.create.find((entry) => entry.id === 'core.new-session')?.custom).toBe(false)
  })

  it('flags OFF: a seed id overridden by another source counts as custom; disposing restores parity', () => {
    const registry = seeded()
    const seed = CORE_GLOBAL_CREATE_ITEMS.find((item) => item.id === 'core.terminal')!
    const override = registry.register({ ...seed, source: 'wave2.terminal' })
    expect(buildGlobalCreateMenu({ flags: new Set() }, registry).showMenu).toBe(true)
    override.dispose()
    expect(buildGlobalCreateMenu({ flags: new Set() }, registry).showMenu).toBe(false)
  })

  it('flags OFF: a hidden (flag-gated) custom entry does not show the menu', () => {
    const registry = seeded()
    registry.register({
      id: 'wiki.new-page', slot: GLOBAL_CREATE_SLOT, source: 'wave2.wiki', titleKey: 'wiki.create.page', flag: 'wiki.v1',
      payload: { intent: { type: 'route', route: 'notes' } },
    })
    expect(buildGlobalCreateMenu({ flags: new Set() }, registry).showMenu).toBe(false)
    expect(buildGlobalCreateMenu({ flags: new Set(['wiki.v1']) }, registry).showMenu).toBe(true)
  })

  it('GlobalCreateMenu swaps the baseline «+» on showMenu', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(import.meta.dir, '../GlobalCreateMenu.tsx'), 'utf8') as string
    expect(src).toContain('if (!model.showMenu) return <>{fallback}</>')
  })

  it('all flags ON: §3.2 order with submenus', () => {
    const flags = new Set<string>([
      WORKBENCH_FLAG.modeMessengerV1, WORKBENCH_FLAG.modeGoalsV1, WORKBENCH_FLAG.modeContactsV1, WORKBENCH_FLAG.docsSharedV1,
      ...Object.values(GLOBAL_CREATE_OWNER_FLAGS),
    ])
    const model = buildGlobalCreateMenu({ flags }, seeded())
    expect(model.create.map((entry) => entry.id)).toEqual([
      'core.new-session', 'messenger.new-message', 'tasks.new-task', 'docs.new-doc', 'calendar.new-event',
      'meetings.new-meeting', 'goals.new-goal', 'goals.new-project', 'spaces.new-space', 'identity.new-team', 'drive.upload',
    ])
    expect(model.tools.map((entry) => entry.id)).toEqual(['contacts.invite', 'core.browser', 'core.terminal'])
    expect(model.hasFlaggedItems).toBe(true)
    expect(model.showMenu).toBe(true)
    const doc = model.create.find((entry) => entry.id === 'docs.new-doc')
    expect(doc?.children.map((child) => child.id)).toEqual([
      'docs.new-doc/doc', 'docs.new-doc/note', 'docs.new-doc/base', 'docs.new-doc/form', 'docs.new-doc/mind-map', 'docs.new-doc/folder',
    ])
    expect(model.create.find((entry) => entry.id === 'messenger.new-message')?.children).toHaveLength(3)
  })

  it('every entry and child title is a surfaces.create.* key', () => {
    for (const item of CORE_GLOBAL_CREATE_ITEMS) {
      expect(item.slot).toBe(GLOBAL_CREATE_SLOT)
      expect(item.titleKey?.startsWith('surfaces.create.')).toBe(true)
      for (const child of item.payload?.children ?? []) expect(child.titleKey.startsWith('surfaces.create.')).toBe(true)
    }
  })

  it('negative: seeding twice does not duplicate; a flagged parent with no visible child and no intent is dropped', () => {
    const registry = seeded()
    registerCoreGlobalCreateItems(registry)
    expect(registry.all(GLOBAL_CREATE_SLOT)).toHaveLength(CORE_GLOBAL_CREATE_ITEMS.length)
    registerGlobalCreateItems([
      { id: 'fake.empty', titleKey: 'surfaces.create.newDoc', source: 'fake', payload: { children: [{ id: 'x', titleKey: 'surfaces.create.docDoc', flag: 'off.v1', intent: { type: 'route', route: 'notes' } }] } },
    ], registry)
    expect(buildGlobalCreateMenu({ flags: new Set() }, registry).create.some((entry) => entry.id === 'fake.empty')).toBe(false)
  })

  it('wave-2 fake: a package replaces a seeded entry by id and adds its own', () => {
    const registry = seeded()
    const handle = registerGlobalCreateItems([
      { id: 'goals.new-goal', order: 70, titleKey: 'surfaces.create.newGoal', flag: WORKBENCH_FLAG.modeGoalsV1, source: 'fake-goals', payload: { intent: { type: 'route', route: 'goals' } } },
      { id: 'fake.new-okr', order: 75, titleKey: 'surfaces.create.newGoal', flag: 'fake.okr.v1', source: 'fake-goals', payload: { intent: { type: 'route', route: 'goals' } } },
    ], registry)
    const model = buildGlobalCreateMenu({ flags: new Set([WORKBENCH_FLAG.modeGoalsV1, 'fake.okr.v1']) }, registry)
    expect(model.create.find((entry) => entry.id === 'goals.new-goal')?.intent).toEqual({ type: 'route', route: 'goals' })
    expect(model.create.map((entry) => entry.id)).toContain('fake.new-okr')
    handle.dispose()
    expect(registry.get(GLOBAL_CREATE_SLOT, 'fake.new-okr')).toBeUndefined()
  })
})

describe('intents', () => {
  it('host intents call the rail handler; route intents navigate', () => {
    const calls: string[] = []
    const deps = { navigate: (route: string) => calls.push(`nav:${route}`), host: { newTask: () => calls.push('newTask') } }
    expect(runGlobalCreateIntent({ type: 'host', handler: 'newTask' }, deps)).toBe(true)
    expect(runGlobalCreateIntent({ type: 'route', route: 'goals' }, deps)).toBe(true)
    expect(calls).toEqual(['newTask', 'nav:goals'])
  })

  it('STUB(#1500): command intents fall back to their route until a dispatcher is set', async () => {
    const calls: string[] = []
    const deps = { navigate: (route: string) => calls.push(`nav:${route}`), host: {} }
    expect(runGlobalCreateIntent({ type: 'command', name: 'goals.create', fallbackRoute: 'goals' }, deps)).toBe(true)
    setGlobalCreateCommandDispatcher(async (name, input) => { calls.push(`cmd:${name}:${JSON.stringify(input ?? null)}`) })
    expect(runGlobalCreateIntent({ type: 'command', name: 'im.create_chat', input: { type: 'group' } }, deps)).toBe(true)
    await Promise.resolve()
    expect(calls).toEqual(['nav:goals', 'cmd:im.create_chat:{"type":"group"}'])
  })

  it('negative: a missing host handler or route-less command reports false', () => {
    const deps = { navigate: () => {}, host: {} }
    expect(runGlobalCreateIntent({ type: 'host', handler: 'terminal' }, deps)).toBe(false)
    expect(runGlobalCreateIntent({ type: 'command', name: 'x.y' }, deps)).toBe(false)
  })
})
