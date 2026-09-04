import {
  deltaIpcCalls,
  snapshotIpcCalls,
  type IpcCallRecord,
} from './ipc-counter'
import { snapshotTelemetry, type TelemetrySnapshot } from './telemetry'
import type { InteractionKind } from './types'

export interface InteractionMark {
  kind: InteractionKind
  startMs: number
  marks: Array<{ name: string; elapsedMs: number }>
  ipcBefore: Record<string, IpcCallRecord>
  telemetryBefore: TelemetrySnapshot
  ended: boolean
}

const pending = new Map<InteractionKind, InteractionMark>()
const completed: Array<{
  kind: InteractionKind
  durationMs: number
  marks: Array<{ name: string; elapsedMs: number }>
  ipcDelta: Record<string, IpcCallRecord>
  telemetryDelta: TelemetrySnapshot
}> = []

const MAX_COMPLETED = 200

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function startInteraction(kind: InteractionKind): InteractionMark {
  const mark: InteractionMark = {
    kind,
    startMs: now(),
    marks: [],
    ipcBefore: snapshotIpcCalls(),
    telemetryBefore: snapshotTelemetry(),
    ended: false,
  }
  pending.set(kind, mark)
  return mark
}

export function checkpointInteraction(kind: InteractionKind, name: string): void {
  const mark = pending.get(kind)
  if (!mark || mark.ended) return
  mark.marks.push({ name, elapsedMs: now() - mark.startMs })
}

export function endInteraction(kind: InteractionKind): number | null {
  const mark = pending.get(kind)
  if (!mark || mark.ended) return null
  mark.ended = true
  pending.delete(kind)
  const durationMs = now() - mark.startMs
  const afterIpc = snapshotIpcCalls()
  const afterTel = snapshotTelemetry()
  const beforeTel = mark.telemetryBefore
  completed.push({
    kind,
    durationMs,
    marks: mark.marks,
    ipcDelta: deltaIpcCalls(mark.ipcBefore, afterIpc),
    telemetryDelta: {
      longTaskCount: afterTel.longTaskCount - beforeTel.longTaskCount,
      longTaskMs: afterTel.longTaskMs - beforeTel.longTaskMs,
      reactCommitMs: afterTel.reactCommitMs - beforeTel.reactCommitMs,
      reactCommitCount: afterTel.reactCommitCount - beforeTel.reactCommitCount,
      payloadBytes: afterTel.payloadBytes - beforeTel.payloadBytes,
    },
  })
  if (completed.length > MAX_COMPLETED) completed.shift()
  return durationMs
}

/** Fire-and-forget mark for cheap surfaces (dropdown, view switch). */
export function markInteraction(kind: InteractionKind, durationMs = 0): void {
  startInteraction(kind)
  if (durationMs > 0) {
    const mark = pending.get(kind)
    if (mark) mark.startMs = now() - durationMs
  }
  endInteraction(kind)
}

export function getCompletedInteractions() {
  return [...completed]
}

export function clearInteractions(): void {
  pending.clear()
  completed.length = 0
}

export function pendingInteraction(kind: InteractionKind): InteractionMark | undefined {
  return pending.get(kind)
}
