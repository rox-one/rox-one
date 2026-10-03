import React, { createContext, useContext, useMemo } from 'react'
import {
  setDismissibleLayerBridge,
  type DismissibleLayerBridge,
  type DismissibleLayerRegistration,
  type DismissibleLayerSnapshot,
} from '@/lib/dismissible-layer-bridge'

export interface DismissibleLayer extends Required<Pick<DismissibleLayerRegistration, 'id' | 'type' | 'priority' | 'close'>> {
  isOpen: boolean
  canBack?: () => boolean
  back?: () => boolean
  order: number
}

type DismissibleLayerContextValue = DismissibleLayerRegistry

const DismissibleLayerContext = createContext<DismissibleLayerContextValue | null>(null)

export interface DismissibleLayerRegistry extends DismissibleLayerBridge {
  registerLayer: (layer: DismissibleLayerRegistration) => () => void
  getSnapshot: () => readonly DismissibleLayerSnapshot[]
  subscribe: (listener: () => void) => () => void
}

export function createDismissibleLayerRegistry(): DismissibleLayerRegistry {
  const layers = new Map<string, DismissibleLayer>()
  let orderSeed = 0
  const listeners = new Set<() => void>()
  let snapshot: readonly DismissibleLayerSnapshot[] = Object.freeze([])

  const getOrderedOpenLayers = (): DismissibleLayer[] => {
    const open = Array.from(layers.values()).filter((layer) => layer.isOpen)
    open.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return b.order - a.order
    })
    return open
  }

  const publish = () => {
    snapshot = Object.freeze(getOrderedOpenLayers().map(({ id, type, priority }) => Object.freeze({ id, type, priority })))
    for (const listener of listeners) listener()
  }

  const registerLayer = (layer: DismissibleLayerRegistration) => {
    const order = ++orderSeed
    const registration: DismissibleLayer = {
      id: layer.id,
      type: layer.type,
      priority: layer.priority ?? 0,
      isOpen: layer.isOpen ?? true,
      close: layer.close,
      canBack: layer.canBack,
      back: layer.back,
      order,
    }
    layers.set(layer.id, registration)
    publish()

    return () => {
      if (layers.get(layer.id) !== registration) return
      layers.delete(layer.id)
      publish()
    }
  }

  const hasOpenLayers = () => getOrderedOpenLayers().length > 0

  const getTopLayer = () => {
    const top = getOrderedOpenLayers()[0]
    if (!top) return null

    return {
      id: top.id,
      type: top.type,
      priority: top.priority,
    }
  }

  const closeTop = () => {
    const top = getOrderedOpenLayers()[0]
    if (!top) return false
    top.close()
    return true
  }

  const handleEscape = () => {
    const top = getOrderedOpenLayers()[0]
    if (!top) return false

    if (top.canBack?.() && top.back) {
      const wentBack = top.back()
      if (wentBack) return true
    }

    top.close()
    return true
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    registerLayer,
    hasOpenLayers,
    getTopLayer,
    closeTop,
    handleEscape,
  }
}

export function DismissibleLayerProvider({ children }: { children: React.ReactNode }) {
  const registry = useMemo(() => createDismissibleLayerRegistry(), [])

  React.useEffect(() => {
    setDismissibleLayerBridge(registry)
    return () => setDismissibleLayerBridge(null)
  }, [registry])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return

      const handled = registry.handleEscape()
      if (!handled) return

      event.preventDefault()
      event.stopPropagation()
    }

    // Bubble phase: let inputs/inner controls consume Escape first.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [registry])

  return (
    <DismissibleLayerContext.Provider value={registry}>
      {children}
    </DismissibleLayerContext.Provider>
  )
}

/** Shared primitives remain usable in isolated roots without the app registry. */
export function useOptionalDismissibleLayerRegistry(): DismissibleLayerRegistry | null {
  return useContext(DismissibleLayerContext)
}

export function useDismissibleLayerRegistry() {
  const context = useContext(DismissibleLayerContext)
  if (!context) {
    throw new Error('useDismissibleLayerRegistry must be used within a DismissibleLayerProvider')
  }
  return context
}

export function useRegisterDismissibleLayer(layer: DismissibleLayerRegistration | null) {
  const { registerLayer } = useDismissibleLayerRegistry()

  React.useEffect(() => {
    if (!layer) return
    const unregister = registerLayer(layer)
    return unregister
  }, [layer, registerLayer])
}
