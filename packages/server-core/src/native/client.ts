import { randomUUID } from 'node:crypto'
import { Socket } from 'node:net'
import {
  PROTOCOL_VERSION,
  type MessageEnvelope,
} from '@craft-agent/shared/protocol'
import { encodeFrame, FrameDecoder } from './framing.ts'

const DEFAULT_TIMEOUT_MS = 30_000

export interface NativeSidecarClient {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>
  close(): Promise<void>
  readonly registeredChannels: readonly string[]
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export interface NativeSidecarConnectOptions {
  timeoutMs?: number
  requestTimeoutMs?: number
}

function majorOf(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '0', 10)
}

export async function connectNativeSidecar(
  socketPath: string,
  opts: NativeSidecarConnectOptions = {},
): Promise<NativeSidecarClient> {
  const connectTimeout = opts.timeoutMs ?? 5_000
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const socket = await openUnixSocket(socketPath, connectTimeout)
  const decoder = new FrameDecoder()
  const pending = new Map<string, Pending>()

  const failAll = (error: Error) => {
    for (const p of pending.values()) {
      clearTimeout(p.timeout)
      p.reject(error)
    }
    pending.clear()
  }

  socket.on('data', (chunk: Buffer) => {
    let frames: string[]
    try {
      frames = decoder.push(chunk)
    } catch (error) {
      failAll(error instanceof Error ? error : new Error(String(error)))
      socket.destroy()
      return
    }
    for (const raw of frames) {
      let envelope: MessageEnvelope
      try {
        envelope = JSON.parse(raw) as MessageEnvelope
      } catch {
        continue
      }
      const waiter = pending.get(envelope.id)
      if (!waiter) continue
      pending.delete(envelope.id)
      clearTimeout(waiter.timeout)
      if (envelope.type === 'error' || envelope.error) {
        const code = envelope.error?.code ?? 'HANDLER_ERROR'
        const message = envelope.error?.message ?? 'native sidecar error'
        waiter.reject(Object.assign(new Error(message), { code }))
        continue
      }
      waiter.resolve(envelope)
    }
  })

  socket.on('error', (error: Error) => {
    failAll(error)
  })

  socket.on('close', () => {
    failAll(new Error('native sidecar connection closed'))
  })

  const request = (envelope: MessageEnvelope, timeoutMs: number) =>
    new Promise<MessageEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(envelope.id)
        reject(new Error(`native sidecar timeout: ${envelope.channel ?? envelope.type}`))
      }, timeoutMs)
      pending.set(envelope.id, {
        resolve: (value) => resolve(value as MessageEnvelope),
        reject,
        timeout,
      })
      socket.write(encodeFrame(JSON.stringify(envelope)), (err) => {
        if (err) {
          pending.delete(envelope.id)
          clearTimeout(timeout)
          reject(err)
        }
      })
    })

  const handshakeId = randomUUID()
  let ack: MessageEnvelope
  try {
    ack = await request(
      {
        id: handshakeId,
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: ['native'],
      },
      connectTimeout,
    )
  } catch (error) {
    socket.destroy()
    throw error
  }

  if (ack.type !== 'handshake_ack') {
    socket.destroy()
    throw new Error(`expected handshake_ack, got ${ack.type}`)
  }
  if (!ack.protocolVersion || majorOf(ack.protocolVersion) !== majorOf(PROTOCOL_VERSION)) {
    socket.destroy()
    throw Object.assign(
      new Error(
        `Server protocol ${ack.protocolVersion ?? 'missing'}, client ${PROTOCOL_VERSION}`,
      ),
      { code: 'PROTOCOL_VERSION_UNSUPPORTED' },
    )
  }
  if (!ack.clientId) {
    socket.destroy()
    throw new Error('handshake_ack missing clientId')
  }

  const registeredChannels = ack.registeredChannels ?? []

  return {
    registeredChannels,
    async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      const id = randomUUID()
      const response = await request(
        { id, type: 'request', channel, args },
        requestTimeoutMs,
      )
      if (response.type !== 'response') {
        throw new Error(`expected response for ${channel}, got ${response.type}`)
      }
      return response.result as T
    },
    async close(): Promise<void> {
      failAll(new Error('native sidecar client closed'))
      await new Promise<void>((resolve) => {
        socket.end(() => resolve())
        setTimeout(resolve, 200).unref()
      })
    },
  }
}

function openUnixSocket(socketPath: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`native sidecar connect timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.setNoDelay(true)
      resolve(socket)
    })
    socket.once('error', (error: Error) => {
      clearTimeout(timer)
      socket.destroy()
      reject(error)
    })
    socket.connect({ path: socketPath })
  })
}
