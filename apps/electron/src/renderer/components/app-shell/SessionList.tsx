import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useAtomValue, useSetAtom } from "jotai"
import { isToday, isYesterday, format, startOfDay } from "date-fns"
import { getDateLocale } from "@craft-agent/shared/i18n"
import { useAction } from "@/actions"
import { Inbox, Archive, ChevronRight, GripVertical, ListFilter } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { getSessionStatus } from "@/utils/session"
import * as storage from "@/lib/local-storage"
import { KEYS } from "@/lib/local-storage"
import type { LabelConfig } from "@craft-agent/shared/labels"
import { flattenLabels } from "@craft-agent/shared/labels"
import * as MultiSelect from "@/hooks/useMultiSelect"
import { Spinner } from "@craft-agent/ui"
import { EntityListEmptyScreen } from "@/components/ui/entity-list-empty"
import { EntityList, type EntityListGroup } from "@/components/ui/entity-list"
import { RenameDialog } from "@/components/ui/rename-dialog"
import { SessionSearchHeader } from "./SessionSearchHeader"
import { SessionItem } from "./SessionItem"
import { SessionListProvider, type SessionListContextValue } from "@/context/SessionListContext"
import { useSessionSelection, useSessionSelectionStore } from "@/hooks/useSession"
import { useSessionSearch, type FilterMode } from "@/hooks/useSessionSearch"
import { useSessionActions } from "@/hooks/useSessionActions"
import { useEntityListInteractions } from "@/hooks/useEntityListInteractions"
import { useFocusZone } from "@/hooks/keyboard"
import { useEscapeInterrupt } from "@/context/EscapeInterruptContext"
import { useNavigation, useNavigationState, routes, isSessionsNavigation } from "@/contexts/NavigationContext"
import { useFocusContext } from "@/context/FocusContext"
import {
  loadedSessionsAtom,
  refreshSessionsMetadataAtom,
  sendToWorkspaceAtom,
  updateSessionMetaAtom,
  type SessionMeta,
} from "@/atoms/sessions"
import { collectionDisplayAtom } from "@/atoms/collection-display"
import { collectionFiltersAtom } from "@/atoms/collection-filters"
import { activeFilterCount } from "./collection/collection-filter-count"
import { compareSessions, lexorankBetween } from "@craft-agent/shared/sessions/collection"
import { isStaleRankNeighborsError, retryStaleRankReorder } from "@/lib/collection-reorder"
import {
  getListGroupKey,
  listCrossGroupDropAction,
  listRankReorderRequest,
  resolveListGroupingMode,
  LIST_DUE_ORDER,
  LIST_PRIORITY_ORDER,
  type ListGroupingMode,
} from "./session-list/list-grouping"
import type { ViewConfig } from "@craft-agent/shared/views"
import type { SessionStatusId, SessionStatus } from "@/config/session-status-config"
import { buildCollapsedGroupsScopeSuffix } from "@/utils/session-list-collapse"
import {
  buildSessionFamilies,
  groupIntoFamilyUnits,
  buildFamilyRowMeta,
  familyCollapseKeys,
  type FamilyUnit,
  type FamilyUnitHead,
} from "@/utils/session-families"

export interface SessionListRow {
  item: SessionMeta
  /** Present on the visible head row of a multi-member session family (root). */
  familyHead?: FamilyUnitHead
  /** Present on rows rendered as indented branch rows of a family. */
  isFamilyBranch?: boolean
}

/**
 * Flatten family units into consecutive rows, attaching per-row family
 * decoration (head chevron info / branch indent flag). Pure helper kept
 * module-level so all grouping modes share it.
 */
function hydrateFamilyRows(units: FamilyUnit<SessionMeta>[]): SessionListRow[] {
  const meta = buildFamilyRowMeta(units)
  const rows: SessionListRow[] = []
  for (const unit of units) {
    for (const item of unit.rows) {
      const entry = meta.get(item.id)
      rows.push(entry ? { item, ...entry } : { item })
    }
  }
  return rows
}

/** Grouping mode for chat list (legacy per-view modes; see session-list/list-grouping) */
export type { ChatGroupingMode } from "./session-list/list-grouping"
import type { ChatGroupingMode } from "./session-list/list-grouping"

interface SessionListProps {
  items: SessionMeta[]
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onSessionStatusChange: (sessionId: string, state: SessionStatusId) => void
  onRename: (sessionId: string, name: string) => void
  /** Called when Enter is pressed to focus chat input for a specific session */
  onFocusChatInput?: (sessionId?: string) => void
  /** Called when a session is selected */
  onSessionSelect?: (session: SessionMeta) => void
  /** Called when user wants to open a session in a new window */
  onOpenInNewWindow?: (session: SessionMeta) => void
  /** Called to navigate to a specific view (e.g., 'allSessions', 'flagged') */
  onNavigateToView?: (view: 'allSessions' | 'flagged') => void
  /** Unified session options per session (real-time state) */
  sessionOptions?: Map<string, import('../../hooks/useSessionOptions').SessionOptions>
  /** Whether search mode is active */
  searchActive?: boolean
  /** Current search query */
  searchQuery?: string
  /** Called when search query changes */
  onSearchChange?: (query: string) => void
  /** Called when search is closed */
  onSearchClose?: () => void
  /** Dynamic todo states from workspace config */
  sessionStatuses?: SessionStatus[]
  /** View evaluator — evaluates a session and returns matching view configs */
  evaluateViews?: (meta: SessionMeta) => ViewConfig[]
  /** Label configs for resolving session label IDs to display info */
  labels?: LabelConfig[]
  /** Callback when session labels are toggled (for labels submenu in SessionMenu) */
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  /** Workspace projects (for the Projects submenu in SessionMenu) */
  projects?: Array<{ id: string; slug: string; name: string; color?: string }>
  /** Callback to bind/unbind a session to a project (null = unbind) */
  onSetProjectId?: (sessionId: string, projectId: string | null) => void
  /** How to group sessions: 'date' (default) or 'status' */
  groupingMode?: ChatGroupingMode
  /** Workspace ID for content search (optional - if not provided, content search is disabled) */
  workspaceId?: string
  /** Secondary status filter (status chips in "All Sessions" view) - for search result grouping */
  statusFilter?: Map<string, FilterMode>
  /** Secondary label filter (label chips) - for search result grouping */
  labelFilterMap?: Map<string, FilterMode>
  /** Override which session is highlighted (for multi-panel focused panel tracking) */
  focusedSessionId?: string | null
  /** Override navigation target (for multi-panel: focuses existing panel or navigates focused panel) */
  onNavigateToSession?: (sessionId: string) => void
  /** Session-level pending prompt marker (permission/admin approval) */
  hasPendingPrompt?: (sessionId: string) => boolean
  /** DOM-verified match info for the active session (from ChatDisplay) */
  activeChatMatchInfo?: { sessionId: string | null; count: number; isHighlighting?: boolean }
}

