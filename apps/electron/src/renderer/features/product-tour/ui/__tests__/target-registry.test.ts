import { describe, expect, it, mock } from 'bun:test'
import type { TourBinding, TourTargetRegistration } from '../../contracts'
import { createTargetRegistry } from '../target-registry'
import { measureTargetGeometry } from '../geometry'

const binding: TourBinding = { workspaceId: 'workspace', panelId: 'one', sessionId: 'session', entityId: 'entity', clientProfileId: 'profile', runToken: 'attempt' }

function element({ left = 20, top = 30, width = 100, height = 40, connected = true, hidden = false, frame = false } = {}): HTMLElement {
  const ownerDocument = { defaultView: { innerWidth: 1000, innerHeight: 800, frameElement: frame ? {} : null, getComputedStyle: (node: { hidden: boolean }) => ({ display: node.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1', overflow: 'visible' }) } }
  return { isConnected: connected, hidden, ownerDocument, parentElement: null, getAttribute: () => null, getBoundingClientRect: () => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height }), getClientRects: () => [{ width, height }] } as unknown as HTMLElement
}

function target(token: string, context = binding, node = element(), variant: TourTargetRegistration['variant'] = 'regular', scope: TourTargetRegistration['scope'] = 'bound-panel'): TourTargetRegistration {
  return { id: 'composer.input', registrationToken: token, context, element: node, variant, scope }
}

describe('scoped live target resolution', () => {
  it('UI-01 selects only the bound workspace, panel, session and entity', () => {
    const registry = createTargetRegistry()
    const expected = target('current')
    registry.register(target('peer', { ...binding, panelId: 'two' }))
    registry.register(target('workspace', { ...binding, workspaceId: 'other' }))
    registry.register(target('session', { ...binding, sessionId: 'other' }))
    registry.register(target('entity', { ...binding, entityId: 'other' }))
    registry.register(expected)
    expect(registry.resolve('composer.input', binding)).toEqual({ status: 'ready', target: expected })
  })

  it('supports non-session route controls and newly created entities without choosing peers', () => {
    const registry = createTargetRegistry()
    const current = target('created', { ...binding, entityId: 'created' })
    registry.register(current)
    expect(registry.resolve('composer.input', { ...binding, entityId: undefined })).toEqual({ status: 'ready', target: current })
    const nonSession = createTargetRegistry()
    const control = target('route', { ...binding, sessionId: undefined, entityId: undefined })
    nonSession.register(control)
    expect(nonSession.resolve('composer.input', binding)).toEqual({ status: 'ready', target: control })
  })

  it('UI-02 selects the visible declared variant and blocks equal alternatives', () => {
    const registry = createTargetRegistry({ getPreferredVariant: () => 'compact' })
    registry.register(target('hidden', binding, element({ hidden: true })))
    const compact = target('compact', binding, element(), 'compact')
    registry.register(compact)
    registry.register(target('regular', binding))
    expect(registry.resolve('composer.input', binding)).toEqual({ status: 'ready', target: compact })
    registry.register(target('compact-duplicate', binding, element(), 'compact'))
    expect(registry.resolve('composer.input', binding)).toEqual({ status: 'blocked', reason: 'ambiguous-target' })
  })

  it('UI-03 stale cleanup cannot remove a replacement registration', () => {
    const registry = createTargetRegistry()
    const first = target('same-token')
    const cleanup = registry.register(first)
    const replacement = target('same-token')
    const removeReplacement = registry.register(replacement)
    cleanup()
    cleanup()
    expect(registry.resolve('composer.input', binding)).toEqual({ status: 'ready', target: replacement })
    removeReplacement()
    expect(registry.resolve('composer.input', binding)).toEqual({ status: 'blocked', reason: 'target-missing' })
  })

  it('re-registering the same object still gives each cleanup a unique lifecycle', () => {
    const registry = createTargetRegistry()
    const current = target('reuse-object')
    const stale = registry.register(current)
    registry.register(current)
    stale()
    expect(registry.resolve('composer.input', binding)).toEqual({ status: 'ready', target: current })
  })

  it('separate live refs are ambiguous instead of first-registration wins', () => {
    const registry = createTargetRegistry()
    registry.register(target('one'))
    registry.register(target('two'))
    expect(registry.resolve('composer.input', binding)).toEqual({ status: 'blocked', reason: 'ambiguous-target' })
  })

  it('UI-04 rejects detached, hidden, zero-sized and clipped targets', () => {
    for (const node of [element({ connected: false }), element({ hidden: true }), element({ width: 0 }), element({ left: -80 })]) {
      const registry = createTargetRegistry()
      registry.register(target('hidden', binding, node))
      expect(registry.resolve('composer.input', binding)).toEqual({ status: 'blocked', reason: 'target-occluded' })
    }
  })

  it('allows workspace-wide shell targets only when the descriptor declares shell', () => {
    const registration = target('shell', { ...binding, panelId: 'shell', sessionId: undefined }, element(), 'rail', 'shell')
    const regular = createTargetRegistry()
    regular.register(registration)
    expect(regular.resolve('composer.input', binding).status).toBe('blocked')
    const shell = createTargetRegistry({ getTargetScope: () => 'shell' })
    shell.register(registration)
    expect(shell.resolve('composer.input', binding)).toEqual({ status: 'ready', target: registration })
  })

  it('UI-10 rejects DOM inside an iframe and honors native layer blockers', () => {
    const registry = createTargetRegistry()
    registry.register(target('iframe', binding, element({ frame: true })))
    expect(registry.resolve('composer.input', binding)).toEqual({ status: 'blocked', reason: 'target-occluded' })
    const blocked = createTargetRegistry({ getBlockers: () => ['modal-open'] })
    blocked.register(target('live'))
    expect(blocked.resolve('composer.input', binding)).toEqual({ status: 'blocked', reason: 'modal-open' })
  })

  it('notifies subscriptions for registrations and cleans up subscriptions', () => {
    const registry = createTargetRegistry()
    const changed = mock(() => {})
    const unsubscribe = registry.subscribe(changed)
    const cleanup = registry.register(target('new'))
    expect(changed).toHaveBeenCalledTimes(1)
    cleanup()
    expect(changed).toHaveBeenCalledTimes(2)
    unsubscribe()
    registry.register(target('next'))
    expect(changed).toHaveBeenCalledTimes(2)
  })
})

describe('CSS pixel geometry', () => {
  it('UI-05 preserves fractional coordinates without device pixel scaling', () => {
    const measured = measureTargetGeometry(element({ left: 25.25, top: 41.5, width: 91.75, height: 35.5 }))
    expect(measured?.rect).toEqual({ x: 25.25, y: 41.5, left: 25.25, top: 41.5, right: 117, bottom: 77, width: 91.75, height: 35.5 })
    expect(measured?.spotlightRect).toEqual({ x: 17.25, y: 33.5, left: 17.25, top: 33.5, right: 125, bottom: 85, width: 107.75, height: 51.5 })
  })

  it('clamps decorative padding to the viewport', () => {
    expect(measureTargetGeometry(element({ left: 2, top: 3 }))?.spotlightRect.left).toBe(0)
    expect(measureTargetGeometry(element({ left: 2, top: 3 }))?.spotlightRect.top).toBe(0)
  })
})
