import { afterEach, describe, expect, it } from 'bun:test'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createConnection } from 'node:net'

import { AppControlClient } from '../client.ts'
import { ExecApprovalsServer, type ExecSpawn } from '../exec-approvals.ts'
import { FrameDecoder, encodeFrame } from '@rox/shared/local-ipc/framing'
import { parseAppControlResponse } from '../protocol.ts'
import { makeTempEnv, refusalCode, type TempEnv } from './helpers.ts'

interface Harness {
  env: TempEnv
  server: ExecApprovalsServer
  client: AppControlClient
  children: ChildProcess[]
}

const harnesses: Harness[] = []

async function execServer(): Promise<Harness> {
  const env = await makeTempEnv()
  const children: ChildProcess[] = []
  const spawnFn: ExecSpawn = (command, args, options) => {
    const child = nodeSpawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: 'ignore' })
    children.push(child)
    return child
  }
  const server = new ExecApprovalsServer({
    socketPath: env.socketPath,
    tokenPath: env.tokenPath,
    secret: 'shared',
    expectedUid: process.getuid?.(),
    peerUidReader: () => process.getuid?.() ?? 0,
    spawn: spawnFn,
  })
  await server.listen()
  const harness = { env, server, client: new AppControlClient({ socketPath: env.socketPath, secret: 'shared' }), children }
  harnesses.push(harness)
  return harness
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.server.close()
    await harness.env.dispose()
  }
})

describe('exec-approvals socket', () => {
  it('spawns a child and kills it when the owning request connection closes', async () => {
    const { client, server, children } = await execServer()
    const session = await client.connect()
    const launched = await session.send<{ id: string; pid: number }>('exec', { command: 'sleep', args: ['60'] })
    expect(launched.pid).toBeGreaterThan(0)
    expect(server.ownedPids()).toContain(launched.pid)

    const child = children[0]!
    const exited = once(child, 'exit')
    session.close()
    await exited
    expect(child.killed).toBe(true)
    expect(server.ownedPids()).toEqual([])
  })

  it('kills the child when the request is explicitly cancelled', async () => {
    const { client, children } = await execServer()
    const session = await client.connect()
    const launched = await session.send<{ id: string; pid: number }>('exec', { command: 'sleep', args: ['60'] })
    const child = children[0]!
    const exited = once(child, 'exit')
    const cancelled = await session.send<{ killed: boolean }>('cancel', { id: launched.id })
    expect(cancelled.killed).toBe(true)
    await exited
    expect(child.killed).toBe(true)
    session.close()
  })

  it('reports killed=false for an unknown request id', async () => {
    const { client } = await execServer()
    const session = await client.connect()
    expect(await session.send<{ killed: boolean }>('cancel', { id: 'does-not-exist' })).toEqual({ killed: false })
    session.close()
  })

  it('refuses a bad token on the approval socket too', async () => {
    const { env } = await execServer()
    const frame = encodeFrame({
      type: 'request',
      v: 1,
      id: 'x',
      method: 'exec',
      payload: { command: 'sleep', args: ['60'] },
      auth: { nonce: 'n', ts: Date.now(), mac: 'deadbeef' },
    })
    const socket = createConnection(env.socketPath)
    const decoder = new FrameDecoder()
    const { promise, resolve } = Promise.withResolvers<string>()
    await new Promise<void>((resolveConnect) => socket.once('connect', resolveConnect))
    socket.on('data', (chunk: Buffer) => {
      for (const candidate of decoder.push(chunk)) {
        const response = parseAppControlResponse(candidate)
        if (response) resolve(refusalCode(response))
      }
    })
    socket.write(frame)
    const code = await promise
    socket.destroy()
    expect(code).toBe('bad-token')
  })
})