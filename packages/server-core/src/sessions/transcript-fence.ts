/**
 * Transcript writer fence (port of OpenClaw's `activeWriterRunId` claim).
 *
 * Provenance: port-analysis/areas/f-substrate-gateway.md §"Turn lifecycle"
 * (row f.5) — upstream `docs/concepts/agent-loop.md:50`: "A durable
 * `activeWriterRunId` claim fences every transcript append/rewrite; superseded
 * runs cannot commit stale transcript data." Clean-room re-expression: ROX runs
 * its own streaming loop, so instead of the upstream claim table we keep one
 * active writer run id per session and reject any append tagged with a
 * different (stale) run id.
 *
 * Contract
 * - {@link TranscriptFence.claim} installs a run as the session's active writer,
 *   superseding any previous run. Claiming is idempotent for the same run.
 * - {@link TranscriptFence.append} applies a transcript mutation ONLY when the
 *   supplied run id is the session's active writer; otherwise it throws
 *   {@link StaleTranscriptWriterError}. A stale run can therefore never append
 *   after a newer run has started.
 * - {@link TranscriptFence.release} clears the writer only if the releasing run
 *   is still the active one (a superseded run's late release is a no-op).
 */

/** Machine-readable code carried by {@link StaleTranscriptWriterError}. */
export const STALE_TRANSCRIPT_WRITER = 'ROX_STALE_TRANSCRIPT_WRITER'

/**
 * Thrown when a transcript append/mutation is tagged with a run id that is not
 * the session's active writer. Typed (stable `code`) so callers can branch on it
 * without matching the message.
 */
export class StaleTranscriptWriterError extends Error {
  readonly code = STALE_TRANSCRIPT_WRITER
  readonly sessionId: string
  readonly runId: string
  readonly activeRunId: string | undefined

  constructor(sessionId: string, runId: string, activeRunId: string | undefined) {
    super(
      `Run ${runId} is not the active transcript writer for session ${sessionId}` +
        (activeRunId ? ` (active writer is ${activeRunId})` : ' (no active writer)'),
    )
    this.name = 'StaleTranscriptWriterError'
    this.sessionId = sessionId
    this.runId = runId
    this.activeRunId = activeRunId
  }
}

/** Narrowing guard for the typed fence error. */
export function isStaleTranscriptWriterError(err: unknown): err is StaleTranscriptWriterError {
  return err instanceof StaleTranscriptWriterError
}

/** Session-scoped single-writer guard for transcript appends/mutations. */
export class TranscriptFence {
  private readonly activeRunIds = new Map<string, string>()

  /** Install (or re-install) the active writer for a session; supersedes the previous run. */
  claim(sessionId: string, runId: string): void {
    this.activeRunIds.set(sessionId, runId)
  }

  /** The session's active writer run id, or undefined when none is claimed. */
  activeRunId(sessionId: string): string | undefined {
    return this.activeRunIds.get(sessionId)
  }

  /** True when `runId` is currently the session's active writer. */
  isActive(sessionId: string, runId: string): boolean {
    return this.activeRunIds.get(sessionId) === runId
  }

  /** Clear the writer iff it is still `runId` (a superseded run's late release is a no-op). */
  release(sessionId: string, runId: string): void {
    if (this.activeRunIds.get(sessionId) === runId) this.activeRunIds.delete(sessionId)
  }

  /**
   * Apply a transcript append/mutation iff `runId` is the session's active
   * writer. Throws {@link StaleTranscriptWriterError} otherwise — before running
   * `mutate`, so a stale run cannot commit partial transcript data.
   */
  append<T>(sessionId: string, runId: string, mutate: () => T): T {
    const active = this.activeRunIds.get(sessionId)
    if (active !== runId) throw new StaleTranscriptWriterError(sessionId, runId, active)
    return mutate()
  }
}