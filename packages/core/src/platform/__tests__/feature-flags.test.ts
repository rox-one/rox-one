import { describe, it, expect } from 'bun:test'
import {
  createFeatureFlagRegistry,
  createWorkbenchFeatureFlagRegistry,
  resolveFlagWithUnifiedShellFallback,
  WORKBENCH_FEATURE_FLAGS,
} from '../feature-flags/index.ts'
import type { FeatureFlagDefinition } from '../feature-flags/index.ts'

function flag(id: string, extra: Partial<FeatureFlagDefinition> = {}): FeatureFlagDefinition {
  return { id, defaultValue: false, dependencies: [], rollbackSafe: true, ...extra }
}

describe('FeatureFlagRegistry', () => {
  it('flags resolve to their default when no override is given', () => {
    const registry = createFeatureFlagRegistry([flag('a'), flag('b', { defaultValue: true })])

    expect(registry.isEnabled('a')).toBe(false)
    expect(registry.isEnabled('b')).toBe(true)
    expect(registry.resolve('b').source).toBe('default')
  })

  it('explicit overrides win over defaults', () => {
    const registry = createFeatureFlagRegistry([flag('a'), flag('b', { defaultValue: true })])

    expect(registry.isEnabled('a', { a: true })).toBe(true)
    expect(registry.isEnabled('b', { b: false })).toBe(false)
    expect(registry.resolve('a', { a: true }).source).toBe('override')
  })

  it('a flag stays disabled while a dependency is disabled, even with an override', () => {
    const registry = createFeatureFlagRegistry([
      flag('base'),
      flag('dependent', { dependencies: ['base'] }),
    ])

    expect(registry.isEnabled('dependent', { dependent: true })).toBe(false)
    expect(registry.resolve('dependent', { dependent: true }).source).toBe('disabled-by-dependency')

    expect(registry.isEnabled('dependent', { base: true, dependent: true })).toBe(true)
  })

  it('dependency chains resolve transitively', () => {
    const registry = createFeatureFlagRegistry([
      flag('l1'),
      flag('l2', { dependencies: ['l1'] }),
      flag('l3', { dependencies: ['l2'] }),
    ])

    expect(registry.isEnabled('l3', { l1: true, l2: true, l3: true })).toBe(true)
    expect(registry.isEnabled('l3', { l1: true, l3: true })).toBe(false)
  })

  it('an unknown dependency disables the flag (validate still reports it)', () => {
    const registry = createFeatureFlagRegistry([
      flag('dependent', { defaultValue: true, dependencies: ['missing-dep'] }),
    ])

    expect(registry.isEnabled('dependent')).toBe(false)
    expect(registry.resolve('dependent').source).toBe('disabled-by-dependency')
    expect(registry.validate()).toEqual(['dependent: unknown dependency "missing-dep"'])
  })

  it('mutual incompatibility is order-independent: lexicographically smaller id wins', () => {
    const registry = createFeatureFlagRegistry([
      flag('beta', { defaultValue: true, incompatibleWith: ['alpha'] }),
      flag('alpha', { defaultValue: true, incompatibleWith: ['beta'] }),
    ])

    expect(registry.isEnabled('alpha')).toBe(true)
    expect(registry.isEnabled('beta')).toBe(false)
    expect(registry.resolve('beta').source).toBe('disabled-by-incompatibility')
  })

  it('the flag declaring an incompatibility yields to the other one', () => {
    const registry = createFeatureFlagRegistry([
      flag('established', { defaultValue: true }),
      flag('challenger', { incompatibleWith: ['established'] }),
    ])

    // Challenger requested but established is on → challenger yields.
    expect(registry.isEnabled('challenger', { challenger: true })).toBe(false)
    expect(registry.resolve('challenger', { challenger: true }).source).toBe('disabled-by-incompatibility')
    // The established flag is unaffected by the challenger's declaration.
    expect(registry.isEnabled('established', { challenger: true })).toBe(true)
    // Once the established flag is off, the challenger can turn on.
    expect(registry.isEnabled('challenger', { challenger: true, established: false })).toBe(true)
  })

  it('throws on unknown flag ids (a flag reference is a programming error)', () => {
    const registry = createFeatureFlagRegistry([flag('a')])

    expect(() => registry.isEnabled('nope')).toThrow()
  })

  it('throws on duplicate registration; the first registration wins', () => {
    const registry = createFeatureFlagRegistry()
    registry.register(flag('a'))

    expect(() => registry.register(flag('a', { defaultValue: true }))).toThrow()
    expect(registry.get('a')?.defaultValue).toBe(false)
  })

  it('validate() reports unknown references', () => {
    const registry = createFeatureFlagRegistry([
      flag('a', { dependencies: ['missing-dep'], incompatibleWith: ['missing-other'] }),
    ])

    expect(registry.validate()).toEqual([
      'a: unknown dependency "missing-dep"',
      'a: unknown incompatibleWith "missing-other"',
    ])
  })

  it('dependency cycles disable the cyclic flags instead of crashing', () => {
    const registry = createFeatureFlagRegistry([
      flag('x', { defaultValue: true, dependencies: ['y'] }),
      flag('y', { defaultValue: true, dependencies: ['x'] }),
      flag('z', { defaultValue: true, dependencies: ['y'] }),
    ])

    expect(registry.isEnabled('x')).toBe(false)
    expect(registry.isEnabled('y')).toBe(false)
    expect(registry.isEnabled('z')).toBe(false)
    expect(registry.resolve('x').source).toBe('disabled-by-cycle')
    expect(registry.resolve('y').source).toBe('disabled-by-cycle')
    expect(registry.resolve('z').source).toBe('disabled-by-dependency')
    expect(registry.validate().join('\n')).toContain('cycle')
  })

  it('resolveAll maps every registered flag', () => {
    const registry = createFeatureFlagRegistry([flag('a'), flag('b', { defaultValue: true })])

    expect(registry.resolveAll({ a: true })).toEqual({ a: true, b: true })
  })

  it('disposing a registration removes the flag and fires onDidChange', () => {
    const registry = createFeatureFlagRegistry()
    let calls = 0
    registry.onDidChange(() => { calls++ })

    const registration = registry.register(flag('a'))
    registration.dispose()

    expect(registry.get('a')).toBeUndefined()
    expect(calls).toBe(2)
  })
})

