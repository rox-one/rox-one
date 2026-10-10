import { createHash } from 'node:crypto'
import { describe, expect, it } from 'bun:test'

import {
  FrameDecoder,
  LOCAL_IPC_LENGTH_PREFIX_BYTES,
  LOCAL_IPC_MAX_FRAME_BYTES,
  LocalIpcFramingError,
  decodeFrame,
  encodeFrame,
  encodeJsonPayload,
  errorResponse,
  isLocalIpcFramingError,
  okResponse,
  parseRequestEnvelope,
  parseResponseEnvelope,
  requestEnvelope,
  resolveSocketPath,
  socketPathByteLimit,
} from '../framing'

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (isLocalIpcFramingError(error)) return error.code
    throw error
  }
  throw new Error('expected the call to throw')
}

describe('local IPC length-prefixed codec', () => {
  it('round-trips JSON values through a 4-byte big-endian length prefix', () => {
    const values = [
      { ok: true, result: { state: 'running' } },
      [],
      [{ a: 1 }, { b: 2 }],
      { text: 'héllo — 世界 🎉' },
      { nested: { deep: { value: null } } },
    ]
    for (const value of values) {
      const frame = encodeFrame(value)
      expect(frame.readUInt32BE(0)).toBe(frame.byteLength - LOCAL_IPC_LENGTH_PREFIX_BYTES)
      expect(decodeFrame(frame)).toEqual(value)
    }
  })

  it('reports oversize before allocating when a payload exceeds the cap', () => {
    expect(codeOf(() => encodeFrame({ data: 'x'.repeat(64) }, 32))).toBe('oversize')

    const tooBig = Buffer.alloc(LOCAL_IPC_LENGTH_PREFIX_BYTES + 8)
    tooBig.writeUInt32BE(8, 0)
    expect(codeOf(() => decodeFrame(tooBig, 4))).toBe('oversize')

    expect(codeOf(() => encodeJsonPayload(undefined))).toBe('malformed')
  })

  it('reports malformed for invalid JSON and trailing bytes', () => {
    const invalid = Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.from('nope')])
    expect(codeOf(() => decodeFrame(invalid))).toBe('malformed')

    const trailing = Buffer.concat([encodeFrame({ a: 1 }), Buffer.from([0])])
    expect(codeOf(() => decodeFrame(trailing))).toBe('malformed')
  })

  it('reports truncated for short prefixes and incomplete frames', () => {
    expect(codeOf(() => decodeFrame(Buffer.from([0, 0, 1])))).toBe('truncated')

    const partial = Buffer.alloc(LOCAL_IPC_LENGTH_PREFIX_BYTES + 2)
    partial.writeUInt32BE(10, 0)
    expect(codeOf(() => decodeFrame(partial))).toBe('truncated')
  })

  it('marks framing errors with a stable name for bundled copies', () => {
    const error = new LocalIpcFramingError('oversize', 'too big')
    expect(isLocalIpcFramingError(error)).toBe(true)
    expect(isLocalIpcFramingError({ name: 'LocalIpcFramingError', code: 'malformed' })).toBe(true)
    expect(isLocalIpcFramingError({ name: 'Error', code: 'malformed' })).toBe(false)
    expect(isLocalIpcFramingError(new Error('x'))).toBe(false)
  })
})

describe('local IPC streaming decoder', () => {
  it('reassembles a frame split across arbitrary chunks', () => {
    const frame = encodeFrame({ hello: 'world' })
    const decoder = new FrameDecoder()
    const frames: unknown[] = []
    for (let i = 0; i < frame.byteLength; i++) {
      frames.push(...decoder.push(frame.subarray(i, i + 1)))
    }
    expect(frames).toEqual([{ hello: 'world' }])
    decoder.finish()
  })

  it('emits every complete frame in one chunk', () => {
    const decoder = new FrameDecoder()
    expect(decoder.push(Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 }), encodeFrame({ n: 3 })])))
      .toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  })

  it('reports a declared length over the cap without buffering it', () => {
    const header = Buffer.alloc(LOCAL_IPC_LENGTH_PREFIX_BYTES)
    header.writeUInt32BE(1024, 0)
    expect(codeOf(() => new FrameDecoder(16).push(header))).toBe('oversize')
  })

  it('reports truncated when the stream ends mid-frame', () => {
    const decoder = new FrameDecoder()
    decoder.push(encodeFrame({ a: 1 }).subarray(0, 6))
    expect(codeOf(() => decoder.finish())).toBe('truncated')

    const headerOnly = new FrameDecoder()
    headerOnly.push(Buffer.from([0, 0]))
    expect(codeOf(() => headerOnly.finish())).toBe('truncated')
  })
})

