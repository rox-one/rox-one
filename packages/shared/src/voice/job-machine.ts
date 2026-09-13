export type CaptureState = 'idle' | 'requesting-permission' | 'recording' | 'finalizing'
export type JobState =
  | 'queued'
  | 'transcribing'
  | 'enriching'
  | 'postprocessing'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'cancelled'

export interface VoiceJob {
  recordingId: string
  jobId: string
  seq: number
  capture: CaptureState
  job: JobState
  error?: string
}

export function createVoiceJob(recordingId: string, jobId: string): VoiceJob {
  return { recordingId, jobId, seq: 0, capture: 'idle', job: 'queued' }
}

export function applyJobEvent(current: VoiceJob, next: Partial<VoiceJob> & { seq: number; recordingId: string; jobId: string }): VoiceJob {
  if (next.recordingId !== current.recordingId || next.jobId !== current.jobId) return current
  if (next.seq <= current.seq) return current
  return { ...current, ...next, seq: next.seq }
}

export function canStartCapture(current: VoiceJob | null): boolean {
  return !current || current.capture === 'idle' || current.capture === 'finalizing'
}

export const JOB_TRANSITIONS: Record<JobState, readonly JobState[]> = {
  queued: ['transcribing', 'cancelled'],
  transcribing: ['enriching', 'postprocessing', 'ready', 'degraded', 'failed', 'cancelled'],
  enriching: ['postprocessing', 'degraded', 'failed', 'cancelled'],
  postprocessing: ['ready', 'degraded', 'failed', 'cancelled'],
  ready: [],
  degraded: [],
  failed: [],
  cancelled: [],
}

export function advanceJob(current: VoiceJob, next: JobState, seq: number, error?: string): VoiceJob {
  if (next === current.job) return { ...current, seq: Math.max(current.seq, seq), error }
  const allowed = JOB_TRANSITIONS[current.job]
  if (!allowed.includes(next)) return current
  return applyJobEvent(current, { ...current, job: next, seq, error })
}
