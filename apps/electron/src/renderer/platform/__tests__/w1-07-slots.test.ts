/**
 * W1-07 (#1504): slot registry — ordering, dedupe, flag/when gating, reserved
 * ids, negative cases, and a wave-2 fake contribution.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import {
  RESERVED_SLOT_PATTERNS,
  SLOT_CATALOGUE,
  __resetSlotRegistryForTests,
  createSlotRegistry,
  getSlotRegistry,
  isSlotId,
  reservedSlotOwner,
  slotKind,
  type SlotContribution,
  type SlotId,
} from '../slots'

const NONE = { flags: new Set<string>() }
const ids = (list: SlotContribution[]) => list.map((entry) => entry.id)

afterEach(() => __resetSlotRegistryForTests())

describe('slot registry ordering', () => {
  it('sorts by order, then id; missing order goes last (1000)', () => {
    const registry = createSlotRegistry()
    registry.register({ id: 'b.two', slot: 'goals.tabs', order: 20, source: 't' })
    registry.register({ id: 'z.default', slot: 'goals.tabs', source: 't' })
    registry.register({ id: 'a.two', slot: 'goals.tabs', order: 20, source: 't' })
    registry.register({ id: 'c.one', slot: 'goals.tabs', order: 10, source: 't' })
    expect(ids(registry.list('goals.tabs', NONE))).toEqual(['c.one', 'a.two', 'b.two', 'z.default'])
  })

  it('keeps slots independent', () => {
    const registry = createSlotRegistry()
    registry.register({ id: 'x', slot: 'goals.tabs', source: 't' })
    registry.register({ id: 'x', slot: 'docs.tabs', source: 't' })
    expect(registry.slots()).toEqual(['docs.tabs', 'goals.tabs'])
    expect(registry.list('calendar.tabs', NONE)).toEqual([])
  })
})

describe('slot registry dedupe', () => {
  it('same (slot, id) replaces the earlier entry (last wins)', () => {
    const registry = createSlotRegistry()
    registry.register({ id: 'docs.files', slot: 'docs.tabs', order: 10, titleKey: 'old', source: 'a' })
    registry.register({ id: 'docs.files', slot: 'docs.tabs', order: 30, titleKey: 'new', source: 'b' })
    const list = registry.list('docs.tabs', NONE)
    expect(list).toHaveLength(1)
    expect(list[0]?.titleKey).toBe('new')
  })

  it("disposing a replaced handle does not remove the replacement", () => {
    const registry = createSlotRegistry()
    const first = registry.register({ id: 'docs.files', slot: 'docs.tabs', source: 'a' })
    const second = registry.register({ id: 'docs.files', slot: 'docs.tabs', source: 'b' })
    first.dispose()
    expect(registry.get('docs.tabs', 'docs.files')?.source).toBe('b')
    second.dispose()
    expect(registry.get('docs.tabs', 'docs.files')).toBeUndefined()
    expect(registry.slots()).toEqual([])
  })

  it('notifies listeners on register and dispose', () => {
    const registry = createSlotRegistry()
    let calls = 0
    const sub = registry.onDidChange(() => calls++)
    registry.register({ id: 'a', slot: 'docs.tabs', source: 't' }).dispose()
    sub.dispose()
    registry.register({ id: 'b', slot: 'docs.tabs', source: 't' })
    expect(calls).toBe(2)
  })
})

describe('slot gating', () => {
  it('hides flagged entries until every flag is on', () => {
    const registry = createSlotRegistry()
    registry.register({ id: 'one', slot: 'goals.tabs', flag: 'f.a', source: 't' })
    registry.register({ id: 'both', slot: 'goals.tabs', flag: ['f.a', 'f.b'], source: 't' })
    registry.register({ id: 'free', slot: 'goals.tabs', source: 't' })
    expect(ids(registry.list('goals.tabs', NONE))).toEqual(['free'])
    expect(ids(registry.list('goals.tabs', { flags: new Set(['f.a']) }))).toEqual(['free', 'one'])
    expect(ids(registry.list('goals.tabs', { flags: new Set(['f.a', 'f.b']) }))).toEqual(['both', 'free', 'one'])
    expect(ids(registry.all('goals.tabs'))).toEqual(['both', 'free', 'one'])
  })

  it('evaluates when-expressions against context keys', () => {
    const registry = createSlotRegistry()
    registry.register({ id: 'pinned', slot: 'messenger.header.buttons', when: 'chat.isGroup && !chat.isBot', source: 't' })
    expect(registry.list('messenger.header.buttons', { flags: new Set(), keys: { 'chat.isGroup': true } })).toHaveLength(1)
    expect(registry.list('messenger.header.buttons', { flags: new Set(), keys: { 'chat.isGroup': true, 'chat.isBot': true } })).toHaveLength(0)
    expect(registry.list('messenger.header.buttons', NONE)).toHaveLength(0)
  })
})

describe('slot ids', () => {
  it('accepts <surface>.<name> ids and rejects malformed ones', () => {
    expect(isSlotId('goals.tabs')).toBe(true)
    expect(isSlotId('docs.sidebar.drive')).toBe(true)
    for (const bad of ['goals', 'Goals.tabs', '.tabs', 'goals.', 'goals..tabs', 'goals tabs', 42, null]) {
      expect(isSlotId(bad)).toBe(false)
    }
  })

  it('negative: registering into a malformed slot or without an id throws', () => {
    const registry = createSlotRegistry()
    expect(() => registry.register({ id: 'x', slot: 'nope' as SlotId, source: 't' })).toThrow('Invalid slot id')
    expect(() => registry.register({ id: '', slot: 'goals.tabs', source: 't' })).toThrow('needs an id')
  })

  it('documents the reserved ids for #1505 and #1512 (left empty)', () => {
    expect(reservedSlotOwner('entity.row.context')).toBe('#1505')
    expect(slotKind('entity.row.context')).toBe('context-menu')
    expect(reservedSlotOwner('messenger.chrome')).toBe('#1512')
    expect(slotKind('messenger.chrome')).toBe('chrome')
    expect(reservedSlotOwner('docs.sidebar.drive')).toBe('#1512')
    expect(reservedSlotOwner('agent.context.docs')).toBe('#1512')
    expect(slotKind('agent.context.docs')).toBe('agent-context')
    expect(reservedSlotOwner('goals.tabs')).toBeNull()
    for (const reserved of RESERVED_SLOT_PATTERNS) expect(getSlotRegistry().all(reserved.example)).toEqual([])
  })

  it('catalogues the documented slots with a kind', () => {
    expect(SLOT_CATALOGUE['global.create']?.kind).toBe('global-create')
    expect(SLOT_CATALOGUE['messenger.page']?.kind).toBe('page')
    expect(SLOT_CATALOGUE['goal.page.tabs']?.kind).toBe('tabs')
    expect(SLOT_CATALOGUE['chat.composer.menu']?.kind).toBe('composer-menu')
    expect(SLOT_CATALOGUE['docs.slash']?.kind).toBe('slash-command')
  })
})

describe('wave-2 fake contribution (no shell edit)', () => {
  it('a package registers a tab, a slash command and a reserved-slot entry into the singleton', () => {
    const registry = getSlotRegistry()
    const handles = [
      registry.register({ id: 'okr.kpis', slot: 'goal.page.tabs', order: 40, titleKey: 'workbench.mode.goals', flag: 'fake.okr.v1', source: 'fake-okr' }),
      registry.register({ id: 'okr.checkin', slot: 'chat.slash', titleKey: 'workbench.mode.goals', flag: 'fake.okr.v1', source: 'fake-okr', payload: { command: 'goals.check_in' } }),
      registry.register({ id: 'okr.row', slot: 'entity.row.context', flag: 'fake.okr.v1', source: 'fake-okr' }),
    ]
    const on = { flags: new Set(['fake.okr.v1']) }
    expect(ids(registry.list('goal.page.tabs', NONE))).toEqual([])
    expect(ids(registry.list('goal.page.tabs', on))).toEqual(['okr.kpis'])
    expect(registry.list<{ command: string }>('chat.slash', on)[0]?.payload?.command).toBe('goals.check_in')
    expect(ids(registry.list('entity.row.context', on))).toEqual(['okr.row'])
    for (const handle of handles) handle.dispose()
    for (const slot of ['goal.page.tabs', 'chat.slash', 'entity.row.context'] as const) expect(registry.all(slot)).toEqual([])
  })
})
