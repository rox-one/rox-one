import { describe, expect, it } from 'bun:test'
import type { ElectronAPI } from '../../electron/src/shared/types'
import type { TransportConnectionState } from '../../electron/src/transport/client'
import {
  initializeAuthenticatedWebTransport,
  readHandoffToken,
  redeemHandoffFragment,
  redeemHandoffToken,
} from '../src/adapter/transport-bootstrap'

const TOKEN = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg'

describe('readHandoffToken', () => {
  it('reads a bare or prefixed token from the fragment', () => {
    expect(readHandoffToken(`#${TOKEN}`)).toBe(TOKEN)
    expect(readHandoffToken(`#handoff=${TOKEN}`)).toBe(TOKEN)
  })

  it('ignores non-token fragments', () => {
    expect(readHandoffToken('')).toBeNull()
    expect(readHandoffToken('#')).toBeNull()
    expect(readHandoffToken('#section-2')).toBeNull()
    expect(readHandoffToken('#short')).toBeNull()
  })
})

describe('redeemHandoffToken', () => {
  it('sends the token in a header, never in the URL', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(null, { status: 200 })
    }) as typeof fetch

    await redeemHandoffToken({ fetch: fetchImpl, token: TOKEN, signal: new AbortController().signal })

    expect(calls.length).toBe(1)
    expect(calls[0]!.url).toBe('/handoff')
    expect(calls[0]!.url).not.toContain(TOKEN)
    const headers = new Headers(calls[0]!.init?.headers)
    expect(headers.get('x-handoff-token')).toBe(TOKEN)
    expect(calls[0]!.init?.method).toBe('GET')
    expect(calls[0]!.init?.credentials).toBe('same-origin')
  })

  it('throws on rejection', async () => {
    const fetchImpl = (async () => new Response(null, { status: 401 })) as typeof fetch
    await expect(redeemHandoffToken({ fetch: fetchImpl, token: TOKEN, signal: new AbortController().signal }))
      .rejects.toThrow('rejected or expired')
  })
})

describe('redeemHandoffFragment', () => {
  it('redeems a fragment token and strips it from the URL', async () => {
    const urls: string[] = []
    let replaced: string | undefined
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url))
      return new Response(null, { status: 200 })
    }) as typeof fetch

    const redeemed = await redeemHandoffFragment({
      fetch: fetchImpl,
      signal: new AbortController().signal,
      location: { hash: `#${TOKEN}`, pathname: '/handoff', search: '' },
      replaceUrl: url => { replaced = url },
    })

    expect(redeemed).toBe(true)
    expect(urls).toEqual(['/handoff'])
    expect(urls.every(url => !url.includes(TOKEN))).toBe(true)
    expect(replaced).toBe('/handoff')
  })

  it('does nothing without a token or a location', async () => {
    let called = 0
    const fetchImpl = (async () => { called++; return new Response(null, { status: 200 }) }) as typeof fetch

    expect(await redeemHandoffFragment({ fetch: fetchImpl, signal: new AbortController().signal })).toBe(false)
    expect(await redeemHandoffFragment({
      fetch: fetchImpl,
      signal: new AbortController().signal,
      location: { hash: '#anchor', pathname: '/', search: '?workspace=x' },
    })).toBe(false)
    expect(called).toBe(0)
  })
})

describe('bootstrap redemption ordering', () => {
  it('redeems the handoff fragment before fetching authenticated config', async () => {
    const order: string[] = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      order.push(path)
      if (path === '/handoff') {
        expect(new Headers(init?.headers).get('x-handoff-token')).toBe(TOKEN)
        return new Response(null, { status: 200 })
      }
      if (path === '/api/config') return Response.json({ wsUrl: 'ws://127.0.0.1:1' })
      if (path === '/api/config/workspaces') return Response.json({ defaultWorkspaceId: 'private-workspace' })
      return new Response(null, { status: 404 })
    }) as typeof fetch

    const listeners = new Set<(state: TransportConnectionState) => void>()
    let state: TransportConnectionState = { status: 'idle' }
    const client = {
      getConnectionState: () => state,
      getAcknowledgedWorkspaceId: () => 'private-workspace',
      onConnectionStateChanged: (listener: (state: TransportConnectionState) => void) => {
        listeners.add(listener)
        listener(state)
        return () => { listeners.delete(listener) }
      },
      connect: () => {
        state = { status: 'connected' }
        for (const listener of listeners) listener(state)
      },
      destroy: () => {},
    }

    let replaced: string | undefined
    // Minimal ElectronAPI stub: the bootstrap only touches these two methods.
    const api = { getRuntimeEnvironment: () => 'web', getWindowWorkspace: async () => 'private-workspace' } as unknown as ElectronAPI
    const result = await initializeAuthenticatedWebTransport({
      fetch: fetchImpl,
      requestedWorkspace: null,
      signal: new AbortController().signal,
      location: { hash: `#${TOKEN}`, pathname: '/handoff', search: '' },
      replaceUrl: url => { replaced = url },
      createAdapter: () => ({ api, client }),
    })

    expect(order[0]).toBe('/handoff')
    expect(order).toEqual(['/handoff', '/api/config', '/api/config/workspaces'])
    expect(replaced).toBe('/handoff')
    expect(result.bootstrap.workspaceId).toBe('private-workspace')
  })
})