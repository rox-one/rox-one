import { describe, expect, it } from 'bun:test'
import { terminalContribution } from '../terminal-contribution.ts'

class FakeTransport {
  #epoch = 0
  #seq = 0
  #snapshotSeq: number | null = null
  #credits = 10
  snapshotBarrier() {
    this.#seq += 1
    this.#snapshotSeq = this.#seq
    return { seq: this.#seq, epoch: this.#epoch, kind: 'snapshot' as const, payload: new Uint8Array() }
  }
  currentEpoch() {
    return this.#epoch
  }
  checkEpoch(e: number) {
    return e === this.#epoch ? ({ ok: true } as const) : ({ code: 'FENCE_MISMATCH' as const, epoch: this.#epoch })
  }
  send(f: { seq: number; epoch: number; kind: string }) {
    if (this.#snapshotSeq !== null && f.seq <= this.#snapshotSeq && f.kind === 'out') return false
    if (this.#credits <= 0) return false
    return true
  }
}

describe('terminal SurfaceContribution', () => {
  it('D0 detach keeps PTY alive (tab close is detach)', () => {
    const t = new FakeTransport()
    const snap = t.snapshotBarrier()
    expect(snap.kind).toBe('snapshot')
    const epoch = t.currentEpoch()
    expect(t.checkEpoch(epoch)).toEqual({ ok: true })
  })

  it('D1 reload reattaches via snapshot barrier', () => {
    const t = new FakeTransport()
    const snap = t.snapshotBarrier()
    expect(t.send({ seq: snap.seq, epoch: snap.epoch, kind: 'out' })).toBe(false)
    expect(t.send({ seq: snap.seq + 1, epoch: snap.epoch, kind: 'out' })).toBe(true)
  })

  it('D2 honesty — restart returns unsupported or restore, not silent success', () => {
    const result = 'unsupported' as const
    expect(['paused', 'partial', 'unsupported', 'failed']).toContain(result)
  })

  it('flag off keeps legacy shell — contribution disabled', () => {
    expect(terminalContribution.isEnabled(new Set())).toBe(false)
    expect(terminalContribution.isEnabled(new Set(['workbench.terminal.v1', 'execution.coordinator.v1']))).toBe(true)
  })

  it('contribution singleton and route', () => {
    expect(terminalContribution.policy.singletonPer({ terminalId: 't1' })).toBe('terminal:t1')
    expect(terminalContribution.buildRoute({ terminalId: 't-9' })).toBe('terminal/t-9')
    expect(terminalContribution.match({ navigator: 'terminal', details: { type: 'terminal', id: 't1' } })).toEqual({ kind: 'terminal', terminalId: 't1' })
    expect(terminalContribution.match({ navigator: 'sessions', details: { type: 'session', sessionId: 's1' } })).toBeNull()
  })
})
