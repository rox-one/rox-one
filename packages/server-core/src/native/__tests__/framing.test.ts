import { describe, expect, it } from 'bun:test'
import { encodeFrame, FrameDecoder } from '../framing.ts'

describe('native UDS framing', () => {
  it('round-trips a JSON envelope through 4-byte big-endian length prefix', () => {
    const payload = '{"id":"a","type":"request","channel":"native:health"}'
    const frame = encodeFrame(payload)
    expect(frame.readUInt32BE(0)).toBe(Buffer.byteLength(payload))
    expect(frame.subarray(4).toString('utf8')).toBe(payload)

    const decoder = new FrameDecoder()
    expect(decoder.push(frame)).toEqual([payload])
  })

  it('reassembles a payload split across chunks', () => {
    const payload = '{"id":"split","type":"handshake","protocolVersion":"1.0"}'
    const frame = encodeFrame(payload)
    const decoder = new FrameDecoder()
    expect(decoder.push(frame.subarray(0, 3))).toEqual([])
    expect(decoder.push(frame.subarray(3, 8))).toEqual([])
    expect(decoder.push(frame.subarray(8))).toEqual([payload])
  })

  it('rejects frames larger than the cap', () => {
    const decoder = new FrameDecoder(16)
    const huge = Buffer.alloc(4)
    huge.writeUInt32BE(32)
    expect(() => decoder.push(huge)).toThrow(/too large/)
  })
})
