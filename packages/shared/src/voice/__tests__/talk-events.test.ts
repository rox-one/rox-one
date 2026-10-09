import { describe, expect, it } from 'bun:test'
import {
  TalkEventSequencer,
  TalkSessionController,
  createTalkEventMergeState,
  mergeTalkEvent,
  TALK_EVENT_TYPES,
} from '../talk-events.ts'

const scope = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  mode: 'realtime' as const,
  transport: 'provider-websocket' as const,
  brain: 'direct' as const,
  provider: 'openai',
}

describe('talk event vocabulary', () => {
  it('covers the full documented vocabulary', () => {
    expect(TALK_EVENT_TYPES).toContain('transcript.partial')
    expect(TALK_EVENT_TYPES).toContain('output.audio.delta')
    expect(new Set(TALK_EVENT_TYPES).size).toBe(TALK_EVENT_TYPES.length)
  })

  it('assigns strictly increasing sequence numbers and timestamps from the clock', () => {
    let clock = 100
    const sequencer = new TalkEventSequencer(scope, { now: () => (clock += 1) - 1 })
    const first = sequencer.next({ type: 'session.started' })
    const second = sequencer.next({ type: 'health.changed', payload: { ok: true } })
    expect([first.seq, second.seq]).toEqual([1, 2])
    expect([first.timestamp, second.timestamp]).toEqual([100, 101])
    expect(sequencer.lastSeq).toBe(2)
    expect(first.final).toBe(false)
  })

  it('requires the owning id on turn- and capture-scoped frames', () => {
    const sequencer = new TalkEventSequencer(scope)
    expect(() => sequencer.next({ type: 'turn.started' })).toThrow(/turnId/)
    expect(() => sequencer.next({ type: 'transcript.final' })).toThrow(/captureId/)
    expect(sequencer.next({ type: 'turn.started', turnId: 'turn-1' }).turnId).toBe('turn-1')
  })
})

describe('talk event merge buffer', () => {
  it('emits a strictly monotonic stream under arbitrary interleaving', () => {
    const sequencer = new TalkEventSequencer(scope, { idFactory: (seq) => `e${seq}` })
    const frames = [
      sequencer.next({ type: 'session.started' }),
      sequencer.next({ type: 'health.changed' }),
      sequencer.next({ type: 'health.changed' }),
      sequencer.next({ type: 'health.changed' }),
      sequencer.next({ type: 'health.changed' }),
      sequencer.next({ type: 'session.ended' }),
    ]
    let state = createTalkEventMergeState('session-1')
    // Deliver out of order, with a duplicate of seq 2 mixed in.
    for (const frame of [frames[2]!, frames[0]!, frames[1]!, frames[1]!, frames[4]!]) {
      state = mergeTalkEvent(state, frame)
      for (let index = 1; index < state.ordered.length; index += 1) {
        expect(state.ordered[index]!.seq).toBe(state.ordered[index - 1]!.seq + 1)
      }
    }
    expect(state.ordered.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(state.watermark).toBe(3)
    expect(state.dropped).toBe(1)
    // Filling the gap releases the contiguous suffix in order.
    state = mergeTalkEvent(state, frames[3]!)
    expect(state.ordered.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(state.watermark).toBe(5)
    expect(state.pending).toEqual([])
  })

  it('ignores frames from another session', () => {
    const sequencer = new TalkEventSequencer({ ...scope, sessionId: 'other' })
    const state = createTalkEventMergeState('session-1')
    expect(mergeTalkEvent(state, sequencer.next({ type: 'session.started' })).ordered).toEqual([])
  })
})

describe('talk session controller', () => {
  it('opens/closes turns and captures and tracks output audio', () => {
    let clock = 0
    const controller = new TalkSessionController(scope, { now: () => (clock += 1) - 1 })
    expect(controller.history().map((event) => event.type)).toEqual(['session.started'])
    const turnId = controller.ensureTurn()
    expect(turnId).toBe('turn-1')
    expect(controller.ensureTurn()).toBe('turn-1')
    const captureId = controller.startCapture()
    expect(captureId).toBe('capture-1')
    controller.emit({ type: 'transcript.partial', captureId, payload: { text: 'при' } })
    controller.endCapture({ text: 'привет' })
    controller.startOutputAudio({ format: 'pcm16' })
    controller.finishOutputAudio()
    controller.endTurn()
    const emitted = controller.history().map((event) => event.type)
    expect(emitted).toEqual([
      'session.started',
      'turn.started',
      'capture.started',
      'transcript.partial',
      'capture.ended',
      'output.audio.delta',
      'output.audio.done',
      'turn.ended',
    ])
    for (let index = 1; index < controller.history().length; index += 1) {
      expect(controller.history()[index]!.seq).toBe(controller.history()[index - 1]!.seq + 1)
    }
  })

  it('cancels a turn once and is a no-op afterwards', () => {
    const controller = new TalkSessionController(scope)
    controller.startTurn()
    controller.cancelTurn('barge-in')
    controller.cancelTurn('barge-in')
    const ends = controller.history().filter((event) => event.type === 'turn.ended')
    expect(ends).toHaveLength(1)
    expect(ends[0]!.payload).toEqual({ cancelled: true, reason: 'barge-in' })
  })
})