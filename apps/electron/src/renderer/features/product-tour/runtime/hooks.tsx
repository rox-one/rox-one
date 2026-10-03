import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { CapabilityId, SignalName, TourBinding, TourCapability, TourScope, TourSignal, TourTargetRegistration, TargetId } from '../contracts'

/** Captured at the start of a native operation. Never stamp a late completion with a new attempt. */
export interface TourObservation { readonly binding: TourBinding; readonly operationToken: string; readonly at: number }
export interface TourRuntimePort {
  readonly enabled: boolean
  capture(scope: TourScope): TourObservation | null
  emit(signal: TourSignal): void
  register(target: TourTargetRegistration): () => void
  setCapability(scope: TourScope, id: CapabilityId, capability: TourCapability): () => void
}
export const TourRuntimeContext = createContext<TourRuntimePort | null>(null)
export const TourScopeContext = createContext<TourScope | null>(null)

export function TourPanelScope({ children, ...scope }: TourScope & { children: ReactNode }) {
  const value = useMemo(() => scope, [scope.workspaceId, scope.panelId, scope.sessionId, scope.entityId])
  return <TourScopeContext.Provider value={value}>{children}</TourScopeContext.Provider>
}

export interface TargetOptions extends Partial<TourScope> {
  readonly scope?: 'shell' | 'bound-panel'
  readonly variant?: 'regular' | 'compact' | 'rail'
}
export function useTourTarget(id: TargetId, options: TargetOptions = {}) {
  const runtime = useContext(TourRuntimeContext)
  const inherited = useContext(TourScopeContext)
  const context = useMemo<TourScope | null>(() => {
    const workspaceId = options.workspaceId ?? inherited?.workspaceId
    const panelId = options.panelId ?? inherited?.panelId
    if (!workspaceId || !panelId) return null
    return { workspaceId, panelId, sessionId: options.sessionId ?? inherited?.sessionId, entityId: options.entityId ?? inherited?.entityId }
  }, [inherited, options.workspaceId, options.panelId, options.sessionId, options.entityId])
  const nodeRef = useRef<HTMLElement | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const register = useCallback((node: HTMLElement | null) => {
    cleanup.current?.(); cleanup.current = null; nodeRef.current = node
    if (node && context && runtime?.enabled) cleanup.current = runtime.register({ id, context, element: node, registrationToken: crypto.randomUUID(), scope: options.scope ?? 'bound-panel', variant: options.variant ?? 'regular' })
  }, [runtime, context, id, options.scope, options.variant])
  useEffect(() => { register(nodeRef.current); return () => { cleanup.current?.(); cleanup.current = null } }, [register])
  return register
}

export function useTourSignals(overrides: Partial<TourScope> = {}) {
  const runtime = useContext(TourRuntimeContext)
  const inherited = useContext(TourScopeContext)
  const scope = useMemo<TourScope | null>(() => {
    const workspaceId = overrides.workspaceId ?? inherited?.workspaceId
    const panelId = overrides.panelId ?? inherited?.panelId
    return workspaceId && panelId ? { workspaceId, panelId, sessionId: overrides.sessionId ?? inherited?.sessionId, entityId: overrides.entityId ?? inherited?.entityId } : null
  }, [inherited, overrides.workspaceId, overrides.panelId, overrides.sessionId, overrides.entityId])
  return useMemo(() => ({
    capture: (): TourObservation | null => runtime?.enabled && scope ? runtime.capture(scope) : null,
    emit: (observation: TourObservation | null, name: SignalName, level: TourSignal['level'], origin: TourSignal['origin'], eventToken: string = crypto.randomUUID()) => {
      if (!observation || !runtime?.enabled || (level === 'verified' && origin === 'ui-observation')) return
      runtime.emit({ name, binding: observation.binding, operationToken: observation.operationToken, operationStartedAt: observation.at, eventToken, at: Date.now(), level, origin } as TourSignal)
    },
    capability: (id: CapabilityId, value: TourCapability) => scope && runtime?.enabled ? runtime.setCapability(scope, id, value) : () => {},
  }), [runtime, scope])
}
