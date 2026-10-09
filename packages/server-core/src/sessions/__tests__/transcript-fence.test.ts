/**
 * Transcript writer fence tests (row f.5) — locks the `activeWriterRunId`
 * contract: a run superseded by a newer claim can never append, and the mutate
 * callback never runs for a rejected append.
 */

import { describe, expect, it } from 'bun:test'
import {
  isStaleTranscriptWriterError,
  STALE_TRANSCRIPT_WRITER,
  StaleTranscriptWriterError,
  TranscriptFence,
} from '../transcript-fence'

describe('TranscriptFence', () => {
  it('rejects an append from a run superseded by a newer run (stale-run scenario)', () => {
    const fence = new TranscriptFence()
    fence.claim('s1', 'run-1')
    expect(fence.append('s1', 'run-1', () => 'first')).toBe('first')

    // A newer run claims the writer; run-1 is now stale.
    fence.claim('s1', 'run-2')

    const transcript: string[] = []
    let thrown: unknown
    try {
      fence.append('s1', 'run-1', () => transcript.push('stale'))
    } catch (err) {
      thrown = err
    }

    expect(isStaleTranscriptWriterError(thrown)).toBe(true)
    const err = thrown as StaleTranscriptWriterError
    expect(err.code).toBe(STALE_TRANSCRIPT_WRITER)
    expect(err.sessionId).toBe('s1')
    expect(err.runId).toBe('run-1')
    expect(err.activeRunId).toBe('run-2')
    // The mutate callback must never run for a rejected append.
    expect(transcript).toEqual([])

    // The active run appends normally.
    expect(fence.append('s1', 'run-2', () => transcript.push('fresh'))).toBe(1)
    expect(transcript).toEqual(['fresh'])
  })

  it('rejects appends when no writer is claimed', () => {
    const fence = new TranscriptFence()
    expect(() => fence.append('s', 'run-1', () => 0)).toThrow(StaleTranscriptWriterError)
    expect(fence.activeRunId('s')).toBeUndefined()
  })

  it('release only clears the still-active writer', () => {
    const fence = new TranscriptFence()
    fence.claim('s', 'run-1')
    // A superseded run's late release is a no-op.
    fence.release('s', 'run-0')
    expect(fence.activeRunId('s')).toBe('run-1')
    fence.release('s', 'run-1')
    expect(fence.activeRunId('s')).toBeUndefined()
  })

  it('fences independently per session', () => {
    const fence = new TranscriptFence()
    fence.claim('a', 'run-a')
    fence.claim('b', 'run-b')
    expect(fence.isActive('a', 'run-b')).toBe(false)
    expect(fence.isActive('b', 'run-b')).toBe(true)
    expect(fence.append('a', 'run-a', () => 'ok')).toBe('ok')
    // A stale claim in session a never affects session b.
    fence.claim('a', 'run-a2')
    expect(fence.isActive('b', 'run-b')).toBe(true)
  })
})