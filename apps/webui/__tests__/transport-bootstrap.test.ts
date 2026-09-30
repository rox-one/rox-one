import { describe, expect, it } from 'bun:test'
import { resolveDefaultWorkspace, waitForWorkspaceAck, initializeAuthenticatedWebTransport } from '../src/adapter/transport-bootstrap'
import { validateAuthenticatedWebBootstrap, initializeAuthenticatedWebRenderer } from '../../electron/src/renderer/lib/authenticated-web-bootstrap'

function connection() {
  let state: any = { status: 'idle' }
  let workspace: string | null = null
  const listeners = new Set<(state: any) => void>()
  let destroyed = false
  const client = {
    getConnectionState: () => state,
    getAcknowledgedWorkspaceId: () => workspace,
    onConnectionStateChanged: (listener: (state: any) => void) => {
      listeners.add(listener); listener(state)
      return () => { listeners.delete(listener) }
    },
    connect() {},
    destroy() { destroyed = true },
  }
  return { client, listeners, get destroyed() { return destroyed }, emit(status: string, id: string | null = null) {
    workspace = id; state = { status, lastError: status === 'failed' ? { message: 'Access denied' } : undefined }
    for (const listener of listeners) listener(state)
  } }
}

const bootstrap = { kind: 'authenticated-web-transport' as const, workspaceId: 'private-workspace' }

