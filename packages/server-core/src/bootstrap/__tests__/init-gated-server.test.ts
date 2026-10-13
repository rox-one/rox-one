import { afterEach, describe, expect, it } from 'bun:test'
import { WsRpcClient } from '../../transport/client'
import { WsRpcServer } from '../../transport/server'
import { gateRpcServerOnInitialization } from '../init-gated-server.ts'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!check() && Date.now() < deadline) await Bun.sleep(2)
  expect(check()).toBe(true)
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function harness() {
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false })
  await server.listen()
  cleanups.push(() => server.close())
  const init = deferred()
  let initWaits = 0
  const gated = gateRpcServerOnInitialization(server, () => {
    initWaits++
    return init.promise
  })
  const calls: string[] = []
  gated.handle('theme:getApp', () => { calls.push('theme:getApp'); return 'theme' })
  gated.handle('system:versions', () => { calls.push('system:versions'); return 'versions' })
  gated.handle('sessions:get', () => { calls.push('sessions:get'); return ['session-a'] })
  gated.handle('window:getWorkspace', () => { calls.push('window:getWorkspace'); return 'ws-a' })
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { autoReconnect: false, connectTimeout: 1_000 })
  cleanups.push(() => client.destroy())
  client.connect()
  await until(() => client.getConnectionState().status === 'connected')
  return { server, gated, init, client, calls, initWaits: () => initWaits }
}

describe('gateRpcServerOnInitialization', () => {
  it('answers config/theme/version channels before initialization without waiting', async () => {
    const h = await harness()
    expect(await h.client.invoke('theme:getApp')).toBe('theme')
    expect(await h.client.invoke('system:versions')).toBe('versions')
    expect(h.calls).toEqual(['theme:getApp', 'system:versions'])
    expect(h.initWaits()).toBe(0)
  })

  it('holds session-dependent channels until initialization resolves, then runs them once', async () => {
    const h = await harness()
    let settled = false
    const sessions = h.client.invoke('sessions:get').then((value) => { settled = true; return value })
    const workspace = h.client.invoke('window:getWorkspace')
    await until(() => h.initWaits() === 2)
    // An ungated round trip after the gated requests proves they are parked, not in flight.
    expect(await h.client.invoke('theme:getApp')).toBe('theme')
    expect(settled).toBe(false)
    expect(h.calls).toEqual(['theme:getApp'])

    h.init.resolve()
    expect(await sessions).toEqual(['session-a'])
    expect(await workspace).toBe('ws-a')
    expect(h.calls).toEqual(['theme:getApp', 'sessions:get', 'window:getWorkspace'])
  })

  it('rejects gated channels with the initialization failure and never runs their handler', async () => {
    const h = await harness()
    const sessions = h.client.invoke('sessions:get')
    await until(() => h.initWaits() === 1)
    h.init.reject(new Error('migrations failed'))
    await expect(sessions).rejects.toThrow('migrations failed')
    expect(h.calls).toEqual([])
    expect(await h.client.invoke('theme:getApp')).toBe('theme')
  })

  it('delegates every other member to the real server', async () => {
    const h = await harness()
    expect(h.gated.port).toBe(h.server.port)
    expect(h.gated.getConnectedClientCount()).toBe(1)
    expect(() => h.gated.handle('theme:getApp', () => 'again')).toThrow('Handler already registered for channel: theme:getApp')
  })
})
