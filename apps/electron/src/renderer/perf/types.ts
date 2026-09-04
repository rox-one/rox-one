export const INTERACTION_KINDS = [
  'cold-ready',
  'cached-session-switch',
  'view-switch',
  'notes-open',
  'browser-chrome',
  'dropdown-open',
  'canvas-layout',
] as const

export type InteractionKind = (typeof INTERACTION_KINDS)[number]

export const BUNDLE_TRACK = 'bundle-minify' as const

export interface InteractionSample {
  kind: InteractionKind
  durationMs: number
  marks: Array<{ name: string; elapsedMs: number }>
  collectionReload: boolean
  ipc: Record<string, { channel: string; count: number; totalResultBytes: number }>
  nPlusOne: Array<{
    kind: 'permission-mode' | 'session-messages' | 'collection-reload'
    channel: string
    fanout: number
    sessionCount: number
  }>
  longTaskCount: number
  reactCommitMs: number
  payloadBytes: number
}

export interface BudgetRule {
  kind: InteractionKind | typeof BUNDLE_TRACK
  p95Ms: number | null
  maxCollectionReloads: number
  maxGetSessions: number
  maxPermissionFanout: number
}

export interface BenchmarkRun {
  fixture: 'sessions-500' | 'sessions-2000' | 'large-vault'
  sessionCount: number
  noteCount: number
  samples: InteractionSample[]
  bundle: {
    durationMs: number
    hung: boolean
  }
}

export interface BudgetViolation {
  rule: string
  actual: number
  budget: number
  message: string
}

export interface BenchmarkReport {
  generatedAt: string
  runs: BenchmarkRun[]
  violations: BudgetViolation[]
  passed: boolean
}
