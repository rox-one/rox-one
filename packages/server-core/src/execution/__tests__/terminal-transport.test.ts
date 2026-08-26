import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import {
  decodeFrame,
  encodeFrame,
  TerminalTransport,
} from '../terminal/transport.ts'
import type { TerminalFrame } from '../../../../shared/src/execution/terminal-protocol.ts'

describe('TerminalTransport', () => {
  it('stops on zero credits and respects seq', () => {
    const t = new TerminalTransport()
    t.replenishCredits(0)
    expect(
      t.send({ seq: 1, epoch: 1, kind: 'out', payload: new Uint8Array([1]) }),
    ).toBe(false)
  })

  it('snapshot then only deltas > barrier', () => {
    const t = new TerminalTransport()
    t.replenishCredits(8)
    const snap = t.snapshotBarrier()
    expect(snap.kind).toBe('snapshot')
    expect(
      t.send({ seq: snap.seq, epoch: snap.epoch, kind: 'out', payload: new Uint8Array() }),
    ).toBe(false)
    expect(
      t.send({
        seq: snap.seq + 1,
        epoch: snap.epoch,
        kind: 'out',
        payload: new Uint8Array([1]),
      }),
    ).toBe(true)
  })

  it('fence increments on take_control', () => {
    const t = new TerminalTransport()
    const e1 = t.takeControl('t1')
    const e2 = t.takeControl('t1')
    expect(e1).toBe(1)
    expect(e2).toBe(e1 + 1)
    expect(t.checkEpoch(e1)).toEqual({ code: 'FENCE_MISMATCH', epoch: e2 })
    expect(t.checkEpoch(e2)).toEqual({ ok: true })
  })

  it('clamps credit underflow to 0', () => {
    const t = new TerminalTransport()
    t.replenishCredits(2)
    t.replenishCredits(-10)
    expect(
      t.send({ seq: 1, epoch: 1, kind: 'out', payload: new Uint8Array([1]) }),
    ).toBe(false)
  })

  it('bytes not via serializeEnvelope', async () => {
    const { serializeEnvelope } = await import('../../transport/codec.ts')
    const env = { type: 'request', id: '1', method: 'terminal.send', params: {} } as never
    const raw = serializeEnvelope(env)
    expect(raw).not.toContain('Uint8Array')
    expect(raw).not.toContain('TerminalFrame')
    const codec = readFileSync(
      new URL('../../transport/codec.ts', import.meta.url),
      'utf8',
    )
    expect(codec.includes('TerminalFrame')).toBe(false)
  })

  it('roundtrips length-prefixed frames beside the codec', () => {
    const frame: TerminalFrame = {
      seq: 7,
      epoch: 3,
      kind: 'out',
      payload: new Uint8Array([0, 255, 10, 123]),
    }
    const encoded = encodeFrame(frame)
    expect(encoded.byteLength).toBeGreaterThan(4 + frame.payload.byteLength)
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)
    const headerLen = view.getUint32(0, false)
    expect(headerLen).toBeGreaterThan(0)
    expect(decodeFrame(encoded)).toEqual(frame)
  })
})
