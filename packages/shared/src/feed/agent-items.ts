/**
 * Pure builders for the «Действия агентов» tab: session activity + automation
 * runs (automations-history.jsonl). Used by the feed:list server aggregator.
 */
import type { FeedItem, FeedItemStatus } from './types'

export interface FeedSessionLike {
  id: string
  workspaceId?: string
  name?: string
  preview?: string
  lastMessageAt: number
  isProcessing?: boolean
  hidden?: boolean
  isArchived?: boolean
  lastMessageRole?: string
  currentStatus?: { message: string } | null
  messageCount?: number
  parentSessionId?: string
}

export interface FeedAutomationRunLike {
  id: string
  ts: number
  ok: boolean
  sessionId?: string
  prompt?: string
  error?: string
  webhook?: { url?: string; statusCode?: number } | unknown
}

export function sessionStatus(s: FeedSessionLike): FeedItemStatus {
  if (s.isProcessing) return 'running'
  if (s.lastMessageRole === 'error') return 'error'
  if (s.lastMessageRole === 'plan') return 'waiting'
  return 'ok'
}

function clip(s: string | undefined, n = 200): string | undefined {
  const v = s?.replace(/\s+/g, ' ').trim()
  if (!v) return undefined
  return v.length > n ? `${v.slice(0, n - 1)}…` : v
}

export function buildSessionFeedItems(sessions: readonly FeedSessionLike[], limit = 150): FeedItem[] {
  return sessions
    .filter((s) => !s.hidden && !s.isArchived && Number.isFinite(s.lastMessageAt) && s.lastMessageAt > 0)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .slice(0, limit)
    .map((s) => ({
      id: `session:${s.id}`,
      tab: 'agents' as const,
      kind: 'session' as const,
      title: clip(s.name, 120) ?? clip(s.preview, 120) ?? '',
      summary: clip(s.currentStatus?.message) ?? (s.name ? clip(s.preview) : undefined),
      at: s.lastMessageAt,
      status: sessionStatus(s),
      ref: { type: 'session' as const, id: s.id, ...(s.workspaceId ? { workspaceId: s.workspaceId } : {}) },
      sessionId: s.id,
    }))
}

export function buildAutomationRunItems(
  runs: readonly FeedAutomationRunLike[],
  names: Readonly<Record<string, string>> = {},
  workspaceId?: string,
  limit = 100,
): FeedItem[] {
  return runs
    .filter((r) => r && typeof r.id === 'string' && Number.isFinite(r.ts))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map((r) => ({
      id: `run:${r.id}:${r.ts}`,
      tab: 'agents' as const,
      kind: 'automation-run' as const,
      title: names[r.id] ?? clip(r.prompt, 120) ?? r.id,
      summary: names[r.id] ? clip(r.prompt) : undefined,
      at: r.ts,
      status: r.ok ? ('ok' as const) : ('error' as const),
      ...(r.ok ? {} : { error: clip(r.error, 400) ?? '' }),
      ref: { type: 'automation' as const, id: r.id, ...(workspaceId ? { workspaceId } : {}) },
      automationId: r.id,
      ...(r.sessionId ? { sessionId: r.sessionId } : {}),
    }))
}

/** Merge rules: newest first, de-dupe by id (first wins), cap. */
export function mergeFeedItems(lists: ReadonlyArray<readonly FeedItem[]>, cap = 600): FeedItem[] {
  const seen = new Set<string>()
  const out: FeedItem[] = []
  for (const list of lists) for (const it of list) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    out.push(it)
  }
  return out.sort((a, b) => b.at - a.at).slice(0, cap)
}
