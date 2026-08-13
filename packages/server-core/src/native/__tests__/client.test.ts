import { afterEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_VERSION, type MessageEnvelope } from '@craft-agent/shared/protocol'
import { connectNativeSidecar } from '../client.ts'
import { encodeFrame, FrameDecoder } from '../framing.ts'

describe('NativeSidecarClient', () => {
  const dirs: string[] = []
  const servers: Server[] = []

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.close()
      server.unref()
    }
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  async function listenFake(
    onEnvelope: (env: MessageEnvelope, reply: (env: MessageEnvelope) => void) => void,
  ): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'native-client-'))
    dirs.push(dir)
    const socketPath = join(dir, 'n.sock')
    const decoder = new FrameDecoder()
    const server = createServer((sock) => {
      sock.on('data', (chunk) => {
        for (const raw of decoder.push(chunk)) {
          const env = JSON.parse(raw) as MessageEnvelope
          onEnvelope(env, (reply) => {
            sock.write(encodeFrame(JSON.stringify(reply)))
          })
        }
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.listen(socketPath, () => resolve())
      server.once('error', reject)
    })
    return socketPath
  }

  it('handshakes and invokes native:health', async () => {
    const socketPath = await listenFake((env, reply) => {
      if (env.type === 'handshake') {
        reply({
          id: env.id,
          type: 'handshake_ack',
          protocolVersion: PROTOCOL_VERSION,
          clientId: 'fake-sidecar',
          registeredChannels: ['native:health'],
        })
        return
      }
      if (env.type === 'request' && env.channel === 'native:health') {
        reply({
          id: env.id,
          type: 'response',
          channel: env.channel,
          result: { ok: true },
        })
      }
    })
    const client = await connectNativeSidecar(socketPath, { timeoutMs: 1000 })
    expect(client.registeredChannels).toContain('native:health')
    const health = await client.invoke<{ ok: boolean }>('native:health')
    expect(health).toEqual({ ok: true })
    await client.close()
  })

  it('rejects a handshake major mismatch', async () => {
    const socketPath = await listenFake((env, reply) => {
      if (env.type === 'handshake') {
        reply({
          id: env.id,
          type: 'error',
          error: {
            code: 'PROTOCOL_VERSION_UNSUPPORTED',
            message: 'Server protocol 2.0, client 1.0',
          },
        })
      }
    })
    await expect(connectNativeSidecar(socketPath, { timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'PROTOCOL_VERSION_UNSUPPORTED',
    })
  })
})
