import { describe, expect, it, mock } from 'bun:test'
import { createModalRegistry } from '../ModalContext'
import { createDismissibleLayerRegistry } from '../DismissibleLayerContext'

describe('reactive product-tour layer arbitration', () => {
  it('UI-07 both registries close native layers before the low priority tour', () => {
    const modals = createModalRegistry()
    const layers = createDismissibleLayerRegistry()
    const tourClose = mock(() => {})
    const nativeClose = mock(() => {})
    modals.registerModal('tour', tourClose, -1000)
    layers.registerLayer({ id: 'tour', type: 'custom', priority: -1000, close: tourClose })
    modals.registerModal('sharing', nativeClose)
    layers.registerLayer({ id: 'sharing', type: 'radix-dialog', close: nativeClose })
    expect(modals.closeTopModal()).toBe(true)
    expect(layers.handleEscape()).toBe(true)
    expect(nativeClose).toHaveBeenCalledTimes(2)
    expect(tourClose).toHaveBeenCalledTimes(0)
  })

  it('Cmd+W and Escape choose the most recently opened native layer at equal priority', () => {
    const modals = createModalRegistry()
    const layers = createDismissibleLayerRegistry()
    const newest = mock(() => {})
    modals.registerModal('older', () => {})
    modals.registerModal('newer', newest)
    layers.registerLayer({ id: 'older', type: 'modal', close: () => {} })
    layers.registerLayer({ id: 'newer', type: 'modal', close: newest })
    expect(modals.getSnapshot()[0]?.id).toBe('newer')
    expect(layers.getSnapshot()[0]?.id).toBe('newer')
    modals.closeTopModal(); layers.handleEscape()
    expect(newest).toHaveBeenCalledTimes(2)
  })

  it('publishes stable snapshots and reactive register/unregister notifications', () => {
    for (const registry of [createModalRegistry(), createDismissibleLayerRegistry()]) {
      const changed = mock(() => {})
      const unsubscribe = registry.subscribe(changed)
      const original = registry.getSnapshot()
      expect(registry.getSnapshot()).toBe(original)
      const cleanup = 'registerModal' in registry
        ? registry.registerModal('native', () => {}, 5)
        : registry.registerLayer({ id: 'native', type: 'modal', priority: 5, close: () => {} })
      expect(changed).toHaveBeenCalledTimes(1)
      expect(registry.getSnapshot()).not.toBe(original)
      expect(registry.getSnapshot()[0]?.id).toBe('native')
      expect(registry.getSnapshot()).toBe(registry.getSnapshot())
      cleanup()
      expect(changed).toHaveBeenCalledTimes(2)
      expect(registry.getSnapshot()).toEqual([])
      unsubscribe()
    }
  })

  it('stale cleanup never deletes a newer registration with the same id', () => {
    for (const registry of [createModalRegistry(), createDismissibleLayerRegistry()]) {
      const register = (close: () => void) => 'registerModal' in registry
        ? registry.registerModal('reused', close)
        : registry.registerLayer({ id: 'reused', type: 'custom', close })
      const stale = register(() => {})
      const currentClose = mock(() => {})
      register(currentClose)
      stale()
      expect(registry.getSnapshot().length).toBe(1)
      if ('closeTopModal' in registry) registry.closeTopModal()
      else registry.closeTop()
      expect(currentClose).toHaveBeenCalledTimes(1)
    }
  })

  it('UI-06 tour Escape pauses and has no Back operation', () => {
    const registry = createDismissibleLayerRegistry()
    const pause = mock(() => {})
    registry.registerLayer({ id: 'tour', type: 'custom', priority: -1000, close: pause })
    expect(registry.handleEscape()).toBe(true)
    expect(pause).toHaveBeenCalledTimes(1)
  })
})
