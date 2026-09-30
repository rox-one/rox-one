/**
 * Pure view-model helpers for the Задачи screen (no React, no window).
 */
import { isInternalAgentSession } from '@craft-agent/shared/sessions/internal-prompts'
import {
  isOpenTask,
  matchesFilter,
  matchesTaskSearch,
  type PersonalTask,
  type TaskFilterId,
  type TaskLink,
} from '@craft-agent/core/tasks/personal'

export type AgentViewId = 'board' | 'running' | 'review' | 'conductor'

export type TasksView =
  | { kind: 'list'; id: TaskFilterId }
  | { kind: 'project'; id: string }
  | { kind: 'area'; id: string }
  | { kind: 'tag'; id: string }
  | { kind: 'agents'; id: AgentViewId }

/** Minimal session shape the Агенты section needs (subset of SessionMeta). */
export interface AgentSessionLike {
  id: string
  name?: string
  preview?: string
  sessionStatus?: string
  isProcessing?: boolean
  hidden?: boolean
  isArchived?: boolean
  taskSlug?: string
  lastMessageAt?: number
  createdAt?: number
}

const BOARD_STATUSES = new Set(['todo', 'in-progress', 'needs-review'])

export function matchesAgentView(session: AgentSessionLike, view: AgentViewId): boolean {
  if (session.hidden || session.isArchived) return false
  if (isInternalAgentSession(session)) return false
  switch (view) {
    case 'board':
      return BOARD_STATUSES.has(session.sessionStatus ?? '')
    case 'running':
      return Boolean(session.isProcessing)
    case 'review':
      return session.sessionStatus === 'needs-review'
    case 'conductor':
      return Boolean(session.taskSlug)
  }
}

export function agentSessions(sessions: Iterable<AgentSessionLike>, view: AgentViewId): AgentSessionLike[] {
  return [...sessions]
    .filter((session) => matchesAgentView(session, view))
    .sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0))
}

export function agentCounts(sessions: Iterable<AgentSessionLike>): Record<AgentViewId, number> {
  const list = [...sessions]
  return {
    board: list.filter((s) => matchesAgentView(s, 'board')).length,
    running: list.filter((s) => matchesAgentView(s, 'running')).length,
    review: list.filter((s) => matchesAgentView(s, 'review')).length,
    conductor: list.filter((s) => matchesAgentView(s, 'conductor')).length,
  }
}

/** Top-level tasks only (subtasks render inside the detail). */
export function countFilter(tasks: readonly PersonalTask[], now: number, filter: TaskFilterId): number {
  return tasks.filter((task) => !task.parentId && matchesFilter(task, now, filter)).length
}

export type AgentChip = 'running' | 'review' | 'todo' | 'done' | 'linked'

/** Status chip for the most recent session linked to a task. */
export function agentChipFor(task: PersonalTask, sessions: ReadonlyMap<string, AgentSessionLike>): { sessionId: string; chip: AgentChip } | null {
  const links = task.links.filter((link) => link.kind === 'session')
  for (let i = links.length - 1; i >= 0; i -= 1) {
    const session = sessions.get(links[i]!.id)
    if (!session) continue
    if (session.isProcessing || session.sessionStatus === 'in-progress') return { sessionId: session.id, chip: 'running' }
    if (session.sessionStatus === 'needs-review') return { sessionId: session.id, chip: 'review' }
    if (session.sessionStatus === 'todo') return { sessionId: session.id, chip: 'todo' }
    if (session.sessionStatus === 'done') return { sessionId: session.id, chip: 'done' }
    return { sessionId: session.id, chip: 'linked' }
  }
  return null
}

export function subtasksOf(tasks: readonly PersonalTask[], parentId: string): PersonalTask[] {
  return tasks.filter((task) => task.parentId === parentId).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

/**
 * «Поручить агенту» prompt: title + notes + open subtasks. The session is
 * created with status «К выполнению» and linked back (link kind:"session").
 */
export function buildDelegationPrompt(task: PersonalTask, subtasks: readonly PersonalTask[], heading: string): string {
  const lines = [`${heading}: ${task.title}`]
  if (task.notes.trim()) lines.push('', task.notes.trim())
  const open = subtasks.filter(isOpenTask)
  if (open.length) {
    lines.push('')
    for (const sub of open) lines.push(`- [ ] ${sub.title}`)
  }
  return lines.join('\n')
}

/** Split today's tasks: day tasks first, then «Вечер». */
export function splitEvening(tasks: readonly PersonalTask[]): { day: PersonalTask[]; evening: PersonalTask[] } {
  return {
    day: tasks.filter((task) => !task.evening),
    evening: tasks.filter((task) => task.evening),
  }
}

/** A quick-entry title that starts with or contains «@агент» / «@agent» asks to delegate right away. */
export function parseAgentMention(title: string): { title: string; delegate: boolean } {
  const re = /(^|\s)@(агент|agent)(?=\s|$)/iu
  if (!re.test(title)) return { title, delegate: false }
  return { title: title.replace(re, ' ').replace(/\s+/g, ' ').trim(), delegate: true }
}


// ── Things-style helpers ────────────────────────────────────────────────────

const EVIDENCE_RE = /rox:meeting-evidence\s+meetingId="([^"]+)"/

/**
 * Where the task came from: explicit `source`, else the first non-session
 * provenance link, else a meeting evidence marker in the notes (tasks
 * created by meeting actions on the server), else the first session link.
 */
export function deriveTaskSource(task: PersonalTask): TaskLink | null {
  if (task.source) return task.source
  const provenance = task.links.find((link) => link.kind === 'meeting' || link.kind === 'feed' || link.kind === 'mail' || link.kind === 'message' || link.kind === 'decision' || link.kind === 'note')
  if (provenance) return provenance
  const evidence = EVIDENCE_RE.exec(task.notes)
  if (evidence) return { kind: 'meeting', id: evidence[1]! }
  return null
}

/** Notes without machine markers (HTML comments) — what the user should read/edit. */
export function visibleNotes(notes: string): string {
  return notes.replace(/<!--[\s\S]*?-->/g, '').trim()
}

/** Re-attach the hidden markers of `previous` to edited visible notes. */
export function mergeNotesMarkers(previous: string, edited: string): string {
  const markers = previous.match(/<!--[\s\S]*?-->/g) ?? []
  return markers.length ? `${edited.trimEnd()}\n${markers.join('\n')}` : edited
}

export interface SearchQuery {
  text: string
  tags: string[]
}

/** «отчёт #работа» → text «отчёт», tags [работа]. */
export function parseSearch(raw: string): SearchQuery {
  const tags: string[] = []
  const text = raw.replace(/(^|\s)#([\p{L}\p{N}_\-/]+)/gu, (_m, _s, tag: string) => {
    tags.push(tag.toLowerCase())
    return ' '
  }).trim()
  return { text, tags }
}

export function matchesSearch(task: PersonalTask, query: SearchQuery): boolean {
  if (query.tags.length && !query.tags.every((tag) => task.tags.some((own) => own.toLowerCase() === tag))) return false
  return matchesTaskSearch(task, query.text)
}

export function checklistProgress(task: PersonalTask): { done: number; total: number } {
  const items = task.checklist ?? []
  return { done: items.filter((item) => item.done).length, total: items.length }
}

/** Days until a deadline (negative = overdue), by local calendar days. */
export function daysUntil(at: number, now: number): number {
  const a = new Date(at)
  a.setHours(0, 0, 0, 0)
  const b = new Date(now)
  b.setHours(0, 0, 0, 0)
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}