describe('authenticated WebUI workspace bootstrap', () => {
  it('uses only the authoritative HTTP default, including an exact URL match', () => {
    expect(resolveDefaultWorkspace({ defaultWorkspaceId: 'private-workspace' }, null)).toBe('private-workspace')
    expect(resolveDefaultWorkspace({ defaultWorkspaceId: 'private-workspace' }, 'private-workspace')).toBe('private-workspace')
  })

  for (const invalid of [null, {}, { defaultWorkspaceId: null }, { defaultWorkspaceId: '' }, { defaultWorkspaceId: ' ' }, { defaultWorkspaceId: ' ws ' }, { defaultWorkspaceId: 42 }]) {
    it(`refuses missing or malformed default ${JSON.stringify(invalid)}`, () => {
      expect(() => resolveDefaultWorkspace(invalid, null)).toThrow('Server has no configured default workspace')
    })
  }

  it('refuses mismatched and empty URL workspace rather than replacing the default', () => {
    expect(() => resolveDefaultWorkspace({ defaultWorkspaceId: 'private-workspace' }, 'other')).toThrow('does not match')
    expect(() => resolveDefaultWorkspace({ defaultWorkspaceId: 'private-workspace' }, '')).toThrow('does not match')
  })

  it('requires a real connected ACK with the exact workspace', async () => {
    const fixture = connection()
    const ready = waitForWorkspaceAck(fixture.client, 'private-workspace', new AbortController().signal, 100)
    fixture.emit('connecting')
    expect(fixture.listeners.size).toBe(1)
    fixture.emit('connected', 'private-workspace')
    await ready
    expect(fixture.listeners.size).toBe(0)
  })

  for (const id of [null, 'other']) {
    it(`refuses connected ACK with ${id === null ? 'missing' : 'mismatched'} workspace`, async () => {
      const fixture = connection()
      const ready = waitForWorkspaceAck(fixture.client, 'private-workspace', new AbortController().signal, 100)
      fixture.emit('connected', id)
      await expect(ready).rejects.toThrow('acknowledged workspace does not match')
      expect(fixture.listeners.size).toBe(0)
    })
  }

  it('refuses denied handshakes and bounds an unanswered handshake', async () => {
    const denied = connection()
    const ready = waitForWorkspaceAck(denied.client, 'private-workspace', new AbortController().signal, 100)
    denied.emit('failed')
    await expect(ready).rejects.toThrow('Access denied')
    expect(denied.listeners.size).toBe(0)
    const silent = connection()
    await expect(waitForWorkspaceAck(silent.client, 'private-workspace', new AbortController().signal, 5)).rejects.toThrow('Timed out')
    expect(silent.listeners.size).toBe(0)
  })

  it('cancels an active waiter and ignores a late ACK', async () => {
    const fixture = connection()
    const controller = new AbortController()
    const ready = waitForWorkspaceAck(fixture.client, 'private-workspace', controller.signal, 100)
    controller.abort()
    fixture.emit('connected', 'private-workspace')
    await expect(ready).rejects.toThrow('cancelled')
    expect(fixture.listeners.size).toBe(0)
  })

  it('removes an immediately satisfied subscription', async () => {
    const fixture = connection()
    fixture.emit('connected', 'private-workspace')
    await waitForWorkspaceAck(fixture.client, 'private-workspace', new AbortController().signal, 100)
    expect(fixture.listeners.size).toBe(0)
  })

  it('checks browser runtime and actual adapter binding without desktop/provider/native calls', async () => {
    const calls: string[] = []
    const api: any = new Proxy({}, { get(_target, property) {
      calls.push(String(property))
      if (property === 'getRuntimeEnvironment') return () => 'web'
      if (property === 'getWindowWorkspace') return async () => 'private-workspace'
      throw new Error(`Forbidden bootstrap API: ${String(property)}`)
    } })
    await expect(validateAuthenticatedWebBootstrap(api, bootstrap)).resolves.toBe('private-workspace')
    expect(calls).toEqual(['getRuntimeEnvironment', 'getWindowWorkspace'])
    await expect(validateAuthenticatedWebBootstrap({ ...api, getRuntimeEnvironment: () => 'electron' } as any, bootstrap)).rejects.toThrow('browser runtime')
    await expect(validateAuthenticatedWebBootstrap({ getRuntimeEnvironment: () => 'web', getWindowWorkspace: async () => 'other' } as any, bootstrap)).rejects.toThrow('binding changed')
    for (const invalid of [{ ...bootstrap, kind: 'local' }, { ...bootstrap, workspaceId: '' }, { ...bootstrap, workspaceId: ' ws ' }]) {
      await expect(validateAuthenticatedWebBootstrap(api, invalid as any)).rejects.toThrow('valid workspace')
    }
  })

  it('refuses a stale fetch completion and permits a separate retry without leaked clients', async () => {
    const stale = new AbortController()
    let release!: (response: Response) => void
    let created = 0
    const staleRun = initializeAuthenticatedWebTransport({
      fetch: (() => new Promise<Response>(resolve => { release = resolve })) as typeof fetch,
      requestedWorkspace: null, signal: stale.signal,
      createAdapter: () => { created++; throw new Error('Should not create stale adapter') },
    })
    stale.abort()
    release(new Response(JSON.stringify({ wsUrl: 'ws://127.0.0.1:1' })))
    await expect(staleRun).rejects.toThrow('cancelled')
    expect(created).toBe(0)

    const fixture = connection()
    fixture.client.connect = () => fixture.emit('connected', 'private-workspace')
    const api = { getRuntimeEnvironment: () => 'web', getWindowWorkspace: async () => 'private-workspace' } as any
    let request = 0
    const retry = await initializeAuthenticatedWebTransport({
      fetch: (async () => new Response(JSON.stringify(request++ === 0 ? { wsUrl: 'ws://127.0.0.1:1' } : { defaultWorkspaceId: 'private-workspace' }))) as typeof fetch,
      requestedWorkspace: null, signal: new AbortController().signal,
      createAdapter: () => ({ api, client: fixture.client }),
    })
    expect(retry.bootstrap).toEqual(bootstrap)
    expect(fixture.destroyed).toBe(false)
  })

  it('destroys the owned client when an acknowledged workspace is rejected', async () => {
    const fixture = connection()
    fixture.client.connect = () => fixture.emit('connected', 'other')
    let request = 0
    await expect(initializeAuthenticatedWebTransport({
      fetch: (async () => new Response(JSON.stringify(request++ === 0 ? { wsUrl: 'ws://127.0.0.1:1' } : { defaultWorkspaceId: 'private-workspace' }))) as typeof fetch,
      requestedWorkspace: null, signal: new AbortController().signal,
      createAdapter: () => ({ api: {} as any, client: fixture.client }),
    })).rejects.toThrow('acknowledged workspace does not match')
    expect(fixture.destroyed).toBe(true)
  })

  it('cancels during the handshake and destroys the owned client', async () => {
    const fixture = connection()
    const controller = new AbortController()
    let request = 0
    fixture.client.connect = () => controller.abort()
    await expect(initializeAuthenticatedWebTransport({
      fetch: (async () => new Response(JSON.stringify(request++ === 0 ? { wsUrl: 'ws://127.0.0.1:1' } : { defaultWorkspaceId: 'private-workspace' }))) as typeof fetch,
      requestedWorkspace: null, signal: controller.signal,
      createAdapter: () => ({ api: {} as any, client: fixture.client }),
    })).rejects.toThrow('cancelled')
    expect(fixture.destroyed).toBe(true)
  })

  it('refuses a stale adapter validation after cancellation', async () => {
    const fixture = connection()
    fixture.client.connect = () => fixture.emit('connected', 'private-workspace')
    const controller = new AbortController()
    let release!: (id: string) => void
    let request = 0
    const pending = initializeAuthenticatedWebTransport({
      fetch: (async () => new Response(JSON.stringify(request++ === 0 ? { wsUrl: 'ws://127.0.0.1:1' } : { defaultWorkspaceId: 'private-workspace' }))) as typeof fetch,
      requestedWorkspace: null, signal: controller.signal,
      createAdapter: () => ({ api: { getRuntimeEnvironment: () => 'web', getWindowWorkspace: () => new Promise<string>(resolve => { release = resolve }) } as any, client: fixture.client }),
    })
    while (!release) await new Promise(resolve => setTimeout(resolve, 1))
    controller.abort()
    release('private-workspace')
    await expect(pending).rejects.toThrow('cancelled')
    expect(fixture.destroyed).toBe(true)
  })

  it('does not create an adapter for denied HTTP config or mismatched URL scope', async () => {
    let created = 0
    const createAdapter = (): never => { created++; throw new Error('Unexpected adapter') }
    await expect(initializeAuthenticatedWebTransport({ fetch: (async () => new Response('', { status: 401 })) as typeof fetch,
      requestedWorkspace: null, signal: new AbortController().signal, createAdapter })).rejects.toThrow('401')
    let request = 0
    await expect(initializeAuthenticatedWebTransport({
      fetch: (async () => new Response(JSON.stringify(request++ === 0 ? { wsUrl: 'ws://127.0.0.1:1' } : { defaultWorkspaceId: 'private-workspace' }))) as typeof fetch,
      requestedWorkspace: 'other', signal: new AbortController().signal, createAdapter,
    })).rejects.toThrow('does not match')
    expect(created).toBe(0)
  })

  it('finishes renderer readiness through unavailable-host callback before mounting the bound workspace', async () => {
    const calls: string[] = []
    const api: any = new Proxy({}, { get(_target, property) {
      calls.push(String(property))
      if (property === 'getRuntimeEnvironment') return () => 'web'
      if (property === 'getWindowWorkspace') return async () => 'private-workspace'
      throw new Error(`Forbidden desktop/provider/native startup API: ${String(property)}`)
    } })
    let sessionsReady = false
    let state: string = 'loading'
    let workspace: string | null = null
    const order: string[] = []
    await initializeAuthenticatedWebRenderer(api, bootstrap, {
      isCancelled: () => false,
      markHostSessionsUnavailable: () => { order.push('unavailable'); sessionsReady = true },
      onWorkspaceReady: id => { order.push('ready'); workspace = id; state = 'ready' },
    })
    expect({ state, sessionsReady, workspace }).toEqual({ state: 'ready', sessionsReady: true, workspace: 'private-workspace' })
    expect(order).toEqual(['unavailable', 'ready'])
    expect(calls).toEqual(['getRuntimeEnvironment', 'getWindowWorkspace'])
  })

  it('does not apply stale renderer readiness callbacks after cancellation', async () => {
    let release!: (id: string) => void
    let cancelled = false, callbacks = 0
    const pending = initializeAuthenticatedWebRenderer({ getRuntimeEnvironment: () => 'web',
      getWindowWorkspace: () => new Promise(resolve => { release = resolve }) }, bootstrap, {
      isCancelled: () => cancelled,
      markHostSessionsUnavailable: () => { callbacks++ },
      onWorkspaceReady: () => { callbacks++ },
    })
    cancelled = true
    release('private-workspace')
    await pending
    expect(callbacks).toBe(0)
  })
})