describe('local IPC request/response envelope', () => {
  it('round-trips request and response envelopes', () => {
    const request = requestEnvelope('status', { verbose: true }, 'req-1')
    expect(parseRequestEnvelope(JSON.parse(JSON.stringify(request)))).toEqual(request)

    const ok = okResponse('req-1', { state: 'running' })
    expect(parseResponseEnvelope(JSON.parse(JSON.stringify(ok)))).toEqual(ok)

    const failed = errorResponse('req-1', 'denied', 'not allowed')
    expect(parseResponseEnvelope(JSON.parse(JSON.stringify(failed)))).toEqual(failed)
  })

  it('rejects malformed envelopes with a typed error', () => {
    expect(codeOf(() => parseRequestEnvelope({ type: 'response', id: 'x' }))).toBe('malformed')
    expect(codeOf(() => parseRequestEnvelope({ type: 'request', id: 'x' }))).toBe('malformed')
    expect(codeOf(() => parseResponseEnvelope(null))).toBe('malformed')
    expect(codeOf(() => parseResponseEnvelope({ type: 'response', id: 'x' }))).toBe('malformed')
    expect(codeOf(() => parseResponseEnvelope({ type: 'response', id: 'x', ok: false, error: {} }))).toBe('malformed')
  })
})

describe('local IPC socket path resolver', () => {
  it('keeps a short socket path under the requested directory', () => {
    expect(resolveSocketPath({ dir: '/tmp/rox-1', name: 'app-control', platform: 'darwin' }))
      .toBe('/tmp/rox-1/app-control.sock')
    expect(resolveSocketPath({ dir: '/run/user/1000', name: 'exec-approvals', platform: 'linux' }))
      .toBe('/run/user/1000/exec-approvals.sock')
  })

  it('relocates a long path into a short hashed directory within the sun_path limit', () => {
    const dir = `/Users/somebody/Library/Application Support/${'deep/'.repeat(20)}runtime`
    const resolved = resolveSocketPath({ dir, name: 'app-control', platform: 'darwin', shortDir: '/tmp' })
    expect(resolved).not.toContain('Application Support')
    expect(resolved.endsWith('/app-control.sock')).toBe(true)
    expect(Buffer.byteLength(resolved)).toBeLessThanOrEqual(socketPathByteLimit('darwin')! - 1)
    // Deterministic: the same preferred path always relocates the same way.
    expect(resolveSocketPath({ dir, name: 'app-control', platform: 'darwin', shortDir: '/tmp' })).toBe(resolved)
  })

  it('rejects unsafe names and exposes per-platform limits', () => {
    expect(() => resolveSocketPath({ dir: '/tmp', name: 'bad/name', platform: 'darwin' })).toThrow()
    expect(socketPathByteLimit('darwin')).toBe(104)
    expect(socketPathByteLimit('linux')).toBe(108)
    expect(socketPathByteLimit('win32')).toBeNull()
    expect(resolveSocketPath({ dir: '/tmp', name: 'app-control', platform: 'win32' }))
      .toBe(`\\\\.\\pipe\\rox-app-control-${createHash('sha256').update('/tmp/app-control').digest('hex').slice(0, 16)}`)
  })

  it('uses the default 64 MiB cap', () => {
    expect(LOCAL_IPC_MAX_FRAME_BYTES).toBe(64 * 1024 * 1024)
  })
})