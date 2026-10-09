/**
 * Local helper-process IPC framing (port row e2.7).
 *
 * One length-prefixed JSON codec for every ROX-owned helper transport:
 *
 *   [4-byte big-endian payload length][UTF-8 JSON payload]
 *
 * The codec is binary-safe (payload length is counted in bytes, never
 * characters), enforces a hard 64 MiB cap before allocating, and surfaces
 * typed failures so callers can distinguish a peer that sent garbage
 * (`malformed`) from one that sent too much (`oversize`) from one that died
 * mid-frame (`truncated`). This module is deliberately dependency-free: it is
 * imported by both the Electron main process and the shared package, and it
 * must never pull in Electron.
 *
 * The wire format is the wire format — a length prefix is the framing. Do not
 * add a second framing (newline-delimited JSON, etc.) to this module; peers
 * that still speak a legacy delimiter are migrated at the transport site.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** Hard cap for a single frame payload (64 MiB). */
export const LOCAL_IPC_MAX_FRAME_BYTES = 64 * 1024 * 1024

/** Width of the big-endian length prefix. */
export const LOCAL_IPC_LENGTH_PREFIX_BYTES = 4

const LENGTH_PREFIX_MAX = 0xffffffff

/** Stable discriminator for every framing failure. */
export type LocalIpcErrorCode = 'oversize' | 'malformed' | 'truncated'

/** Typed framing failure. `code` is the machine contract; `message` is for logs. */
export class LocalIpcFramingError extends Error {
  readonly code: LocalIpcErrorCode

  constructor(code: LocalIpcErrorCode, message: string) {
    super(message)
    this.name = 'LocalIpcFramingError'
    this.code = code
  }
}

const LOCAL_IPC_ERROR_CODES: Record<string, true> = { oversize: true, malformed: true, truncated: true }

/** Structural check that survives duplicate-module boundaries (bundled copies). */
export function isLocalIpcFramingError(value: unknown): value is LocalIpcFramingError {
  if (value instanceof LocalIpcFramingError) return true
  if (typeof value !== 'object' || value === null) return false
  return 'name' in value && value.name === 'LocalIpcFramingError'
    && 'code' in value && typeof value.code === 'string' && LOCAL_IPC_ERROR_CODES[value.code] === true
}

