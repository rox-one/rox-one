export type ExecutionHost = { kind: 'local-electron' }

export type ExecutionRun = {
  id: string
  sessionId?: string
  createdAt: number
}

export type PauseResult = 'paused' | 'partial' | 'unsupported' | 'failed'

export type CoordinatorReject = { code: 'FLAG_OFF' } | { code: 'HOST_UNSUPPORTED' }
