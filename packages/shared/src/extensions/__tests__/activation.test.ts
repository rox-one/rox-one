/**
 * Activation planner table (wave-3 f.7).
 *
 * Covers every activation-event kind, the empty/undefined array, unknown
 * tokens, undeclared commands, disabled extensions, non-sandbox runtimes,
 * already-loaded ids and deterministic ordering.
 */
import { describe, expect, it } from 'bun:test'
import {
  extensionCommandId,
  planExtensionActivations,
  type ActivationTrigger,
  type SandboxExtensionDescriptor,
} from '../activation'
import type { ExtensionManifest } from '../types'

function descriptor(
  id: string,
  manifest: Partial<ExtensionManifest> = {},
  status: 'ok' | 'invalid' = 'ok',
): SandboxExtensionDescriptor {
  const full: ExtensionManifest = {
    id,
    name: id,
    version: '1.0.0',
    runtime: 'craft-sandbox',
    permissions: [],
    ...manifest,
  }
  return {
    id,
    dir: `/sandbox/${id}`,
    entryPath: `/sandbox/${id}/index.js`,
    manifest: full,
    descriptorHash: 'hash',
    status,
    ...(status === 'invalid' ? { issues: ['fixture'] } : {}),
  }
}

function plan(
  descriptors: SandboxExtensionDescriptor[],
  triggers: ActivationTrigger[] = [],
  loaded: string[] = [],
  enabled: (id: string) => boolean = () => true,
) {
  return planExtensionActivations({
    descriptors,
    enabled,
    triggers,
    loaded: new Set(loaded),
  })
}

describe('extensionCommandId', () => {
  it('namespaces with the bare extension id and is idempotent', () => {
    expect(extensionCommandId('acme.tools', 'open')).toBe('extension:acme.tools:open')
    expect(extensionCommandId('extension:acme.tools', 'open')).toBe('extension:acme.tools:open')
  })
})

describe('planExtensionActivations', () => {
  it('activates when activationEvents is undefined', () => {
    const result = plan([descriptor('a')])
    expect(result.items[0]).toEqual({ id: 'a', action: 'activate-now', reason: 'activation-all' })
    expect(result.plannedLoads).toEqual(['a'])
  })

  it('activates when activationEvents is an empty array', () => {
    const result = plan([descriptor('a', { activationEvents: [] })])
    expect(result.plannedLoads).toEqual(['a'])
  })

  it('activates on onStartup when the startup trigger is present', () => {
    const result = plan([descriptor('a', { activationEvents: ['onStartup'] })], ['startup'])
    expect(result.items[0]).toEqual({
      id: 'a',
      action: 'activate-now',
      reason: 'activation-event',
      trigger: 'startup',
    })
  })

  it('defers onStartup when the startup trigger is absent', () => {
    const result = plan([descriptor('a', { activationEvents: ['onStartup'] })], ['workspace-open'])
    expect(result.items[0]).toEqual({
      id: 'a',
      action: 'defer',
      reason: 'defer:onStartup',
      trigger: 'startup',
    })
    expect(result.plannedLoads).toEqual([])
  })

  it('activates on onWorkspaceOpen when that trigger is present', () => {
    const result = plan(
      [descriptor('a', { activationEvents: ['onWorkspaceOpen'] })],
      ['workspace-open'],
    )
    expect(result.items[0]?.action).toBe('activate-now')
    expect(result.items[0]?.trigger).toBe('workspace-open')
  })

  it('defers onWorkspaceOpen when the trigger is absent', () => {
    const result = plan([descriptor('a', { activationEvents: ['onWorkspaceOpen'] })], ['startup'])
    expect(result.items[0]?.action).toBe('defer')
    expect(result.items[0]?.trigger).toBe('workspace-open')
  })

  it('activates on a matching onCommand trigger when the command is declared', () => {
    const d = descriptor('a', {
      activationEvents: ['onCommand:open'],
      contributes: { commands: [{ id: 'open', title: 'Open' }] },
    })
    const result = plan([d], [{ kind: 'command', id: 'open' }])
    expect(result.items[0]).toEqual({
      id: 'a',
      action: 'activate-now',
      reason: 'activation-event',
      trigger: { kind: 'command', id: 'open' },
    })
  })

  it('defers onCommand until the command trigger arrives', () => {
    const d = descriptor('a', {
      activationEvents: ['onCommand:open'],
      contributes: { commands: [{ id: 'open', title: 'Open' }] },
    })
    const result = plan([d], ['startup'])
    expect(result.items[0]).toEqual({
      id: 'a',
      action: 'defer',
      reason: 'defer:onCommand:open',
      trigger: { kind: 'command', id: 'open' },
    })
  })

  it('skips onCommand not declared in contributes.commands', () => {
    const result = plan(
      [descriptor('a', { activationEvents: ['onCommand:missing'] })],
      [{ kind: 'command', id: 'missing' }],
    )
    expect(result.items[0]).toEqual({
      id: 'a',
      action: 'skip',
      reason: 'command-not-declared',
    })
  })

  it('activates on a matching onSurface trigger', () => {
    const result = plan(
      [descriptor('a', { activationEvents: ['onSurface:panel'] })],
      [{ kind: 'surface', surface: 'panel' }],
    )
    expect(result.items[0]?.action).toBe('activate-now')
    expect(result.items[0]?.trigger).toEqual({ kind: 'surface', surface: 'panel' })
  })

  it('defers onSurface until the surface trigger arrives', () => {
    const result = plan([descriptor('a', { activationEvents: ['onSurface:panel'] })], ['startup'])
    expect(result.items[0]?.action).toBe('defer')
    expect(result.items[0]?.trigger).toEqual({ kind: 'surface', surface: 'panel' })
  })

  it('skips unknown activation tokens', () => {
    const result = plan([descriptor('a', { activationEvents: ['onGalaxy'] })], ['startup'])
    expect(result.items[0]).toEqual({
      id: 'a',
      action: 'skip',
      reason: 'unknown-activation-event',
    })
  })

  it('skips disabled extensions', () => {
    const result = plan([descriptor('a')], [], [], (id) => id !== 'a')
    expect(result.items[0]).toEqual({ id: 'a', action: 'skip', reason: 'disabled' })
  })

  it('skips non craft-sandbox runtimes', () => {
    const result = plan([descriptor('a', { runtime: 'siyuan-plugin' })])
    expect(result.items[0]).toEqual({
      id: 'a',
      action: 'skip',
      reason: 'not-host-executable',
    })
  })

  it('skips invalid descriptors', () => {
    const result = plan([descriptor('a', {}, 'invalid')])
    expect(result.items[0]).toEqual({
      id: 'a',
      action: 'skip',
      reason: 'descriptor-invalid',
    })
  })

  it('skips already-loaded ids (idempotent)', () => {
    const result = plan([descriptor('a')], [], ['a'])
    expect(result.items[0]).toEqual({ id: 'a', action: 'skip', reason: 'already-loaded' })
    expect(result.plannedLoads).toEqual([])
  })

  it('sorts items and plannedLoads deterministically by id', () => {
    const result = plan([descriptor('zeta'), descriptor('alpha'), descriptor('mid')])
    expect(result.items.map((i) => i.id)).toEqual(['alpha', 'mid', 'zeta'])
    expect(result.plannedLoads).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('is independent of descriptor input order', () => {
    const a = descriptor('a', { activationEvents: ['onStartup'] })
    const b = descriptor('b', { activationEvents: [] })
    const one = plan([a, b], ['startup'])
    const two = plan([b, a], ['startup'])
    expect(one).toEqual(two)
  })
})