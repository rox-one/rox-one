import type { AgentBudgetSnapshot } from '@craft-agent/shared/agent'

/**
 * Центр агентов — pure aggregation of sessions, pending permission/credential
 * prompts, cloud runs and automations into one picture: running, waiting for
 * the user, stuck, cost today vs. the daily budget. No I/O.
 */

export const STUCK_AFTER_MS = 10 * 60 * 1000

export interface CenterSession {
  id: string
  name: string
  isProcessing?: boolean
  lastMessageAt?: number
  createdAt?: number
  permissionMode?: string
}

export interface CenterCloudRun {
  id: string
  name: string
  createdAt: number
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'unknown'
  progress?: { completed: number; total: number }
  failureReason?: string
  sessionId?: string
  tokens?: number
}

export interface CenterAutomation {
  id: string
  name: string
  event: string
  matcherIndex: number
  enabled: boolean
  cron?: string
  lastExecutedAt?: number
}

export interface CenterInput {
  sessions: readonly CenterSession[]
  /** sessionId → number of pending prompts, by kind */
  pendingPermissions: ReadonlyMap<string, number>
  pendingCredentials: ReadonlyMap<string, number>
  cloudRuns: readonly CenterCloudRun[]
  automations: readonly CenterAutomation[]
  now: number
  budget: AgentBudgetSnapshot | null
}

export interface WaitingItem {
  session: CenterSession
  permissions: number
  credentials: number
}

export interface AgentCenter {
  running: CenterSession[]
  stuck: CenterSession[]
  waiting: WaitingItem[]
  cloudActive: CenterCloudRun[]
  cloudFailed: CenterCloudRun[]
  automationsEnabled: CenterAutomation[]
  automationsPaused: CenterAutomation[]
  budget: AgentBudgetSnapshot | null
}

export function startOfLocalDay(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function isStuck(session: CenterSession, now: number): boolean {
  if (!session.isProcessing) return false
  const last = session.lastMessageAt ?? session.createdAt
  return last != null && now - last > STUCK_AFTER_MS
}

export function buildAgentCenter(input: CenterInput): AgentCenter {
  const { now } = input
  const dayStart = startOfLocalDay(now)
  const processing = input.sessions.filter((s) => s.isProcessing)
  const stuck = processing.filter((s) => isStuck(s, now))
  const stuckIds = new Set(stuck.map((s) => s.id))
  const byId = new Map(input.sessions.map((s) => [s.id, s]))

  const waitingIds = new Set([...input.pendingPermissions.keys(), ...input.pendingCredentials.keys()])
  const waiting: WaitingItem[] = []
  for (const id of waitingIds) {
    const permissions = input.pendingPermissions.get(id) ?? 0
    const credentials = input.pendingCredentials.get(id) ?? 0
    if (permissions + credentials === 0) continue
    waiting.push({ session: byId.get(id) ?? { id, name: id }, permissions, credentials })
  }
  waiting.sort((a, b) => (b.session.lastMessageAt ?? 0) - (a.session.lastMessageAt ?? 0))

  return {
    running: processing.filter((s) => !stuckIds.has(s.id) && !waitingIds.has(s.id)).sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)),
    stuck: stuck.filter((s) => !waitingIds.has(s.id)),
    waiting,
    cloudActive: input.cloudRuns.filter((r) => r.state === 'queued' || r.state === 'running'),
    cloudFailed: input.cloudRuns.filter((r) => r.state === 'failed' && r.createdAt >= dayStart - 86400000),
    automationsEnabled: input.automations.filter((a) => a.enabled),
    automationsPaused: input.automations.filter((a) => !a.enabled),
    budget: input.budget,
  }
}

type RawCloudList = { enabled?: boolean; runs?: { id: string; name: string; createdAt: number; sessionId?: string; status: { state?: string; failureReason?: string; progress?: { completed: number; total: number }; usage?: { promptTokens: number; completionTokens: number } } | null }[] }

export function normalizeCloudRuns(raw: RawCloudList | null | undefined): { enabled: boolean; runs: CenterCloudRun[] } {
  if (!raw || !Array.isArray(raw.runs)) return { enabled: Boolean(raw?.enabled), runs: [] }
  const states = ['queued', 'running', 'done', 'failed', 'cancelled']
  return {
    enabled: Boolean(raw.enabled),
    runs: raw.runs.map((run) => ({
      id: run.id,
      name: run.name || run.id,
      createdAt: run.createdAt,
      sessionId: run.sessionId,
      state: (states.includes(run.status?.state ?? '') ? run.status!.state : 'unknown') as CenterCloudRun['state'],
      progress: run.status?.progress,
      failureReason: run.status?.failureReason,
      tokens: run.status?.usage ? run.status.usage.promptTokens + run.status.usage.completionTokens : undefined,
    })),
  }
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return '<$0.01'
  return `$${value.toFixed(2)}`
}

export function formatAgo(ms: number, language: 'ru' | 'en'): string {
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 1) return language === 'ru' ? 'только что' : 'just now'
  if (min < 60) return language === 'ru' ? `${min} мин` : `${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return language === 'ru' ? `${h} ч` : `${h} h`
  return language === 'ru' ? `${Math.round(h / 24)} дн` : `${Math.round(h / 24)} d`
}
