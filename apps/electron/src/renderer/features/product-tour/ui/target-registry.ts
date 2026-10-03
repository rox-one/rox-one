import type { SafeReason, TargetId, TargetRegistry, TourBinding, TourTargetRegistration } from '../contracts'
import { measureTargetGeometry } from './geometry'

export interface TargetRegistryOptions {
  /** Shell fallback must be explicitly declared by the active step descriptor. */
  readonly getTargetScope?: (id: TargetId) => 'shell' | 'bound-panel'
  readonly getPreferredVariant?: () => TourTargetRegistration['variant']
  readonly getBlockers?: () => readonly SafeReason[]
  /** Restrict targets to the renderer document; iframe documents are never searched. */
  readonly document?: Document
}

function matchesScope(target: TourTargetRegistration, binding: TourBinding, scope: 'shell' | 'bound-panel') {
  const context = target.context
  if (target.scope !== scope || context.workspaceId !== binding.workspaceId) return false
  if (scope === 'bound-panel' && context.panelId !== binding.panelId) return false
  if (scope === 'shell') return true
  // Non-session controls and newly created entities may omit an unbound dimension.
  if (context.sessionId !== undefined && binding.sessionId !== undefined && context.sessionId !== binding.sessionId) return false
  if (context.entityId !== undefined && binding.entityId !== undefined && context.entityId !== binding.entityId) return false
  return true
}

export function createTargetRegistry(options: TargetRegistryOptions = {}): TargetRegistry {
  const targets = new Map<string, { target: TourTargetRegistration }>()
  const listeners = new Set<() => void>()
  const rendererDocument = options.document ?? (typeof document === 'undefined' ? undefined : document)
  const publish = () => { for (const listener of listeners) listener() }
  return {
    register(target) {
      const registration = { target }
      targets.set(target.registrationToken, registration)
      publish()
      return () => {
        if (targets.get(target.registrationToken) !== registration) return
        targets.delete(target.registrationToken)
        publish()
      }
    },
    resolve(id, binding) {
      const blocker = options.getBlockers?.()[0]
      if (blocker) return { status: 'blocked', reason: blocker }
      const scope = options.getTargetScope?.(id) ?? 'bound-panel'
      const candidates = Array.from(targets.values(), ({ target }) => target).filter((target) => target.id === id && matchesScope(target, binding, scope))
      if (!candidates.length) return { status: 'blocked', reason: 'target-missing' }
      const visible = candidates.filter((target) => (!rendererDocument || target.element.ownerDocument === rendererDocument) && measureTargetGeometry(target.element))
      if (!visible.length) return { status: 'blocked', reason: 'target-occluded' }
      const preferred = options.getPreferredVariant?.()
      const exactVariant = preferred ? visible.filter((target) => target.variant === preferred) : []
      const choices = exactVariant.length ? exactVariant : visible
      if (choices.length !== 1) return { status: 'blocked', reason: 'ambiguous-target' }
      return { status: 'ready', target: choices[0]! }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