describe('WORKBENCH_FEATURE_FLAGS catalog (ADR-0001 §39)', () => {
  it('has unique ids and passes validate() with no problems', () => {
    const registry = createWorkbenchFeatureFlagRegistry()

    expect(registry.validate()).toEqual([])
    const ids = registry.list().map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ships with every flag disabled by default', () => {
    const registry = createWorkbenchFeatureFlagRegistry()
    const resolved = registry.resolveAll()

    expect(Object.values(resolved).every((enabled) => !enabled)).toBe(true)
  })

  it('enforces the documented rollout chain: tasks.work-items.v1 needs the workgraph flags', () => {
    const registry = createWorkbenchFeatureFlagRegistry()

    expect(registry.isEnabled('tasks.work-items.v1', { 'tasks.work-items.v1': true })).toBe(false)

    const allOn = Object.fromEntries(
      WORKBENCH_FEATURE_FLAGS.map((f) => [f.id, true]),
    )
    expect(registry.isEnabled('tasks.work-items.v1', allOn)).toBe(true)
  })

  it('workbench.top-chrome.v2 requires the mode registry flag', () => {
    const registry = createWorkbenchFeatureFlagRegistry()

    expect(registry.isEnabled('workbench.top-chrome.v2', { 'workbench.top-chrome.v2': true })).toBe(false)
    expect(
      registry.isEnabled('workbench.top-chrome.v2', {
        'workbench.top-chrome.v2': true,
        'workbench.mode-registry.v1': true,
      }),
    ).toBe(true)
  })

  it('flags that migrate persisted formats are marked migrationRequired', () => {
    const registry = createWorkbenchFeatureFlagRegistry()

    expect(registry.get('workbench.tab-groups.v2')?.migrationRequired).toBe(true)
    expect(registry.get('tasks.work-items.v1')?.migrationRequired).toBe(true)
    expect(registry.get('workbench.status-bar.v1')?.migrationRequired).toBeUndefined()
  })
})

describe('resolveFlagWithUnifiedShellFallback', () => {
  it('OR-falls back to unified shell for additive workbench.* flags only', () => {
    const registry = createWorkbenchFeatureFlagRegistry()

    expect(resolveFlagWithUnifiedShellFallback(registry, 'workbench.status-bar.v1', {}, false)).toBe(false)
    expect(resolveFlagWithUnifiedShellFallback(registry, 'workbench.status-bar.v1', {}, true)).toBe(true)
    expect(resolveFlagWithUnifiedShellFallback(registry, 'workbench.tab-groups.v2', {}, true)).toBe(true)
    expect(resolveFlagWithUnifiedShellFallback(registry, 'workbench.mode-registry.v1', {}, true)).toBe(false)
    expect(resolveFlagWithUnifiedShellFallback(registry, 'workbench.browser-surface.v2', {}, true)).toBe(false)
    expect(resolveFlagWithUnifiedShellFallback(registry, 'workbench.top-chrome.v2', {}, true)).toBe(false)
    expect(resolveFlagWithUnifiedShellFallback(registry, 'workgraph.read.v1', {}, true)).toBe(false)
    expect(resolveFlagWithUnifiedShellFallback(registry, 'tasks.work-items.v1', {}, true)).toBe(false)
    expect(
      resolveFlagWithUnifiedShellFallback(
        registry,
        'workbench.status-bar.v1',
        { 'workbench.status-bar.v1': true },
        false,
      ),
    ).toBe(true)
    expect(
      resolveFlagWithUnifiedShellFallback(
        registry,
        'workbench.mode-registry.v1',
        { 'workbench.mode-registry.v1': true },
        false,
      ),
    ).toBe(true)
  })
})