/** JSON text for `value`; a payload that cannot be serialized is `malformed`. */
export function encodeJsonPayload(value: unknown, maxBytes: number = LOCAL_IPC_MAX_FRAME_BYTES): Buffer {
  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch (error) {
    throw new LocalIpcFramingError('malformed', `local IPC payload is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (json === undefined) throw new LocalIpcFramingError('malformed', 'local IPC payload is not JSON-serializable')
  const payload = Buffer.from(json, 'utf8')
  if (payload.byteLength > maxBytes) {
    throw new LocalIpcFramingError('oversize', `local IPC payload exceeds ${maxBytes} bytes (${payload.byteLength})`)
  }
  return payload
}

/** One complete frame: 4-byte big-endian length prefix followed by JSON bytes. */
export function encodeFrame(value: unknown, maxBytes: number = LOCAL_IPC_MAX_FRAME_BYTES): Buffer {
  const payload = encodeJsonPayload(value, maxBytes)
  const frame = Buffer.allocUnsafe(LOCAL_IPC_LENGTH_PREFIX_BYTES + payload.byteLength)
  frame.writeUInt32BE(payload.byteLength, 0)
  payload.copy(frame, LOCAL_IPC_LENGTH_PREFIX_BYTES)
  return frame
}

/** Decode exactly one frame with no trailing bytes. */
export function decodeFrame(frame: Uint8Array, maxBytes: number = LOCAL_IPC_MAX_FRAME_BYTES): unknown {
  const bytes = Buffer.isBuffer(frame) ? frame : Buffer.from(frame)
  if (bytes.byteLength < LOCAL_IPC_LENGTH_PREFIX_BYTES) {
    throw new LocalIpcFramingError('truncated', `local IPC frame is shorter than the ${LOCAL_IPC_LENGTH_PREFIX_BYTES}-byte length prefix`)
  }
  const declared = bytes.readUInt32BE(0)
  if (declared > maxBytes) throw new LocalIpcFramingError('oversize', `local IPC frame declares ${declared} bytes (cap ${maxBytes})`)
  if (bytes.byteLength < LOCAL_IPC_LENGTH_PREFIX_BYTES + declared) {
    throw new LocalIpcFramingError('truncated', `local IPC frame declares ${declared} bytes but only ${bytes.byteLength - LOCAL_IPC_LENGTH_PREFIX_BYTES} were received`)
  }
  if (bytes.byteLength > LOCAL_IPC_LENGTH_PREFIX_BYTES + declared) {
    throw new LocalIpcFramingError('malformed', `local IPC frame has ${bytes.byteLength - LOCAL_IPC_LENGTH_PREFIX_BYTES - declared} trailing byte(s)`)
  }
  return parseJsonPayload(bytes.subarray(LOCAL_IPC_LENGTH_PREFIX_BYTES), maxBytes)
}

function parseJsonPayload(payload: Buffer, maxBytes: number): unknown {
  if (payload.byteLength > maxBytes) throw new LocalIpcFramingError('oversize', `local IPC payload exceeds ${maxBytes} bytes (${payload.byteLength})`)
  const text = payload.toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new LocalIpcFramingError('malformed', 'local IPC payload is not valid JSON')
  }
}

/**
 * Streaming decoder for a socket/pipe. Feed every chunk; each `push` returns
 * the frames fully contained in the accumulated bytes and keeps the remainder.
 * A declared length past the cap fails immediately (before buffering), and a
 * buffer that grows past the cap without completing a frame is `oversize`.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  constructor(private readonly maxBytes: number = LOCAL_IPC_MAX_FRAME_BYTES) {}

  get pendingBytes(): number {
    return this.buffer.byteLength
  }

  push(chunk: Uint8Array): unknown[] {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (incoming.byteLength === 0) return []
    this.buffer = this.buffer.byteLength === 0 ? incoming : Buffer.concat([this.buffer, incoming])
    if (this.buffer.byteLength > this.maxBytes + LOCAL_IPC_LENGTH_PREFIX_BYTES) {
      this.buffer = Buffer.alloc(0)
      throw new LocalIpcFramingError('oversize', `local IPC buffer exceeds ${this.maxBytes} bytes without a complete frame`)
    }
    const frames: unknown[] = []
    for (;;) {
      if (this.buffer.byteLength < LOCAL_IPC_LENGTH_PREFIX_BYTES) break
      const declared = this.buffer.readUInt32BE(0)
      if (declared > this.maxBytes) {
        this.buffer = Buffer.alloc(0)
        throw new LocalIpcFramingError('oversize', `local IPC frame declares ${declared} bytes (cap ${this.maxBytes})`)
      }
      const total = LOCAL_IPC_LENGTH_PREFIX_BYTES + declared
      if (this.buffer.byteLength < total) break
      const payload = this.buffer.subarray(LOCAL_IPC_LENGTH_PREFIX_BYTES, total)
      let value: unknown
      try {
        value = parseJsonPayload(payload, this.maxBytes)
      } catch (error) {
        this.buffer = Buffer.alloc(0)
        throw error
      }
      this.buffer = this.buffer.subarray(total)
      frames.push(value)
    }
    return frames
  }

  /** Finish the stream. A partial frame still buffered is `truncated`. */
  finish(): void {
    if (this.buffer.byteLength === 0) return
    const remaining = this.buffer.byteLength
    this.buffer = Buffer.alloc(0)
    if (remaining < LOCAL_IPC_LENGTH_PREFIX_BYTES) {
      throw new LocalIpcFramingError('truncated', `local IPC stream ended with ${remaining} byte(s) of a length prefix`)
    }
    throw new LocalIpcFramingError('truncated', 'local IPC stream ended before the declared frame was complete')
  }

  reset(): void {
    this.buffer = Buffer.alloc(0)
  }
}

// ---------------------------------------------------------------------------
// Typed request/response envelope
// ---------------------------------------------------------------------------

/** A request envelope. `payload` is opaque to the codec. */
export interface IpcRequestEnvelope<P = unknown> {
  type: 'request'
  id: string
  method: string
  payload: P
}

/** A response envelope: exactly one of `result` (ok) or `error` (not ok). */
export type IpcResponseEnvelope<R = unknown> =
  | { type: 'response'; id: string; ok: true; result: R }
  | { type: 'response'; id: string; ok: false; error: { code: string; message: string } }

export function requestEnvelope<P>(method: string, payload: P, id: string): IpcRequestEnvelope<P> {
  if (typeof method !== 'string' || method.length === 0) throw new LocalIpcFramingError('malformed', 'local IPC request method must be a non-empty string')
  if (typeof id !== 'string' || id.length === 0) throw new LocalIpcFramingError('malformed', 'local IPC request id must be a non-empty string')
  return { type: 'request', id, method, payload }
}

export function okResponse<R>(id: string, result: R): IpcResponseEnvelope<R> {
  return { type: 'response', id, ok: true, result }
}

export function errorResponse(id: string, code: string, message: string): IpcResponseEnvelope<never> {
  return { type: 'response', id, ok: false, error: { code, message } }
}

/** Validate an untrusted request envelope; shape failure is `malformed`. */
export function parseRequestEnvelope(value: unknown): IpcRequestEnvelope {
  if (typeof value !== 'object' || value === null) throw new LocalIpcFramingError('malformed', 'local IPC frame is not a request envelope')
  if (!('type' in value) || value.type !== 'request') throw new LocalIpcFramingError('malformed', 'local IPC frame is not a request envelope')
  if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) throw new LocalIpcFramingError('malformed', 'local IPC request envelope has no id')
  if (!('method' in value) || typeof value.method !== 'string' || value.method.length === 0) throw new LocalIpcFramingError('malformed', 'local IPC request envelope has no method')
  return { type: 'request', id: value.id, method: value.method, payload: 'payload' in value ? value.payload : undefined }
}

/** Validate an untrusted response envelope; shape failure is `malformed`. */
export function parseResponseEnvelope(value: unknown): IpcResponseEnvelope {
  if (typeof value !== 'object' || value === null) throw new LocalIpcFramingError('malformed', 'local IPC frame is not a response envelope')
  if (!('type' in value) || value.type !== 'response') throw new LocalIpcFramingError('malformed', 'local IPC frame is not a response envelope')
  if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) throw new LocalIpcFramingError('malformed', 'local IPC response envelope has no id')
  if (!('ok' in value)) throw new LocalIpcFramingError('malformed', 'local IPC response envelope has no boolean ok')
  if (value.ok === true) return { type: 'response', id: value.id, ok: true, result: 'result' in value ? value.result : undefined }
  if (value.ok === false) {
    const error = 'error' in value ? value.error : undefined
    if (typeof error !== 'object' || error === null
      || !('code' in error) || typeof error.code !== 'string'
      || !('message' in error) || typeof error.message !== 'string') {
      throw new LocalIpcFramingError('malformed', 'local IPC error response has no {code,message}')
    }
    return { type: 'response', id: value.id, ok: false, error: { code: error.code, message: error.message } }
  }
  throw new LocalIpcFramingError('malformed', 'local IPC response envelope has no boolean ok')
}

// ---------------------------------------------------------------------------
// Socket path resolution
// ---------------------------------------------------------------------------

/** `sun_path` limits minus a NUL terminator and headroom for future suffixes. */
const SOCKET_PATH_LIMITS: Record<string, number> = { darwin: 104, linux: 108 }
const SOCKET_PATH_SAFE_LIMIT = 100
const SOCKET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export interface SocketPathOptions {
  /** Directory the caller wants the socket in (e.g. a private runtime dir). */
  dir: string
  /** Base name without extension; `foo` -> `foo.sock`. */
  name: string
  platform?: NodeJS.Platform
  /** Directory used when `dir` would overflow `sun_path` (default: the OS temp dir). */
  shortDir?: string
}

/** Length limit (bytes) for a unix socket path on `platform`; `null` off-unix. */
export function socketPathByteLimit(platform: NodeJS.Platform = process.platform): number | null {
  return SOCKET_PATH_LIMITS[platform] ?? null
}

/**
 * Resolve a unix socket path that fits `sun_path`.
 *
 * The preferred path is `<dir>/<name>.sock`. When that would overflow the
 * platform limit (long TMPDIR, deep app-support paths), the socket is relocated
 * into a short per-hash directory so two distinct preferred paths never
 * collide on one socket.
 */
export function resolveSocketPath({ dir, name, platform = process.platform, shortDir }: SocketPathOptions): string {
  if (!SOCKET_NAME_RE.test(name)) throw new Error(`invalid local IPC socket name: ${name}`)
  if (platform === 'win32') {
    return `\\\\.\\pipe\\rox-${name}-${hashPath(join(dir, name))}`
  }
  const limit = socketPathByteLimit(platform) ?? SOCKET_PATH_SAFE_LIMIT
  const preferred = join(dir, `${name}.sock`)
  if (Buffer.byteLength(preferred) <= limit - 1) return preferred
  const base = shortDir ?? '/tmp'
  const relocated = join(base, `rox-ipc-${hashPath(preferred)}`, `${name}.sock`)
  if (Buffer.byteLength(relocated) > limit - 1) {
    throw new Error(`local IPC socket path cannot fit ${limit} bytes: ${relocated}`)
  }
  return relocated
}

function hashPath(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}