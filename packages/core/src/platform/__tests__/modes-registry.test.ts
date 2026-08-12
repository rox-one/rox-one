import { describe, it, expect } from 'bun:test'
import { createModeRegistry } from '../modes/index.ts'
import type { ModeContribution } from '../modes/index.ts'

function mode(id: string, order: number, when?: string): ModeContribution {
  return {
    id,
    title: `modes.${id}.title`,
    icon: 'icon',
    rootRoute: `/${id}`,
    order,
    defaultPinned: true,
    layoutProfileId: 'default',
    when,
    source: { type: 'core', id: 'test' },
  }
}

describe('ModeRegistry', () => {
  it('registers contributions and returns them by id', () => {
    const registry = createModeRegistry()
    const contribution = mode('core.chat', 20)

    registry.register(contribution)

    expect(registry.get('core.chat')).toBe(contribution)
  })

  it('throws on duplicate id; the first registration wins', () => {
    const registry = createModeRegistry()
    const first = mode('core.chat', 20)
    registry.register(first)

    expect(() => registry.register(mode('core.chat', 30))).toThrow()
    expect(registry.get('core.chat')).toBe(first)
  })

  it('lists modes ordered by order, ties broken by id', () => {
    const registry = createModeRegistry()
    registry.register(mode('core.inbox', 70))
    registry.register(mode('core.chat', 20))
    registry.register(mode('core.home', 10))
    registry.register(mode('core.b-tie', 20))
    registry.register(mode('core.a-tie', 20))

    expect(registry.list({}).map((m) => m.id)).toEqual([
      'core.home',
      'core.a-tie',
      'core.b-tie',
      'core.chat',
      'core.inbox',
    ])
  })

  it('filters contributions through the when language', () => {
    const registry = createModeRegistry()
    registry.register(mode('core.chat', 20))
    registry.register(mode('core.feed', 60, "capability == 'feed.ingest'"))

    expect(registry.list({}).map((m) => m.id)).toEqual(['core.chat'])
    expect(registry.list({ capability: 'feed.ingest' }).map((m) => m.id)).toEqual([
      'core.chat',
      'core.feed',
    ])
  })

  it('unregister and dispose remove the contribution; onDidChange fires', () => {
    const registry = createModeRegistry()
    let calls = 0
    const sub = registry.onDidChange(() => { calls++ })

    const registration = registry.register(mode('core.chat', 20))
    registry.register(mode('core.inbox', 70))
    registration.dispose()
    expect(registry.get('core.chat')).toBeUndefined()

    registry.unregister('core.inbox')
    expect(registry.list({})).toEqual([])
    expect(calls).toBe(4)

    sub.dispose()
    registry.register(mode('core.home', 10))
    expect(calls).toBe(4)
  })

  it('accepts an initial catalog via the factory', () => {
    const registry = createModeRegistry([mode('core.home', 10), mode('core.chat', 20)])

    expect(registry.list({}).map((m) => m.id)).toEqual(['core.home', 'core.chat'])
  })
})
