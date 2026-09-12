/**
 * Cheap collection metrics for Issue 05 table/heatmap columns.
 * Pure helpers — no I/O. Size comes from a list-time stat; children from parent ids.
 */

export interface CollectionMetricMessage {
  type?: string
  role?: string
  toolName?: string
  toolInput?: Record<string, unknown> | null
}

export interface CollectionParentRef {
  id: string
  parentSessionId?: string | null
}

export function countToolCalls(messages: ReadonlyArray<CollectionMetricMessage>): number {
  let count = 0
  for (const message of messages) {
    if ((message.type ?? message.role) === 'tool') count += 1
  }
  return count
}

function commandFromInput(input: Record<string, unknown> | null | undefined): string {
  if (!input) return ''
  const command = input.command
  return typeof command === 'string' ? command : ''
}

export function isGitCommitMessage(message: CollectionMetricMessage): boolean {
  const name = (message.toolName ?? '').toLowerCase()
  if (name.includes('git') && name.includes('commit')) return true
  if (name === 'commit' || name.endsWith('__git_commit')) return true
  if (name === 'bash' || name === 'shell') {
    return /\bgit\s+commit\b/.test(commandFromInput(message.toolInput))
  }
  return false
}

export function countGitCommits(messages: ReadonlyArray<CollectionMetricMessage>): number {
  let count = 0
  for (const message of messages) {
    if (isGitCommitMessage(message)) count += 1
  }
  return count
}

export function countChildSessionsByParent(
  sessions: ReadonlyArray<CollectionParentRef>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const parent = session.parentSessionId
    if (!parent) continue
    counts.set(parent, (counts.get(parent) ?? 0) + 1)
  }
  return counts
}

export function formatTranscriptSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
