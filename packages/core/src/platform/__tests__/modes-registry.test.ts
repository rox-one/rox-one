import { describe, expect, it } from 'bun:test'
import { createModeRegistry, isModeNavigable, listPinnedModes } from '../modes/index.ts'
import type { ModeContribution } from '../modes/index.ts'

function mode(id: string, extra?: Partial<ModeContribution>): ModeContribution {
  return {
    id,
    titleKey: `workbench.mode.${id}`,
    icon: id,
    rootRoute: `/${id}`,
    order: 10,
    defaultPinned: true,
    layoutProfileId: 'agent',
    ...extra,
  }
}

describe('ModeRegistry', () => {
  it('registers modes and lists them by order then id', () => {
    const registry = createModeRegistry()
    registry.register(mode('knowledge', { order: 50 }))
    registry.register(mode('chat', { order: 20 }))
    registry.register(mode('home', { order: 20 }))

    expect(registry.list().map((item) => item.id)).toEqual(['chat', 'home', 'knowledge'])
    expect(registry.get('chat')?.titleKey).toBe('workbench.mode.chat')
  })

  it('throws on duplicate id', () => {
    const registry = createModeRegistry()
    registry.register(mode('chat'))
    expect(() => registry.register(mode('chat'))).toThrow(/already registered/)
  })

  it('filters by when expressions', () => {
    const registry = createModeRegistry()
    registry.register(mode('chat'))
    registry.register(mode('knowledge', { when: "capability=='knowledge'" }))

    expect(registry.list({}).map((item) => item.id)).toEqual(['chat'])
    expect(registry.list({ capability: 'knowledge' }).map((item) => item.id)).toEqual(['chat', 'knowledge'])
  })

  it('dispose removes the mode', () => {
    const registry = createModeRegistry()
    const disposable = registry.register(mode('chat'))
    disposable.dispose()
    expect(registry.get('chat')).toBeUndefined()
    disposable.dispose()
  })
})

describe('isModeNavigable / listPinnedModes', () => {
  it('treats a null route as not navigable', () => {
    expect(isModeNavigable(mode('meetings', { rootRoute: null }))).toBe(false)
    expect(isModeNavigable(mode('chat'))).toBe(true)
  })

  it('requires declared capabilities', () => {
    const meetings = mode('meetings', { requiredCapabilities: ['meetings.pipeline.v1'] })
    expect(isModeNavigable(meetings)).toBe(false)
    expect(isModeNavigable(meetings, new Set(['meetings.pipeline.v1']))).toBe(true)
  })

  it('splits pinned and overflow modes', () => {
    const { pinned, overflow } = listPinnedModes([
      mode('chat', { defaultPinned: true }),
      mode('projects', { defaultPinned: false }),
    ])
    expect(pinned.map((item) => item.id)).toEqual(['chat'])
    expect(overflow.map((item) => item.id)).toEqual(['projects'])
  })

  it('keeps non-navigable modes in overflow even when defaultPinned', () => {
    const { pinned, overflow } = listPinnedModes([
      mode('chat', { defaultPinned: true }),
      mode('meetings', { defaultPinned: true, rootRoute: null }),
    ])
    expect(pinned.map((item) => item.id)).toEqual(['chat'])
    expect(overflow.map((item) => item.id)).toEqual(['meetings'])
  })

  it('pins a capability-gated mode only when the capability is present', () => {
    const meetings = mode('meetings', { requiredCapabilities: ['meetings.pipeline.v1'] })
    expect(listPinnedModes([meetings]).pinned).toEqual([])
    expect(
      listPinnedModes([meetings], new Set(['meetings.pipeline.v1'])).pinned.map((item) => item.id),
    ).toEqual(['meetings'])
  })
})
