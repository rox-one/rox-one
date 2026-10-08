import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { toErrorMessage } from '../errors'
import { decideStartupAppState, isStartupAuthorityDenial, probeWithRetry } from '../startup-setup-needs'
import { ensureRoxRuntimeDefault } from '../../components/onboarding/rox-runtime-default'

// Execute the actual App initializer without mounting the unrelated application.
const file = resolve(import.meta.dir, '../../App.tsx')
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let initializer: ts.Expression | undefined
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'initialize' && node.initializer?.getText(source).includes('initializeAuthenticatedWebRenderer')) initializer = node.initializer
  ts.forEachChild(node, visit)
}
visit(source)
if (!initializer) throw new Error('App startup initializer not found')
const code = ts.transpileModule('const actual = ' + initializer.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const nativeIdentity = { userId: 'actor-a', authority: 'native', issuer: 'issuer-a', name: 'Current name' }
const summary = { kind: 'configuration-only', slug: 'omp', providerType: 'omp', isDefault: true }
function harness(overrides: Record<string, unknown> = {}, environmentOverrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const states: string[] = []
  const authorities: unknown[] = []
  const workspaces: unknown[] = []
  const configurations: unknown[] = []
  const runtimeConfigurations: unknown[] = []
  const workspaceConfigurations: unknown[] = []
  const setups: unknown[] = []
  const errors: unknown[] = []
  const taskScopes: unknown[] = []
  const api: Record<string, unknown> = {
    getWindowWorkspace: async () => { calls.push('workspace'); return 'ws-a' },
    getOrgIdentity: async () => { calls.push('identity'); return nativeIdentity },
    getStartupRuntimeSummary: async () => { calls.push('summary'); return summary },
    getRoxCloudState: async () => { calls.push('cloud-account'); return { required: true, connected: true, account: { user: { id: 'cloud-account-a' } } } },
    getSetupNeeds: async () => { calls.push('setup'); return { isFullyConfigured: false } },
    listLlmConnectionsWithStatus: async () => { calls.push('host-accounts'); return [{ slug: 'existing', isDefault: true, providerType: 'omp' }] },
    ...overrides,
  }
  const environment = {
    window: { electronAPI: api },
    webTransportBootstrap: null,
    initializeAuthenticatedWebRenderer: async (_api: unknown, _bootstrap: unknown, hooks: any) => { calls.push('web-initializer'); if (!hooks.isCancelled()) hooks.onWorkspaceReady('web-workspace') },
    markHostSessionsUnavailable: () => { calls.push('host-unavailable') },
    probeWithRetry: (read: () => Promise<unknown>, options?: object) => probeWithRetry(read, { delaysMs: [0], deadlineMs: 3000, ...options }),
    waitForTransportConnected: async () => { calls.push('transport-wait'); return { status: 'connected' } },
    decideStartupAppState, isStartupAuthorityDenial, ensureRoxRuntimeDefault, toErrorMessage,
    setPersonalTaskScope: (value: unknown) => taskScopes.push(value),
    setCallerAuthority: (value: unknown) => authorities.push(value),
    setWindowWorkspaceId: (value: unknown) => workspaces.push(value),
    setSetupNeeds: (value: unknown) => setups.push(value), setLlmConnections: (value: unknown) => configurations.push(value),
    setDefaultLlmConnectionSlug: (value: unknown) => configurations.push(value),
    setRuntimeSummary: (value: unknown) => runtimeConfigurations.push(value),
    setWorkspaceDefaultLlmConnection: (value: unknown) => workspaceConfigurations.push(value),
    setAppState: (value: string) => states.push(value), setStartupBootstrapError: (value: unknown) => errors.push(value),
    resolveDefaultConnectionSlug: (connections: Array<{ slug: string }>) => connections[0]?.slug,
    startupLlmConnectionsPublishedRef: { current: false },
    // Even a stale profile fixture cannot act as startup identity.
    usernameConfirmed: true, storage: { get: () => true },
    t: (key: string) => key, console: { error: () => {} },
    ...environmentOverrides,
  }
  const actual = new Function(...Object.keys(environment), 'let cancelled = false; ' + code + '; return { run: actual, cancel: () => { cancelled = true } }')(...Object.values(environment))
  return { ...actual, calls, states, authorities, workspaces, configurations, runtimeConfigurations, workspaceConfigurations, setups, errors, taskScopes }
}

describe('actual App startup caller boundary', () => {
  it('cached profile completion cannot bypass an identity authorization refusal', async () => {
    let identityCalls = 0
    const h = harness({ getOrgIdentity: async () => { identityCalls++; throw Object.assign(new Error('denied'), { code: 'AUTH_FAILED' }) } })
    await h.run()
    expect(identityCalls).toBe(1)
    expect(h.taskScopes).toEqual([null])
    expect(h.states).toEqual(['transport-unavailable'])
    expect(h.authorities).toEqual([null])
    expect(h.workspaces).toEqual([])
    expect(h.calls).not.toContain('summary')
    expect(h.calls).not.toContain('host-accounts')
  })

  it.each([null, { ...nativeIdentity, authority: 'unknown' }])('missing or unknown fresh identity is unavailable despite cached completion: %j', async identity => {
    const h = harness({ getOrgIdentity: async () => identity })
    await h.run()
    expect(h.states).toEqual(['transport-unavailable'])
    expect(h.workspaces).toEqual([])
    expect(h.configurations).toEqual([])
  })

  it('confirmed native startup uses metadata only and current workspace readback', async () => {
    const h = harness()
    await h.run()
    expect(h.states).toEqual(['ready'])
    expect(h.runtimeConfigurations).toEqual([summary])
    expect(h.workspaceConfigurations).toEqual(['omp'])
    expect(h.authorities).toEqual(['native'])
    expect(h.workspaces).toEqual(['ws-a'])
    expect(h.configurations).toEqual([[], 'omp'])
    expect(h.calls.filter((call: string) => call === 'workspace')).toHaveLength(2)
    // Initial read + final readback; the runtime check reuses the initial identity.
    expect(h.calls.filter((call: string) => call === 'identity')).toHaveLength(2)
    expect(h.calls).not.toContain('host-accounts')
    expect(h.calls).not.toContain('setup')
  })

  it('a ready Pocket account allows local startup without a local display name', async () => {
    const h = harness({ getOrgIdentity: async () => ({ ...nativeIdentity, authority: 'local', name: '' }) })
    await h.run()
    expect(h.states).toEqual(['ready'])
    expect(h.authorities).toEqual(['local'])
    expect(h.calls).toContain('host-accounts')
    expect(h.calls).not.toContain('summary')
  })

  it('local startup lists connections once, without an OAuth refresh, and reuses the list', async () => {
    const listOptions: unknown[] = []
    const ref = { current: false }
    const h = harness({
      getOrgIdentity: async () => ({ ...nativeIdentity, authority: 'local' }),
      listLlmConnectionsWithStatus: async (options?: unknown) => { listOptions.push(options); return [{ slug: 'existing', isDefault: true, providerType: 'omp' }] },
    }, { startupLlmConnectionsPublishedRef: ref })
    await h.run()
    expect(h.states).toEqual(['ready'])
    expect(listOptions).toEqual([{ refresh: false }])
    expect(h.configurations).toEqual([[{ slug: 'existing', isDefault: true, providerType: 'omp' }], 'existing'])
    expect(ref.current).toBe(true)
  })

  it('authoritative null workspace remains a picker result and never invokes transport recovery', async () => {
    const h = harness({ getWindowWorkspace: async () => null })
    await h.run()
    expect(h.states).toEqual(['workspace-picker'])
    expect(h.workspaces).toEqual([null])
    expect(h.calls).not.toContain('transport-wait')
  })

  it('a failed workspace read is rechecked after recovery and is not synthesized from a cached workspace', async () => {
    let reads = 0
    const h = harness({ getWindowWorkspace: async () => { if (++reads <= 2) throw new Error('offline'); return 'recovered-workspace' } })
    await h.run()
    expect(h.states).toEqual(['ready'])
    expect(h.workspaces).toEqual(['recovered-workspace'])
    expect(h.calls).toContain('transport-wait')
    expect(reads).toBe(4)
  })

  it('workspace authorization denial never becomes a picker or successful ready state', async () => {
    const h = harness({ getWindowWorkspace: async () => { throw Object.assign(new Error('denied'), { code: 'FORBIDDEN' }) } })
    await h.run()
    expect(h.states).toEqual(['transport-unavailable'])
    expect(h.workspaces).toEqual([])
    expect(h.calls).not.toContain('transport-wait')
  })

  it.each(['userId', 'authority', 'issuer'])('an identity %s change during runtime read cannot publish old authority', async field => {
    let changed = false
    const h = harness({ getOrgIdentity: async () => changed ? { ...nativeIdentity, [field]: field === 'authority' ? 'local' : 'changed' } : nativeIdentity }, {
      ensureRoxRuntimeDefault: async () => { changed = true; return { status: 'already-default', slug: 'omp' } },
    })
    await h.run()
    expect(h.states).toEqual(['transport-unavailable'])
    expect(h.authorities).toEqual([null])
    expect(h.workspaces).toEqual([])
    expect(h.configurations).toEqual([])
  })

  it('a workspace switch during awaited runtime read cannot publish the old workspace', async () => {
    let workspace = 'ws-a'
    const h = harness({ getWindowWorkspace: async () => workspace }, {
      ensureRoxRuntimeDefault: async () => { workspace = 'ws-b'; return { status: 'already-default', slug: 'omp' } },
    })
    await h.run()
    expect(h.states).toEqual(['transport-unavailable'])
    expect(h.workspaces).toEqual([])
    expect(h.configurations).toEqual([])
  })

  it('clearing a local display name cannot revoke a ready central account', async () => {
    let changed = false
    const h = harness({ getOrgIdentity: async () => ({ ...nativeIdentity, name: changed ? '' : nativeIdentity.name }) }, {
      ensureRoxRuntimeDefault: async () => { changed = true; return { status: 'already-default', slug: 'omp' } },
    })
    await h.run()
    expect(h.states).toEqual(['ready'])
    expect(h.configurations).toEqual([[], 'omp'])
  })

  it('a central account still requires runtime preparation when the local profile changes', async () => {
    let reads = 0
    const h = harness({ getOrgIdentity: async () => ({ ...nativeIdentity, name: ++reads === 1 ? '' : nativeIdentity.name }) })
    await h.run()
    expect(h.states).toEqual(['ready'])
    expect(h.authorities).toEqual(['native'])
    expect(h.calls).toContain('summary')
  })

  it('local setup information cannot publish after an actor switch during runtime setup', async () => {
    let changed = false
    const h = harness({ getOrgIdentity: async () => ({ ...nativeIdentity, authority: 'local', userId: changed ? 'actor-b' : nativeIdentity.userId }) }, {
      ensureRoxRuntimeDefault: async () => { changed = true; return { status: 'already-default', slug: 'omp' } },
    })
    await h.run()
    expect(h.states).toEqual(['transport-unavailable'])
    expect(h.setups).toEqual([])
    expect(h.configurations).toEqual([])
  })

  it('cleanup fences a pending runtime result before any authority or config publication', async () => {
    let release!: (value: unknown) => void
    let began!: () => void
    const started = new Promise<void>(resolve => { began = resolve })
    const h = harness({}, { ensureRoxRuntimeDefault: () => { began(); return new Promise(resolve => { release = resolve }) } })
    const pending = h.run()
    await started
    h.cancel()
    release({ status: 'already-default', slug: 'omp' })
    await pending
    expect(h.states).toEqual([])
    expect(h.authorities).toEqual([])
    expect(h.workspaces).toEqual([])
    expect(h.configurations).toEqual([])
  })

  it('authenticated web startup keeps its acknowledged workspace path and never calls desktop reads', async () => {
    const h = harness({}, { webTransportBootstrap: { workspaceId: 'web-workspace' } })
    await h.run()
    expect(h.calls).toEqual(['web-initializer'])
    expect(h.states).toEqual(['ready'])
    expect(h.authorities).toEqual([null])
    expect(h.workspaces).toEqual(['web-workspace'])
  })
  it('an upgraded named local profile cannot bypass the mandatory cloud gate', async () => {
    const h = harness({ getOrgIdentity: async () => ({ ...nativeIdentity, authority: 'local' }), getRoxCloudState: async () => ({ required: true, connected: false, account: null }) })
    await h.run()
    expect(h.states).toEqual(['onboarding'])
    expect(h.setups.at(-1)).toMatchObject({ needsRoxCloud: true, shouldShowOnboardingOnLaunch: true })
    expect(h.calls).not.toContain('host-accounts')
  })
  it('a failed cloud read is unavailable even with a named local profile and existing workspace', async () => {
    const h = harness({ getRoxCloudState: async () => { throw new Error('offline') } })
    await h.run()
    expect(h.states).toEqual(['transport-unavailable'])
    expect(h.calls).not.toContain('summary')
  })
  it('changing the cloud account during runtime setup requires fresh startup readback', async () => {
    let reads = 0
    const h = harness({ getRoxCloudState: async () => ({ required: true, connected: true, account: { user: { id: ++reads === 1 ? 'account-a' : 'account-b' } } }) })
    await h.run()
    expect(h.states).toEqual(['transport-unavailable'])
    expect(h.configurations).toEqual([])
  })

})
