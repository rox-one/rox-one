import type { SidebarSection, SidebarSectionItem } from '../sidebar-section'
import { nonEmptySections } from '../sidebar-section'

/** Minimal session shape the builder needs (subset of renderer SessionMeta). */
export interface SessionsSidebarInput {
  id: string
  name?: string
  preview?: string
  lastMessageAt?: number
  createdAt?: number
  isProcessing?: boolean
  isFlagged?: boolean
  hasUnread?: boolean
  labels?: string[]
  sessionStatus?: string
  hidden?: boolean
  isArchived?: boolean
  parentSessionId?: string
  /** Viewer/share URL when the session is shared by link. */
  sharedUrl?: string
}

export interface SessionsSidebarFolder {
  id: string
  name: string
}

export interface SessionsSidebarOptions {
  /** Sessions with an open permission request (queue non-empty). */
  pendingPermissionIds?: ReadonlySet<string>
  /** Chat folders in display order (feat/chat-folders store). */
  folders?: readonly SessionsSidebarFolder[]
  /** sessionId → folderId (effective assignments: unknown folders already dropped). */
  folderAssignments?: Readonly<Record<string, string>>
  /** Raw label entry ("id" or "id::value") → label id. Defaults to identity. */
  labelIdOf?: (entry: string) => string
  /** Label id → display name. Defaults to the id. */
  labelNameOf?: (id: string) => string
}

export const SESSIONS_SECTION_LIMITS = { pinned: 5, attention: 5, running: 5, folders: 8, recent: 10, labels: 8 } as const

const NEEDS_REVIEW = 'needs-review'
const IN_PROGRESS = 'in-progress'

function ts(s: SessionsSidebarInput): number {
  return s.lastMessageAt ?? s.createdAt ?? 0
}

function sessionItem(s: SessionsSidebarInput, badge?: SidebarSectionItem['badge']): SidebarSectionItem {
  const title = s.name?.trim() || s.preview?.trim()
  return {
    id: s.id,
    ...(title ? { label: title } : { labelKey: 'screens.sessions.untitled' }),
    icon: 'message-square',
    ...(badge ? { badge } : s.hasUnread ? { badge: 'unread' as const } : {}),
    menu: sessionMenu(s),
    target: { kind: 'session', sessionId: s.id },
  }
}

/** Row menu: open as side session (#20) and share by link (#19). */
export function sessionMenu(s: Pick<SessionsSidebarInput, 'sharedUrl'>): NonNullable<SidebarSectionItem['menu']> {
  return [
    { id: 'open-side', labelKey: 'sideSession.openHere' },
    ...(s.sharedUrl
      ? [{ id: 'copy-link', labelKey: 'sessionMenu.copyLink' }, { id: 'stop-sharing', labelKey: 'sessionShare.stop', destructive: true }]
      : [{ id: 'share', labelKey: 'sessionShare.create' }]),
  ]
}

/**
 * Sessions screen second sidebar: Pinned → Needs attention → Running →
 * Folders → Recent → Labels. A session appears in at most one of the first
 * three groups (priority: pinned > attention > running — pinning is explicit
 * user intent; a pinned row still carries the attention/running badge), and
 * Recent lists only sessions not shown above so rows never duplicate.
 */
export function buildSessionsSidebarSections(
  sessions: readonly SessionsSidebarInput[],
  options: SessionsSidebarOptions = {},
): SidebarSection[] {
  const pending = options.pendingPermissionIds ?? new Set<string>()
  const visible = sessions
    .filter((s) => !s.hidden && !s.isArchived && !s.parentSessionId)
    .sort((a, b) => ts(b) - ts(a) || a.id.localeCompare(b.id))

  const shown = new Set<string>()
  const pinned: SidebarSectionItem[] = []
  const attention: SidebarSectionItem[] = []
  const running: SidebarSectionItem[] = []
  const recent: SidebarSectionItem[] = []

  for (const s of visible) {
    if (s.isFlagged) {
      pinned.push(sessionItem(s, pending.has(s.id) ? 'attention' : s.isProcessing ? 'running' : undefined))
      shown.add(s.id)
    }
  }
  for (const s of visible) {
    if (shown.has(s.id)) continue
    if (pending.has(s.id) || s.sessionStatus === NEEDS_REVIEW) {
      attention.push(sessionItem(s, 'attention'))
      shown.add(s.id)
    }
  }
  for (const s of visible) {
    if (shown.has(s.id)) continue
    if (s.isProcessing || s.sessionStatus === IN_PROGRESS) {
      // Live turn → running dot; status-only "in progress" → muted status badge.
      running.push(sessionItem(s, s.isProcessing ? 'running' : 'status'))
      shown.add(s.id)
    }
  }
  for (const s of visible) if (!shown.has(s.id)) recent.push(sessionItem(s))

  // Folder counts use the same population the session list groups by folder:
  // visible top-level sessions (hidden/archived/subtasks are not listed there).
  const assignments = options.folderAssignments ?? {}
  const folderCounts = new Map<string, number>()
  for (const s of visible) {
    const f = assignments[s.id]
    if (f) folderCounts.set(f, (folderCounts.get(f) ?? 0) + 1)
  }
  const folders: SidebarSectionItem[] = (options.folders ?? []).map((f) => ({
    id: `folder:${f.id}`,
    label: f.name,
    icon: 'folder',
    count: folderCounts.get(f.id) ?? 0,
    target: { kind: 'folder', folderId: f.id },
  }))

  const idOf = options.labelIdOf ?? ((e: string) => e)
  const nameOf = options.labelNameOf ?? ((id: string) => id)
  const labelCounts = new Map<string, number>()
  for (const s of visible) for (const l of new Set((s.labels ?? []).map(idOf))) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1)
  const labels: SidebarSectionItem[] = [...labelCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ id: `label:${label}`, label: nameOf(label), icon: 'tag', count, target: { kind: 'label', label } }))

  const L = SESSIONS_SECTION_LIMITS
  return nonEmptySections([
    { id: 'pinned', titleKey: 'screens.sessions.groups.pinned', items: pinned, limit: L.pinned, collapsible: true },
    { id: 'attention', titleKey: 'screens.sessions.groups.attention', items: attention, limit: L.attention, collapsible: true },
    { id: 'running', titleKey: 'screens.sessions.groups.running', items: running, limit: L.running, collapsible: true },
    { id: 'folders', titleKey: 'screens.sessions.groups.folders', items: folders, limit: L.folders, collapsible: true },
    { id: 'recent', titleKey: 'screens.sessions.groups.recent', items: recent, limit: L.recent, collapsible: true },
    { id: 'labels', titleKey: 'screens.sessions.groups.labels', items: labels, limit: L.labels, collapsible: true },
  ])
}
