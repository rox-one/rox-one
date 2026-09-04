import { estimatePayloadBytes, redactTelemetryPayload } from './redaction'

export interface LongTaskSample {
  durationMs: number
  at: number
}

export interface ReactCommitSample {
  durationMs: number
  at: number
}

export interface PayloadSample {
  bytes: number
  redacted: unknown
  at: number
}

export class PerfTelemetry {
  readonly longTasks: LongTaskSample[] = []
  readonly reactCommits: ReactCommitSample[] = []
  readonly payloads: PayloadSample[] = []

  recordLongTask(durationMs: number, at = Date.now()): void {
    this.longTasks.push({ durationMs, at })
  }

  recordReactCommit(durationMs: number, at = Date.now()): void {
    this.reactCommits.push({ durationMs, at })
  }

  recordPayload(payload: unknown, at = Date.now()): PayloadSample {
    const redacted = redactTelemetryPayload(payload)
    const sample: PayloadSample = {
      bytes: estimatePayloadBytes(redacted),
      redacted,
      at,
    }
    this.payloads.push(sample)
    return sample
  }

  reset(): void {
    this.longTasks.length = 0
    this.reactCommits.length = 0
    this.payloads.length = 0
  }
}