// Re-export SessionStatusId for use by parent components
export type { SessionStatusId }

// Note: uses date-fns format for non-today/yesterday dates; Today/Yesterday translated at render time
function formatDateGroupLabel(date: Date, t: (key: string) => string, lang: string): string {
  if (isToday(date)) return t('common.today')
  if (isYesterday(date)) return t('common.yesterday')
  return format(date, 'MMM d', { locale: getDateLocale(lang) })
}

/**
 * SessionList - Scrollable list of session cards with keyboard navigation
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Navigate and select sessions (immediate selection)
 * - Arrow Left/Right: Navigate between zones
 * - Enter: Focus chat input
 * - Home/End: Jump to first/last session
 */
export function SessionList({
  items,
  onDelete,
  onFlag,
  onUnflag,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onSessionStatusChange,
  onRename,
  onFocusChatInput,
  onOpenInNewWindow,
  sessionOptions,
  searchActive,
  searchQuery = '',
  onSearchChange,
  onSearchClose,
  sessionStatuses = [],
  evaluateViews,
  labels = [],
  onLabelsChange,
  projects,
  onSetProjectId,
  groupingMode = 'date',
  workspaceId,
  statusFilter,
  labelFilterMap,
  focusedSessionId,
  onNavigateToSession,
  hasPendingPrompt,
  activeChatMatchInfo,
}: SessionListProps) {
  const { t, i18n } = useTranslation()
  const setSendToWorkspace = useSetAtom(sendToWorkspaceAtom)
  const collectionDisplay = useAtomValue(collectionDisplayAtom)
  const collectionFilters = useAtomValue(collectionFiltersAtom)
  const setCollectionFilters = useSetAtom(collectionFiltersAtom)
  const updateMeta = useSetAtom(updateSessionMetaAtom)
  const refreshMetadata = useSetAtom(refreshSessionsMetadataAtom)
  const loadedSessionIds = useAtomValue(loadedSessionsAtom)

  // Display groupBy drives list grouping when set; legacy per-view grouping
  // mode remains the fallback for groupBy === 'none'.
  const effectiveGroupingMode: ListGroupingMode = resolveListGroupingMode(
    collectionDisplay.groupBy,
    groupingMode,
  )

  // --- Selection (atom-backed, shared with ChatDisplay + BatchActionPanel) ---
  const {
    select: selectSession,
    toggle: toggleSession,
    selectRange,
    isMultiSelectActive,
  } = useSessionSelection()
  const selectionStore = useSessionSelectionStore()

  const { navigate, navigateToSession: navigateToSessionPrimary } = useNavigation()
  const navigateToSession = onNavigateToSession ?? navigateToSessionPrimary
  const navState = useNavigationState()
  const { showEscapeOverlay } = useEscapeInterrupt()

  // Pre-flatten label tree once for efficient ID lookups in each SessionItem
  const flatLabels = useMemo(() => flattenLabels(labels), [labels])

  // Get current filter from navigation state (for preserving context in tab routes)
  const currentFilter = isSessionsNavigation(navState) ? navState.filter : undefined

  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  // Track if search input has actual DOM focus (for proper keyboard navigation gating)
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false)

  // Collapsed group keys (for collapsible group headers) — persisted per workspace/filter/grouping context
  const collapseScopeSuffix = useMemo(() => {
    return buildCollapsedGroupsScopeSuffix({
      workspaceId,
      currentFilter,
      groupingMode: effectiveGroupingMode,
    })
  }, [
    workspaceId,
    effectiveGroupingMode,
    currentFilter?.kind,
    currentFilter && 'stateId' in currentFilter ? currentFilter.stateId : undefined,
    currentFilter && 'labelId' in currentFilter ? currentFilter.labelId : undefined,
    currentFilter && 'viewId' in currentFilter ? currentFilter.viewId : undefined,
  ])

  const readCollapsedGroupsForScope = useCallback((scopeSuffix: string): Set<string> => {
    const scopedRaw = storage.getRaw(KEYS.collapsedSessionGroups, scopeSuffix)
    if (scopedRaw !== null) {
      try {
        const parsed = JSON.parse(scopedRaw)
        return new Set(Array.isArray(parsed) ? parsed : [])
      } catch {
        return new Set()
      }
    }

    // Legacy fallback: previous versions used a single global key with no scope suffix.
    // Use as migration source only when this scope has never been written.
    const legacy = storage.get<string[]>(KEYS.collapsedSessionGroups, [])
    return new Set(legacy)
  }, [])

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => readCollapsedGroupsForScope(collapseScopeSuffix))
  const collapseScopeRef = useRef(collapseScopeSuffix)

  useEffect(() => {
    if (collapseScopeRef.current === collapseScopeSuffix) return
    setCollapsedGroups(readCollapsedGroupsForScope(collapseScopeSuffix))
    collapseScopeRef.current = collapseScopeSuffix
  }, [collapseScopeSuffix, readCollapsedGroupsForScope])

  useEffect(() => {
    // Avoid writing stale groups from a previous scope during context switches.
    if (collapseScopeRef.current !== collapseScopeSuffix) return
    storage.set(KEYS.collapsedSessionGroups, Array.from(collapsedGroups), collapseScopeSuffix)
  }, [collapsedGroups, collapseScopeSuffix])

  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  // --- Data pipeline (search, filtering, pagination, grouping) ---
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  // Session families (branch chats grouped under their root chat), computed
  // from the full item set so lineage is stable across pagination/search.
  // Computed BEFORE useSessionSearch: the search hook needs representatives for
  // family-aware collapse buckets.
  const { familyBySessionId } = useMemo(() => buildSessionFamilies(items), [items])

  // sessionId → family's bucket representative (the member with max lastMessageAt,
  // which SessionList also uses for the family's outer bucket). Keeps the whole
  // family inside ONE collapsed bucket.
  const bucketRepresentatives = useMemo(() => {
    const itemById = new Map(items.map(i => [i.id, i]))
    const bySessionId = new Map<string, SessionMeta>()
    const seen = new Set<string>()
    for (const family of familyBySessionId.values()) {
      if (seen.has(family.rootId)) continue
      seen.add(family.rootId)
      if (family.isSingleton) continue // no-family sessions key by themselves
      // Representative = member with max lastMessageAt; '>' keeps the FIRST on
      // ties, matching groupIntoFamilyUnits' bucketItem selection.
      let rep: SessionMeta | undefined
      for (const id of family.memberIds) {
        const item = itemById.get(id)
        if (item && (!rep || (item.lastMessageAt ?? 0) > (rep.lastMessageAt ?? 0))) rep = item
      }
      if (!rep) continue
      for (const id of family.memberIds) bySessionId.set(id, rep)
    }
    return bySessionId
  }, [familyBySessionId, items])

  const {
    isSearchMode,
    highlightQuery,
    isSearchingContent,
    isSearchUnavailable,
    contentSearchResults,
    matchingFilterItems,
    otherResultItems,
    exceededSearchLimit,
    flatItems,
    hasMore,
    collapsedGroupsMeta,
    searchInputRef,
  } = useSessionSearch({
    items,
    searchActive: searchActive ?? false,
    searchQuery,
    workspaceId,
    currentFilter,
    evaluateViews,
    statusFilter,
    labelFilterMap,
    labelConfigs: labels,
    collapsedGroups,
    groupingMode: effectiveGroupingMode,
    bucketRepresentatives,
    scrollViewportRef,
  })

  // FR-45: rank drag under the same rule as the table (orderBy === 'rank');
  // disabled in search mode where relevance owns the order.
  const rankDragEnabled = collectionDisplay.orderBy === 'rank' && !isSearchMode

  const rowData = useMemo(() => {
    // Within-group order: latest activity first — except under rank ordering,
    // where the incoming (rank-sorted) order must survive so drag targets
    // match what the user sees.
    const sortUnitsByActivity = (units: FamilyUnit<SessionMeta>[]) => {
      if (rankDragEnabled) return
      units.sort((a, b) => b.lastActivity - a.lastActivity)
    }

    if (isSearchMode) {
      // Family grouping applies among matching rows only: non-matching members
      // are absent; when the root doesn't match, the first matching branch is
      // the visible head — rendered WITHOUT chevron/count.
      const matchingRows = hydrateFamilyRows(groupIntoFamilyUnits(matchingFilterItems, familyBySessionId, collapsedGroups))
      const otherRows = hydrateFamilyRows(groupIntoFamilyUnits(otherResultItems, familyBySessionId, collapsedGroups))

      const groups: EntityListGroup<SessionListRow>[] = []
      if (matchingRows.length > 0) {
        groups.push({ key: 'matching', label: t("session.inCurrentView"), items: matchingRows })
      }
      if (otherRows.length > 0) {
        groups.push({ key: 'other', label: t("session.otherConversations"), items: otherRows })
      }

      return {
        rows: [...matchingRows, ...otherRows],
        groups,
      }
    }

    // flatItems only contains visible (expanded + paginated) items.
    // collapsedGroupsMeta provides key + count for collapsed groups so we
    // can insert header-only placeholder groups in the correct position.
    //
    // Family assembly happens BEFORE outer-group bucketing: the whole family
    // is assigned to ONE outer bucket — the bucket of its member with the
    // latest activity (max lastMessageAt). This keeps a family together even
    // when member activity spans several date buckets, in every grouping mode.
    // Family position inside the bucket = family lastActivity (max). Branch
    // rows of collapsed families are dropped from the stream (root stays).
    const familyUnits = groupIntoFamilyUnits(flatItems, familyBySessionId, collapsedGroups)

    if (effectiveGroupingMode === 'unread') {
      // Two fixed buckets: unread on top, read below. Within each, items keep
      // the same `lastMessageAt`-descending order they already arrive in.
      // Both buckets always render — even when empty — so the user can see at
      // a glance which mode they're in. The header shows a count, so an empty
      // bucket is unambiguous (e.g. "Unread (0)").
      const unreadUnits: FamilyUnit<SessionMeta>[] = []
      const readUnits: FamilyUnit<SessionMeta>[] = []
      for (const unit of familyUnits) {
        // Family bucket = bucket of its latest-activity member.
        if (unit.bucketItem.hasUnread) unreadUnits.push(unit)
        else readUnits.push(unit)
      }
      sortUnitsByActivity(unreadUnits)
      sortUnitsByActivity(readUnits)
      const unreadRows = hydrateFamilyRows(unreadUnits)
      const readRows = hydrateFamilyRows(readUnits)

      const collapsedUnread = collapsedGroupsMeta.find(m => m.key === 'unread-yes')
      const collapsedRead = collapsedGroupsMeta.find(m => m.key === 'unread-no')

      // For collapsed groups prefer the persisted count (matches how the
      // date/status branches surface the size of a collapsed bucket).
      const orderedGroups: EntityListGroup<SessionListRow>[] = [
        {
          key: 'unread-yes',
          label: t('session.unreadLabel'),
          items: unreadRows,
          // Empty groups have nothing to collapse into; suppress the caret.
          collapsible: unreadRows.length > 0 || !!collapsedUnread,
          ...(collapsedUnread ? { collapsedCount: collapsedUnread.count } : {}),
        },
        {
          key: 'unread-no',
          label: t('session.readLabel'),
          items: readRows,
          collapsible: readRows.length > 0 || !!collapsedRead,
          ...(collapsedRead ? { collapsedCount: collapsedRead.count } : {}),
        },
      ]

      return {
        rows: orderedGroups.flatMap(g => g.items),
        groups: orderedGroups,
      }
    }

    if (effectiveGroupingMode === 'status') {
      const statusOrder = new Map<string, number>()
      sessionStatuses.forEach((state, index) => statusOrder.set(state.id, index))

      // Build groups from visible items
      const groupsByKey = new Map<string, { units: FamilyUnit<SessionMeta>[], statusId: string }>()
      for (const unit of familyUnits) {
        // Family bucket = status of its latest-activity member.
        const statusId = getSessionStatus(unit.bucketItem)
        const key = `status-${statusId}`
        if (!groupsByKey.has(key)) groupsByKey.set(key, { units: [], statusId })
        groupsByKey.get(key)!.units.push(unit)
      }

      // Insert collapsed placeholder groups
      for (const meta of collapsedGroupsMeta) {
        if (!groupsByKey.has(meta.key)) {
          const statusId = meta.key.replace('status-', '')
          groupsByKey.set(meta.key, { units: [], statusId })
        }
      }

      const orderedGroups: EntityListGroup<SessionListRow>[] = []
      for (const [key, { units: groupUnits, statusId }] of groupsByKey) {
        const state = sessionStatuses.find(s => s.id === statusId)
        if (!state) continue
        sortUnitsByActivity(groupUnits)
        const collapsedMeta = collapsedGroupsMeta.find(m => m.key === key)
        orderedGroups.push({
          key,
          label: t(`status.${state.id}`, state.label),
          items: hydrateFamilyRows(groupUnits),
          collapsible: true,
          ...(collapsedMeta ? { collapsedCount: collapsedMeta.count } : {}),
        })
      }
      orderedGroups.sort((a, b) => {
        const aOrder = statusOrder.get(a.key.replace('status-', '')) ?? 999
        const bOrder = statusOrder.get(b.key.replace('status-', '')) ?? 999
        return aOrder - bOrder
      })

      // If only one group exists, disable collapsing — there's nothing to collapse into
      if (orderedGroups.length === 1) {
        orderedGroups[0].collapsible = false
      }

      return {
        rows: orderedGroups.flatMap(g => g.items),
        groups: orderedGroups,
      }
    }

    if (effectiveGroupingMode === 'project') {
      // Build groups from visible items, bucketed by projectId.
      // Sessions without a projectId (or with an unknown projectId) go to the
      // "no-project" bucket so they're never silently dropped from the list.
      const projectOrder = new Map<string, number>()
      ;(projects ?? []).forEach((p, index) => projectOrder.set(p.id, index))
      const projectNameById = new Map<string, string>()
      ;(projects ?? []).forEach(p => projectNameById.set(p.id, p.name))

      const groupsByKey = new Map<string, { units: FamilyUnit<SessionMeta>[], projectId: string | null }>()
      for (const unit of familyUnits) {
        // Family bucket = project of its latest-activity member.
        const rawProjectId = unit.bucketItem.projectId
        const resolvedProjectId = rawProjectId && projectNameById.has(rawProjectId) ? rawProjectId : null
        const key = resolvedProjectId ? `project-${resolvedProjectId}` : 'project-__none__'
        if (!groupsByKey.has(key)) groupsByKey.set(key, { units: [], projectId: resolvedProjectId })
        groupsByKey.get(key)!.units.push(unit)
      }

      // Insert collapsed placeholder groups (header-only, items: [])
      for (const meta of collapsedGroupsMeta) {
        if (!groupsByKey.has(meta.key)) {
          const idPart = meta.key.replace('project-', '')
          const projectId = idPart === '__none__' ? null : idPart
          groupsByKey.set(meta.key, { units: [], projectId })
        }
      }

      const orderedGroups: EntityListGroup<SessionListRow>[] = []
      for (const [key, { units: groupUnits, projectId }] of groupsByKey) {
        sortUnitsByActivity(groupUnits)
        const collapsedMeta = collapsedGroupsMeta.find(m => m.key === key)
        const label = projectId
          ? (projectNameById.get(projectId) ?? t('sidebar.unknownProject', { defaultValue: 'Unknown project' }))
          : t('sidebar.noProject', { defaultValue: 'No project' })
        orderedGroups.push({
          key,
          label,
          items: hydrateFamilyRows(groupUnits),
          collapsible: true,
          ...(collapsedMeta ? { collapsedCount: collapsedMeta.count } : {}),
        })
      }
      orderedGroups.sort((a, b) => {
        // No-project bucket sinks to the bottom, configured projects in registration order
        if (a.key === 'project-__none__') return 1
        if (b.key === 'project-__none__') return -1
        const aOrder = projectOrder.get(a.key.replace('project-', '')) ?? 999
        const bOrder = projectOrder.get(b.key.replace('project-', '')) ?? 999
        return aOrder - bOrder
      })

      if (orderedGroups.length === 1) {
        orderedGroups[0].collapsible = false
      }

      return {
        rows: orderedGroups.flatMap(g => g.items),
        groups: orderedGroups,
      }
    }

    if (effectiveGroupingMode === 'priority') {
      // Display-driven (groupBy === 'priority'): fixed urgent → none order.
      const priorityOrder = new Map<string, number>()
      LIST_PRIORITY_ORDER.forEach((p, index) => priorityOrder.set(p, index))

      const groupsByKey = new Map<string, { units: FamilyUnit<SessionMeta>[], priority: string }>()
      for (const unit of familyUnits) {
        const priority = unit.bucketItem.priority ?? 'none'
        const key = `priority:${priority}`
        if (!groupsByKey.has(key)) groupsByKey.set(key, { units: [], priority })
        groupsByKey.get(key)!.units.push(unit)
      }

      for (const meta of collapsedGroupsMeta) {
        if (!groupsByKey.has(meta.key)) {
          groupsByKey.set(meta.key, { units: [], priority: meta.key.replace('priority:', '') })
        }
      }

      const orderedGroups: EntityListGroup<SessionListRow>[] = []
      for (const [key, { units: groupUnits, priority }] of groupsByKey) {
        sortUnitsByActivity(groupUnits)
        const collapsedMeta = collapsedGroupsMeta.find(m => m.key === key)
        orderedGroups.push({
          key,
          label: t(`priority.${priority}`, { defaultValue: priority }),
          items: hydrateFamilyRows(groupUnits),
          collapsible: true,
          ...(collapsedMeta ? { collapsedCount: collapsedMeta.count } : {}),
        })
      }
      orderedGroups.sort((a, b) => {
        const aOrder = priorityOrder.get(a.key.replace('priority:', '')) ?? 999
        const bOrder = priorityOrder.get(b.key.replace('priority:', '')) ?? 999
        return aOrder - bOrder
      })

      if (orderedGroups.length === 1) {
        orderedGroups[0].collapsible = false
      }

      return {
        rows: orderedGroups.flatMap(g => g.items),
        groups: orderedGroups,
      }
    }

    if (effectiveGroupingMode === 'dueDate') {
      // Display-driven (groupBy === 'dueDate'): fixed overdue → none order.
      const dueOrder = new Map<string, number>()
      LIST_DUE_ORDER.forEach((b, index) => dueOrder.set(b, index))
      const now = Date.now()

      const groupsByKey = new Map<string, { units: FamilyUnit<SessionMeta>[], bucket: string }>()
      for (const unit of familyUnits) {
        const key = getListGroupKey(unit.bucketItem, 'dueDate', now)
        const bucket = key.replace('due:', '')
        if (!groupsByKey.has(key)) groupsByKey.set(key, { units: [], bucket })
        groupsByKey.get(key)!.units.push(unit)
      }

      for (const meta of collapsedGroupsMeta) {
        if (!groupsByKey.has(meta.key)) {
          groupsByKey.set(meta.key, { units: [], bucket: meta.key.replace('due:', '') })
        }
      }

      const orderedGroups: EntityListGroup<SessionListRow>[] = []
      for (const [key, { units: groupUnits, bucket }] of groupsByKey) {
        sortUnitsByActivity(groupUnits)
        const collapsedMeta = collapsedGroupsMeta.find(m => m.key === key)
        orderedGroups.push({
          key,
          label: t(`collection.display.dueBucket.${bucket}`, { defaultValue: bucket }),
          items: hydrateFamilyRows(groupUnits),
          collapsible: true,
          ...(collapsedMeta ? { collapsedCount: collapsedMeta.count } : {}),
        })
      }
      orderedGroups.sort((a, b) => {
        const aOrder = dueOrder.get(a.key.replace('due:', '')) ?? 999
        const bOrder = dueOrder.get(b.key.replace('due:', '')) ?? 999
        return aOrder - bOrder
      })

      if (orderedGroups.length === 1) {
        orderedGroups[0].collapsible = false
      }

      return {
        rows: orderedGroups.flatMap(g => g.items),
        groups: orderedGroups,
      }
    }

    if (effectiveGroupingMode === 'label') {
      // Display-driven (groupBy === 'label'): bucket = first sorted label id;
      // sessions without labels land in label:none (never dropped).
      const labelNameById = new Map<string, string>()
      for (const label of flatLabels) labelNameById.set(label.id, label.name)

      const groupsByKey = new Map<string, { units: FamilyUnit<SessionMeta>[], labelId: string | null }>()
      for (const unit of familyUnits) {
        const first = (unit.bucketItem.labels ?? []).slice().sort((a, b) => a.localeCompare(b))[0]
        const key = first ? `label:${first}` : 'label:none'
        if (!groupsByKey.has(key)) groupsByKey.set(key, { units: [], labelId: first ?? null })
        groupsByKey.get(key)!.units.push(unit)
      }

      for (const meta of collapsedGroupsMeta) {
        if (!groupsByKey.has(meta.key)) {
          const idPart = meta.key.replace('label:', '')
          groupsByKey.set(meta.key, { units: [], labelId: idPart === 'none' ? null : idPart })
        }
      }

      const orderedGroups: EntityListGroup<SessionListRow>[] = []
      for (const [key, { units: groupUnits, labelId }] of groupsByKey) {
        sortUnitsByActivity(groupUnits)
        const collapsedMeta = collapsedGroupsMeta.find(m => m.key === key)
        orderedGroups.push({
          key,
          label: labelId
            ? (labelNameById.get(labelId) ?? labelId)
            : t('collection.display.labelNone', { defaultValue: 'No label' }),
          items: hydrateFamilyRows(groupUnits),
          collapsible: true,
          ...(collapsedMeta ? { collapsedCount: collapsedMeta.count } : {}),
        })
      }
      orderedGroups.sort((a, b) => {
        if (a.key === 'label:none') return 1
        if (b.key === 'label:none') return -1
        return a.label.localeCompare(b.label)
      })

      if (orderedGroups.length === 1) {
        orderedGroups[0].collapsible = false
      }

      return {
        rows: orderedGroups.flatMap(g => g.items),
        groups: orderedGroups,
      }
    }

    // Default: group by date
    const unitsByKey = new Map<string, FamilyUnit<SessionMeta>[]>()
    const groupDates = new Map<string, Date>()

    for (const unit of familyUnits) {
      // Family bucket = date of its latest-activity member, so a family never
      // splits across day buckets when activity spans several days.
      const day = startOfDay(new Date(unit.bucketItem.lastMessageAt || 0))
      const groupKey = day.toISOString()

      if (!unitsByKey.has(groupKey)) {
        unitsByKey.set(groupKey, [])
        groupDates.set(groupKey, day)
      }
      unitsByKey.get(groupKey)!.push(unit)
    }

    // Insert collapsed placeholder groups (header-only, items: [])
    for (const meta of collapsedGroupsMeta) {
      if (!unitsByKey.has(meta.key)) {
        unitsByKey.set(meta.key, [])
        groupDates.set(meta.key, new Date(meta.key))
      }
    }

    // Sort all groups by date descending
    const orderedKeys = Array.from(groupDates.entries())
      .sort(([, a], [, b]) => b.getTime() - a.getTime())
      .map(([key]) => key)

    const orderedGroups: EntityListGroup<SessionListRow>[] = orderedKeys.map(key => {
      const bucketUnits = unitsByKey.get(key)!
      sortUnitsByActivity(bucketUnits)
      const collapsedMeta = collapsedGroupsMeta.find(m => m.key === key)
      return {
        key,
        label: formatDateGroupLabel(groupDates.get(key)!, t, i18n.resolvedLanguage ?? 'en'),
        items: hydrateFamilyRows(bucketUnits),
        collapsible: true,
        ...(collapsedMeta ? { collapsedCount: collapsedMeta.count } : {}),
      }
    })

    // If only one group exists, disable collapsing — there's nothing to collapse into
    if (orderedGroups.length === 1) {
      orderedGroups[0].collapsible = false
    }

    return {
      // Rows must match the flattened visual order so keyboard nav tracks it.
      rows: orderedGroups.flatMap(g => g.items),
      groups: orderedGroups,
    }
  }, [isSearchMode, matchingFilterItems, otherResultItems, flatItems, effectiveGroupingMode, rankDragEnabled, sessionStatuses, projects, flatLabels, collapsedGroupsMeta, collapsedGroups, familyBySessionId, t])

  const flatRows = rowData.rows

  const collapseAllGroups = useCallback(() => {
    // Collapse All also collapses session families (family:<rootId> keys).
    const allKeys = new Set(familyCollapseKeys(familyBySessionId))
    if (effectiveGroupingMode === 'project') {
      const knownProjectIds = new Set((projects ?? []).map(p => p.id))
      items.forEach(item => {
        const pid = item.projectId
        allKeys.add(pid && knownProjectIds.has(pid) ? `project-${pid}` : 'project-__none__')
      })
    } else {
      const now = Date.now()
      items.forEach(item => allKeys.add(getListGroupKey(item, effectiveGroupingMode, now)))
    }
    setCollapsedGroups(allKeys)
  }, [items, effectiveGroupingMode, projects, familyBySessionId])
  const expandAllGroups = useCallback(() => {
    setCollapsedGroups(new Set())
  }, [])

  const rowIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    flatRows.forEach((row, index) => {
      map.set(row.item.id, index)
    })
    return map
  }, [flatRows])

  // --- FR-45: LexoRank drag reorder (HTML5 DnD, same model as the table) ---
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const dragIdRef = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ sessionId: string; before: boolean } | null>(null)

  // Bucket keys follow the family representative so drag validation matches
  // the rendered grouping (a whole family lives in ONE bucket).
  const groupKeyOf = useCallback((id: string, now: number): string => {
    const meta = itemById.get(id)
    if (!meta) return ''
    return getListGroupKey(bucketRepresentatives.get(id) ?? meta, effectiveGroupingMode, now)
  }, [itemById, bucketRepresentatives, effectiveGroupingMode])

  const handleRowDragStart = useCallback((id: string) => {
    dragIdRef.current = id
  }, [])

  const handleRowDragOver = useCallback((id: string, e: React.DragEvent) => {
    if (!rankDragEnabled) return
    const dragId = dragIdRef.current
    if (dragId && dragId !== id) {
      const now = Date.now()
      const dragKey = groupKeyOf(dragId, now)
      const targetKey = groupKeyOf(id, now)
      if (
        dragKey !== targetKey &&
        !listCrossGroupDropAction(effectiveGroupingMode, targetKey)
      ) {
        setDropTarget(null)
        e.dataTransfer.dropEffect = 'none'
        return
      }
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2
    setDropTarget({ sessionId: id, before })
  }, [rankDragEnabled, groupKeyOf, effectiveGroupingMode])

  const finalizeReorder = useCallback(
    async (targetId: string, before: boolean) => {
      const dragId = dragIdRef.current
      dragIdRef.current = null
      setDropTarget(null)
      if (!dragId || dragId === targetId || !rankDragEnabled) return

      const dragMeta = itemById.get(dragId)
      const targetMeta = itemById.get(targetId)
      if (!dragMeta || !targetMeta) return

      const now = Date.now()
      const dragKey = groupKeyOf(dragId, now)
      const targetKey = groupKeyOf(targetId, now)

      if (dragKey !== targetKey) {
        const action = listCrossGroupDropAction(effectiveGroupingMode, targetKey)
        if (!action) return

        const previousMetadataPatch =
          action.command.type === 'setSessionStatus'
            ? { sessionStatus: dragMeta.sessionStatus }
            : action.command.type === 'setPriority'
              ? { priority: dragMeta.priority }
              : { projectId: dragMeta.projectId }

        try {
          updateMeta(dragId, action.metadataPatch)
          await window.electronAPI.sessionCommand(dragId, action.command)
        } catch (error) {
          console.error('[SessionList] Failed to move session between groups:', error)
          updateMeta(dragId, previousMetadataPatch)
          toast.error(t('collection.bulk.failed', { message: error instanceof Error ? error.message : String(error) }))
          return
        }
      }

      // Peers = visible rows of the target bucket in visual order, minus the
      // dragged session. After a cross-group move the drag row is not yet
      // rendered inside the target bucket, so exclusion is by id either way.
      const visiblePeers = flatRows
        .map(row => row.item)
        .filter(meta => meta.id !== dragId && groupKeyOf(meta.id, Date.now()) === targetKey)

      const initial = listRankReorderRequest(dragId, targetId, before, visiblePeers)
      if (!initial) return
      const previousRank = dragMeta.rank
      updateMeta(dragId, { rank: lexorankBetween(initial.previous?.rank, initial.next?.rank) })

      let refreshedItems: SessionMeta[] = items
      const refreshRankMetadata = async () => {
        const sessions = await window.electronAPI.getSessions()
        const refreshedMap = refreshMetadata({ sessions, loadedSessionIds, removeMissing: false })
        refreshedItems = items.map(meta => refreshedMap.get(meta.id) ?? meta)
      }

      try {
        await retryStaleRankReorder(
          initial,
          ({ sessionId, prevId, nextId }) => window.electronAPI.sessionCommand(sessionId, { type: 'reorderRank', prevId, nextId }),
          refreshRankMetadata,
          () => {
            const reorderedPeers = refreshedItems
              .filter(meta => meta.id !== dragId)
              .sort((a, b) => compareSessions(a, b, 'rank', 'asc'))
              .filter(meta => {
                const representative = bucketRepresentatives.get(meta.id)
                const keyMeta = representative
                  ? (refreshedItems.find(m => m.id === representative.id) ?? representative)
                  : meta
                return getListGroupKey(keyMeta, effectiveGroupingMode, Date.now()) === targetKey
              })
            const retry = listRankReorderRequest(dragId, targetId, before, reorderedPeers)
            if (retry) {
              updateMeta(dragId, { rank: lexorankBetween(retry.previous?.rank, retry.next?.rank) })
            }
            return retry
          },
        )
      } catch (error) {
        if (isStaleRankNeighborsError(error)) {
          await refreshRankMetadata().catch((refreshError) => {
            console.error('[SessionList] Failed to reload ranks after stale retry:', refreshError)
          })
        }
        console.error('[SessionList] Failed to reorder rank:', error)
        updateMeta(dragId, { rank: previousRank })
        toast.error(t('collection.bulk.failed', { message: error instanceof Error ? error.message : String(error) }))
      }
    },
    [rankDragEnabled, itemById, groupKeyOf, effectiveGroupingMode, flatRows, items, updateMeta, refreshMetadata, loadedSessionIds, bucketRepresentatives, t],
  )

  const handleListDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (dropTarget) {
        void finalizeReorder(dropTarget.sessionId, dropTarget.before)
      } else {
        dragIdRef.current = null
        setDropTarget(null)
      }
    },
    [dropTarget, finalizeReorder],
  )

  const handleListDragEnd = useCallback(() => {
    dragIdRef.current = null
    setDropTarget(null)
  }, [])

  // --- Action handlers with toast feedback ---
  const {
    handleFlagWithToast,
    handleUnflagWithToast,
    handleArchiveWithToast,
    handleUnarchiveWithToast,
    handleDeleteWithToast,
  } = useSessionActions({ onFlag, onUnflag, onArchive, onUnarchive, onDelete })

  // --- Focus zone ---
  const { focusZone } = useFocusContext()
  const { zoneRef, isFocused, shouldMoveDOMFocus } = useFocusZone({ zoneId: 'navigator' })

  // Keyboard eligibility: zone-focused OR search input focused (for arrow navigation)
  const isKeyboardEligible = isFocused || (searchActive && isSearchInputFocused)

  // --- Interactions (keyboard navigation + selection via shared atom) ---
  const interactions = useEntityListInteractions<SessionListRow>({
    items: flatRows,
    getId: (row) => row.item.id,
    keyboard: {
      onNavigate: useCallback((row: SessionListRow) => {
        navigateToSession(row.item.id)
      }, [navigateToSession]),
      onActivate: useCallback((row: SessionListRow) => {
        // Only navigate when not in multi-select (matches original behavior)
        if (!MultiSelect.isMultiSelectActive(selectionStore.state)) {
          navigateToSession(row.item.id)
        }
        onFocusChatInput?.(row.item.id)
      }, [selectionStore.state, navigateToSession, onFocusChatInput]),
      enabled: isKeyboardEligible,
      virtualFocus: searchActive ?? false,
    },
    multiSelect: true,
    selectionStore,
    selectedIdOverride: focusedSessionId,
  })

  // Sync activeIndex when selection changes externally (e.g. from ChatDisplay)
  useEffect(() => {
    const newIndex = flatRows.findIndex(row => row.item.id === selectionStore.state.selected)
    if (newIndex >= 0 && newIndex !== interactions.keyboard.activeIndex) {
      interactions.keyboard.setActiveIndex(newIndex)
    }
  }, [selectionStore.state.selected, flatRows, interactions.keyboard])

  // Focus active item when zone gains keyboard focus
  useEffect(() => {
    if (shouldMoveDOMFocus && flatRows.length > 0 && !(searchActive ?? false)) {
      interactions.keyboard.focusActiveItem()
    }
  }, [shouldMoveDOMFocus, flatRows.length, searchActive, interactions.keyboard])

  // --- Global keyboard shortcuts ---
  const isFocusWithinZone = () => zoneRef.current?.contains(document.activeElement) ?? false

  useAction('navigator.selectAll', () => {
    interactions.selection.selectAll()
  }, {
    enabled: isFocusWithinZone,
  }, [interactions.selection])

  useAction('navigator.clearSelection', () => {
    const selectedId = selectionStore.state.selected
    interactions.selection.clear()
    if (selectedId) navigateToSession(selectedId)
  }, {
    enabled: () => isMultiSelectActive && !showEscapeOverlay,
  }, [isMultiSelectActive, showEscapeOverlay, interactions.selection, selectionStore.state.selected, navigateToSession])

  // --- Click handlers ---
  const handleSelectSession = useCallback((row: SessionListRow, index: number) => {
    selectSession(row.item.id, index)
    navigateToSession(row.item.id)
  }, [selectSession, navigateToSession])

  const handleSelectSessionById = useCallback((sessionId: string) => {
    const index = rowIndexMap.get(sessionId) ?? -1
    if (index >= 0) {
      selectSession(sessionId, index)
    } else {
      selectSession(sessionId, 0)
    }
    navigateToSession(sessionId)
  }, [rowIndexMap, selectSession, navigateToSession])

  const handleToggleSelect = useCallback((row: SessionListRow, index: number) => {
    focusZone('navigator', { intent: 'click', moveFocus: false })
    toggleSession(row.item.id, index)
  }, [focusZone, toggleSession])

  const handleRangeSelect = useCallback((toIndex: number) => {
    focusZone('navigator', { intent: 'click', moveFocus: false })
    const allIds = flatRows.map(row => row.item.id)
    selectRange(toIndex, allIds)
  }, [focusZone, flatRows, selectRange])

  // Arrow key shortcuts for zone navigation (left → sidebar, right → chat)
  const handleKeyDown = useCallback((e: React.KeyboardEvent, _item: SessionMeta) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusZone('sidebar', { intent: 'keyboard' })
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusZone('chat', { intent: 'keyboard' })
      return
    }
  }, [focusZone])

  // --- Rename dialog ---
  const handleRenameClick = useCallback((sessionId: string, currentName: string) => {
    setRenameSessionId(sessionId)
    setRenameName(currentName)
    requestAnimationFrame(() => {
      setRenameDialogOpen(true)
    })
  }, [])

  const handleRenameSubmit = () => {
    if (renameSessionId && renameName.trim()) {
      onRename(renameSessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
    setRenameSessionId(null)
    setRenameName("")
  }

  // --- Search input key handler ---
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      searchInputRef.current?.blur()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      onFocusChatInput?.(selectionStore.state.selected ?? undefined)
      return
    }
    // Forward arrow keys via interactions
    interactions.searchInputProps.onKeyDown(e)
  }, [searchInputRef, onFocusChatInput, interactions.searchInputProps, selectionStore.state.selected])

  // --- Context value (shared across all SessionItems) ---
  const handleFocusZone = useCallback(() => focusZone('navigator', { intent: 'click', moveFocus: false }), [focusZone])
  const handleOpenInNewWindow = useCallback((item: SessionMeta) => onOpenInNewWindow?.(item), [onOpenInNewWindow])
  const resolvedSearchQuery = isSearchMode ? highlightQuery : searchQuery

  const listContext = useMemo((): SessionListContextValue => ({
    onRenameClick: handleRenameClick,
    onSessionStatusChange,
    onFlag: onFlag ? handleFlagWithToast : undefined,
    onUnflag: onUnflag ? handleUnflagWithToast : undefined,
    onArchive: onArchive ? handleArchiveWithToast : undefined,
    onUnarchive: onUnarchive ? handleUnarchiveWithToast : undefined,
    onMarkUnread,
    onDelete: handleDeleteWithToast,
    onLabelsChange,
    projects,
    onSetProjectId,
    onSelectSessionById: handleSelectSessionById,
    onOpenInNewWindow: handleOpenInNewWindow,
    onSendToWorkspace: (ids: string[]) => setSendToWorkspace(ids),
    onFocusZone: handleFocusZone,
    onKeyDown: handleKeyDown,
    sessionStatuses,
    flatLabels,
    labels,
    searchQuery: resolvedSearchQuery,
    selectedSessionId: focusedSessionId !== undefined ? focusedSessionId : selectionStore.state.selected,
    isMultiSelectActive,
    sessionOptions,
    contentSearchResults,
    activeChatMatchInfo,
    hasPendingPrompt,
  }), [
    handleRenameClick, onSessionStatusChange,
    onFlag, handleFlagWithToast, onUnflag, handleUnflagWithToast,
    onArchive, handleArchiveWithToast, onUnarchive, handleUnarchiveWithToast,
    onMarkUnread, handleDeleteWithToast, onLabelsChange,
    projects, onSetProjectId,
    handleSelectSessionById, handleOpenInNewWindow, setSendToWorkspace, handleFocusZone, handleKeyDown,
    sessionStatuses, flatLabels, labels, resolvedSearchQuery,
    focusedSessionId, selectionStore.state.selected, isMultiSelectActive,
    sessionOptions, contentSearchResults, activeChatMatchInfo, hasPendingPrompt,
  ])

  // --- Empty state (non-search) — keep search bar pinned above empty UI ---
  // Don't show empty state when there are collapsed groups with content
  if (flatRows.length === 0 && rowData.groups.length === 0 && !searchActive) {
    const filtersActive = activeFilterCount(collectionFilters) > 0
    const emptyBody = currentFilter?.kind === 'archived' ? (
      <EntityListEmptyScreen
        icon={<Archive />}
        title={t("session.noArchivedSessions")}
        description={t("session.noArchivedSessionsDesc")}
        className="h-full"
      />
    ) : filtersActive ? (
      <EntityListEmptyScreen
        icon={<ListFilter />}
        title={t("session.noMatchingSessions")}
        description={t("session.noMatchingSessionsDesc")}
        className="h-full"
      >
        <button
          type="button"
          onClick={() => { void setCollectionFilters({}) }}
          className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
        >
          {t("collection.filter.clear")}
        </button>
      </EntityListEmptyScreen>
    ) : (
      <EntityListEmptyScreen
        icon={<Inbox />}
        title={t("session.noSessionsYet")}
        description={t("session.noSessionsYetDesc")}
        className="h-full"
      >
        <button
          onClick={() => {
            const params: { status?: string; label?: string } = {}
            if (currentFilter?.kind === 'state') params.status = currentFilter.stateId
            else if (currentFilter?.kind === 'label') params.label = currentFilter.labelId
            navigate(routes.action.newSession(Object.keys(params).length > 0 ? params : undefined))
          }}
          className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
        >
          {t("session.newSession")}
        </button>
      </EntityListEmptyScreen>
    )
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <SessionSearchHeader
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onSearchClose={() => {
            onSearchChange?.('')
            onSearchClose?.()
          }}
          onKeyDown={handleSearchKeyDown}
          onFocus={() => setIsSearchInputFocused(true)}
          onBlur={() => setIsSearchInputFocused(false)}
          isSearching={isSearchingContent}
          isUnavailable={isSearchUnavailable}
          resultCount={0}
          exceededLimit={false}
          inputRef={searchInputRef}
        />
        <div className="flex-1 min-h-0">{emptyBody}</div>
      </div>
    )
  }

  // --- Render ---
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SessionListProvider value={listContext}>
      <EntityList<SessionListRow>
        groups={rowData.groups}
        getKey={(row) => row.item.id}
        renderItem={(row, _indexInGroup, isFirstInGroup) => {
          const flatIndex = rowIndexMap.get(row.item.id) ?? 0
          const rowProps = interactions.getRowProps(row, flatIndex)
          const sessionItem = (
            <SessionItem
              item={row.item}
              index={flatIndex}
              itemProps={rowProps.buttonProps as Record<string, unknown>}
              isSelected={rowProps.isSelected}
              isFirstInGroup={isFirstInGroup}
              isInMultiSelect={rowProps.isInMultiSelect ?? false}
              onSelect={() => handleSelectSession(row, flatIndex)}
              onToggleSelect={() => handleToggleSelect(row, flatIndex)}
              onRangeSelect={() => handleRangeSelect(flatIndex)}
            />
          )
          // Session family decoration: head rows (family root) get a chevron
          // toggle in the left gutter; branch rows are indented with a subtle
          // guide line. Collapsing a family hides branch rows only — the root
          // row always stays visible.
          let decorated = sessionItem
          if (row.familyHead) {
            const head = row.familyHead
            decorated = (
              <div className="relative pl-3">
                <button
                  type="button"
                  aria-label={t("sidebar.branchCount", { count: head.branchCount })}
                  title={t("sidebar.branchCount", { count: head.branchCount })}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleGroupCollapse(head.collapseKey)
                  }}
                  className="absolute left-0 top-0 bottom-0 z-10 flex items-center gap-0.5 px-0 text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 transition-transform",
                      !head.collapsed && "rotate-90"
                    )}
                  />
                  {head.collapsed && (
                    <span className="text-[10px] tabular-nums text-muted-foreground/50">{head.branchCount}</span>
                  )}
                </button>
                {sessionItem}
              </div>
            )
          } else if (row.isFamilyBranch) {
            decorated = (
              <div className="ml-[14px] border-l border-foreground/10">
                {sessionItem}
              </div>
            )
          }
          if (!rankDragEnabled) return decorated
          const indicator = dropTarget?.sessionId === row.item.id
            ? (dropTarget.before ? 'before' : 'after')
            : null
          return (
            <div
              className={cn(
                'group/rankdrag relative',
                indicator === 'before' && 'border-t-2 border-t-foreground/40',
                indicator === 'after' && 'border-b-2 border-b-foreground/40',
              )}
              draggable
              onDragStart={() => handleRowDragStart(row.item.id)}
              onDragOver={(e) => handleRowDragOver(row.item.id, e)}
              onDragEnd={handleListDragEnd}
            >
              <span
                aria-hidden
                className="absolute right-1 top-1/2 z-10 -translate-y-1/2 cursor-grab text-muted-foreground/40 opacity-0 transition-opacity group-hover/rankdrag:opacity-100 active:cursor-grabbing"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
              {decorated}
            </div>
          )
        }}
        header={
          <>
            <SessionSearchHeader
              searchQuery={searchQuery}
              onSearchChange={onSearchChange}
              onSearchClose={() => {
                onSearchChange?.('')
                onSearchClose?.()
              }}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => setIsSearchInputFocused(true)}
              onBlur={() => setIsSearchInputFocused(false)}
              isSearching={isSearchingContent}
              isUnavailable={isSearchUnavailable}
              resultCount={matchingFilterItems.length + otherResultItems.length}
              exceededLimit={exceededSearchLimit}
              inputRef={searchInputRef}
            />
            {isSearchMode && matchingFilterItems.length === 0 && otherResultItems.length > 0 && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                {t("session.noResultsInFilter")}
              </div>
            )}
          </>
        }
        emptyState={
          isSearchMode && !isSearchingContent ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <p className="text-sm text-muted-foreground">{t("session.noSessionsFound")}</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                {t("session.noSessionsFoundDesc")}
              </p>
              <button
                onClick={() => onSearchChange?.('')}
                className="text-xs text-foreground hover:underline mt-2"
              >
                {t("session.clearSearch")}
              </button>
            </div>
          ) : undefined
        }
        footer={
          hasMore ? (
            <div className="flex justify-center py-4">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : undefined
        }
        viewportRef={scrollViewportRef}
        containerRef={zoneRef}
        containerProps={{
          'data-focus-zone': 'navigator',
          'data-list-role': 'sessions',
          role: 'listbox',
          'aria-label': 'Sessions',
          onDrop: handleListDrop,
          onDragOver: (e: React.DragEvent) => {
            if (rankDragEnabled) e.preventDefault()
          },
        }}
        scrollAreaClassName="select-none mask-fade-top-short"
        collapsedGroups={collapsedGroups}
        onToggleCollapse={toggleGroupCollapse}
        onCollapseAll={collapseAllGroups}
        onExpandAll={expandAllGroups}
      />
      </SessionListProvider>

      {/* Rename Dialog */}
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title={t("session.renameSession")}
        value={renameName}
        onValueChange={setRenameName}
        onSubmit={handleRenameSubmit}
        placeholder={t("session.enterSessionName")}
      />
    </div>
  )
}
