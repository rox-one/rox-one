import type { TerminalFrame } from '@craft-agent/shared/execution/terminal-protocol'

export function encodeFrame(frame: TerminalFrame): Uint8Array {
  const header = JSON.stringify({ seq: frame.seq, epoch: frame.epoch, kind: frame.kind, len: frame.payload.byteLength })
  const headerBytes = new TextEncoder().encode(header)
  const out = new Uint8Array(4 + headerBytes.byteLength + frame.payload.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, headerBytes.byteLength, false)
  out.set(headerBytes, 4)
  out.set(frame.payload, 4 + headerBytes.byteLength)
  return out
}

export function decodeFrame(buf: Uint8Array): TerminalFrame {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const headerLen = view.getUint32(0, false)
  const headerBytes = buf.subarray(4, 4 + headerLen)
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as { seq: number; epoch: number; kind: TerminalFrame['kind'] }
  const payload = buf.subarray(4 + headerLen)
  return { seq: header.seq, epoch: header.epoch, kind: header.kind, payload: new Uint8Array(payload) }
}

export class TerminalTransport {
  #credits = 0
  #seq = 0
  #epoch = 0
  #snapshotSeq: number | null = null

  replenishCredits(n: number): void {
    this.#credits = Math.max(0, this.#credits + n)
  }

  takeControl(_terminalId: string): number {
    this.#epoch += 1
    return this.#epoch
  }

  currentEpoch(): number {
    return this.#epoch
  }

  checkEpoch(epoch: number): { ok: true } | { code: 'FENCE_MISMATCH'; epoch: number } {
    if (epoch !== this.#epoch) return { code: 'FENCE_MISMATCH', epoch: this.#epoch }
    return { ok: true }
  }

  snapshotBarrier(): TerminalFrame {
    this.#seq += 1
    this.#snapshotSeq = this.#seq
    return { seq: this.#seq, epoch: this.#epoch, kind: 'snapshot', payload: new Uint8Array() }
  }

  send(frame: TerminalFrame): boolean {
    if (this.#snapshotSeq !== null && frame.seq <= this.#snapshotSeq && frame.kind === 'out') return false
    if (this.#credits <= 0) return false
    if (frame.epoch !== this.#epoch) return false
    if (frame.seq <= this.#seq && frame.kind !== 'snapshot') {
      // monotonic check: only allow increasing seq
      return false
    }
    this.#credits -= 1
    this.#seq = Math.max(this.#seq, frame.seq)
    return true
  }
}
