export const PERF_MARK_NAMES = [
  'cold_ready',
  'cached_session_switch',
  'view_switch',
  'notes_open',
  'browser_chrome',
  'dropdown_open',
  'canvas_layout',
] as const

export type PerfMarkName = (typeof PERF_MARK_NAMES)[number]

export const IPC_CHANNELS = [
  'sessions.list',
  'sessions.get',
  'sessions.permission',
  'sessions.metadata',
  'sessions.messages',
] as const

export type IpcChannelName = (typeof IPC_CHANNELS)[number]

export type PermissionMode = 'safe' | 'ask' | 'allow-all'

export interface SessionIndexEntry {
  id: string
  workspaceId: string
  name: string
  createdAt: number
  lastUsedAt: number
  lastMessageAt: number
  messageCount: number
  preview: string
  sessionStatus: string
  permissionMode: PermissionMode
  labels: string[]
  projectId: string | null
  isArchived: boolean
}

export interface VaultNoteEntry {
  id: string
  path: string
  title: string
  updatedAt: number
  outboundLinks: string[]
  sizeBytes: number
}

export interface PercentileStats {
  count: number
  minMs: number
  maxMs: number
  avgMs: number
  p50Ms: number
  p95Ms: number
}

export interface IpcCounts {
  [channel: string]: number
}

export interface BenchmarkSample {
  name: PerfMarkName
  durationMs: number
  ipc: IpcCounts
  reloadedCollection: boolean
  payloadBytes?: number
}

export interface BudgetDefinition {
  name: PerfMarkName
  p95Ms: number
  maxCollectionReloads: number
  maxIpcPerInteraction?: Partial<Record<IpcChannelName, number>>
  ciGate: boolean
}

export interface BudgetVerdict {
  name: PerfMarkName
  passed: boolean
  gated: boolean
  p95Ms: number
  budgetMs: number
  collectionReloads: number
  reasons: string[]
}

export interface BenchmarkReport {
  generatedAt: string
  fixture: {
    sessionCount: number
    vaultNoteCount: number
  }
  stats: Partial<Record<PerfMarkName, PercentileStats>>
  verdicts: BudgetVerdict[]
  ipcTotals: IpcCounts
  longTasks: number
  reactCommits: number
  payloadSamples: number
  bundleProfileMs: number | null
}
