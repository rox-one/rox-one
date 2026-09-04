import { beforeEach, describe, expect, it } from 'bun:test'
import { onReactProfilerRender, recordLongTask, recordPayloadBytes, resetTelemetry, snapshotTelemetry } from '../telemetry'

describe('perf telemetry', () => {
  beforeEach(() => {
    resetTelemetry()
  })

  it('records long tasks, commits, and payload bytes', () => {
    recordLongTask(60)
    onReactProfilerRender('shell', 'update', 8)
    recordPayloadBytes(2048)
    const snap = snapshotTelemetry()
    expect(snap.longTaskCount).toBe(1)
    expect(snap.reactCommitMs).toBe(8)
    expect(snap.payloadBytes).toBe(2048)
  })
})
