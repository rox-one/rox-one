/**
 * Входящие aggregator: joins the live sources that already exist in the app
 * into InboxItem rows. Blocking sources (permissions, credentials, plans) are
 * read from AppShellContext + session metadata (no IPC); the rest are fetched
 * through existing RPCs only when `withRemote` (the Входящие page) is on.
 *
 * W1-09 (#1506): the activity surfaces (Review / Mentions / Assignments /
 * Notifications) join when their module flag is on. `enabledInboxKinds` reads
 * the shell's flag set, so with every flag off the built rows are exactly the
 * ones this hook produced before.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { inboxStateForWorkspace } from '@/atoms/inbox'
import { isInternalAgentSession } from '@rox/shared/sessions/internal-prompts'
import {
  ACTIVITY_KINDS,
  buildInboxItems,
  enabledInboxKinds,
  inboxCounts,
  pruneInboxState,
  type InboxItem,
  type InboxNotificationLike,
  type InboxActivityKind,
  type MemoryProposalLike,
  type PendingSenderLike,
  type PendingSkillLike,
  type SessionLike,
} from '@/pages/inbox/inbox-model'
import { WORKBENCH_FLAG } from '@rox/core/platform/workbench'
import { featureEntitiesLinksV1Atom } from '@/atoms/entities-links'
import { featureNotifyInboxV1Atom } from '@/atoms/notify-inbox'
import type { TeamInboxItem } from '@rox/shared/team'
import { useInboxActorContext } from './useInboxActorContext'
import { toErrorMessage } from '@/lib/errors'
import { ROX_REVALIDATE_AFTER_MS, roxQueryClient } from '@/lib/query/client'
import { roxKeys } from '@/lib/query/keys'
import { sharedRead } from '@/lib/query/shared-read'

const EMPTY_MAP = new Map<string, never[]>()
/**
 * PERF-09: Home, Inbox and Focus each mount this hook. Their mount, focus and
 * poll reads share one cached result per (workspace, actor, source) for this
 * long (the shared stale-while-revalidate window), so three instances cost
 * one RPC per source; change events and explicit refreshes always read.
 */
export const INBOX_SHARED_FRESH_MS = ROX_REVALIDATE_AFTER_MS

function cachedRemote<T>(workspaceId: string | null, actorKey: string | null, source: InboxRemoteSource): T[] | undefined {
  if (!workspaceId || !actorKey) return undefined
  return roxQueryClient().getQueryData<T[]>(roxKeys.inbox(workspaceId, actorKey, source))
}

export type InboxRemoteSource = 'memory' | 'skills' | 'senders'

export function useInboxItems(options: {
  withRemote?: boolean
  teamInbox?: readonly TeamInboxItem[]
  teamActorKey?: string | null
  /**
   * W1-09 (#1506): workspace notifications for the activity surfaces. The
   * caller owns the fetch (the workspace notify client is wave 2); items whose
   * module flag is off are dropped here, never rendered.
   */
  notifications?: readonly InboxNotificationLike[]
} = {}) {
  const withRemote = options.withRemote ?? false
  // Dedicated flag atoms only: the Inbox hook is loaded by the browser test
  // fixture, and the shell's flag set reaches `node:fs`. `goals.checkins.v1`
  // and `tasks.shared.v1` join here when their owners ship an atom — until
  // then their surfaces stay off by definition.
  const entitiesLinks = useAtomValue(featureEntitiesLinksV1Atom)
  const notifyInbox = useAtomValue(featureNotifyInboxV1Atom)
  const enabledFlags = useMemo(() => {
    const flags = new Set<string>()
    if (entitiesLinks) flags.add(WORKBENCH_FLAG.entitiesLinksV1)
    if (notifyInbox) flags.add(WORKBENCH_FLAG.notifyInboxV1)
    return flags
  }, [entitiesLinks, notifyInbox])
  const enabledKinds: ReadonlySet<InboxActivityKind> = useMemo(() => enabledInboxKinds(enabledFlags), [enabledFlags])
  const shell = useOptionalAppShellContext()
  const workspaceId = shell?.activeWorkspaceId ?? null
  const { context, contextRef, identityError, refreshIdentity } = useInboxActorContext(workspaceId, withRemote)
  const sessionMap = useAtomValue(sessionMetaMapAtom)
  const [state, setState] = useAtom(inboxStateForWorkspace(workspaceId, context.actorKey))
  const [memory, setMemory] = useState<MemoryProposalLike[]>([])
  const [skills, setSkills] = useState<PendingSkillLike[]>([])
  const [senders, setSenders] = useState<PendingSenderLike[]>([])
  const [loaded, setLoaded] = useState<Record<InboxRemoteSource, boolean>>({ memory: false, skills: false, senders: false })
  const [loading, setLoading] = useState<Record<InboxRemoteSource, boolean>>({ memory: false, skills: false, senders: false })
  const [errors, setErrors] = useState<Partial<Record<InboxRemoteSource, string>>>({})
  const [hasSnapshot, setHasSnapshot] = useState<Record<InboxRemoteSource, boolean>>({ memory: false, skills: false, senders: false })
  // Read in this actor context (a cache seed paints, but never drives pruning).
  const [fresh, setFresh] = useState<Record<InboxRemoteSource, boolean>>({ memory: false, skills: false, senders: false })
  const [remoteContext, setRemoteContext] = useState(context)
  const requests = useRef<Record<InboxRemoteSource, number>>({ memory: 0, skills: 0, senders: 0 })
  const firstSeen = useRef(new Map<string, number>())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // PERF-09: paint the last result for this exact workspace + actor, then revalidate.
    const seeded = {
      memory: cachedRemote<MemoryProposalLike>(context.workspaceId, context.actorKey, 'memory'),
      skills: cachedRemote<PendingSkillLike>(context.workspaceId, context.actorKey, 'skills'),
      senders: cachedRemote<PendingSenderLike>(context.workspaceId, context.actorKey, 'senders'),
    }
    const has = { memory: !!seeded.memory, skills: !!seeded.skills, senders: !!seeded.senders }
    setMemory(seeded.memory ?? [])
    setSkills(seeded.skills ?? [])
    setSenders(seeded.senders ?? [])
    setLoaded(has)
    setLoading({ memory: false, skills: false, senders: false })
    setErrors({})
    setRemoteContext(context)
    setHasSnapshot(has)
    setFresh({ memory: false, skills: false, senders: false })
    firstSeen.current.clear()
    for (const key of ['memory', 'skills', 'senders'] as const) requests.current[key]++
  }, [context])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  /**
   * `which` (a change event or an action on one source) and any explicit
   * call (`reload`, the Inbox refresh button) start fresh reads; only the
   * hook's own mount/focus/poll reads pass `shared` and may reuse or join.
   */
  const load = useCallback(async (which?: InboxRemoteSource, mode: 'fresh' | 'shared' = 'fresh') => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api || !workspaceId) return
    const captured = contextRef.current
    if (!captured.actorKey) { await refreshIdentity(); return }
    const verified = await refreshIdentity()
    if (contextRef.current !== captured || verified !== captured) return
    const run = async <T,>(key: InboxRemoteSource, fn: () => Promise<T> | undefined, set: (v: T) => void) => {
      if (which && which !== key) return
      const requestId = ++requests.current[key]
      const current = () => contextRef.current === captured && requests.current[key] === requestId
      setLoading((previous) => ({ ...previous, [key]: true }))
      try {
        // Shared per (workspace, verified actor, source). Mount/focus/poll reads
        // reuse a result younger than INBOX_SHARED_FRESH_MS or join one in
        // flight; change events and explicit refreshes always read.
        const client = roxQueryClient()
        const queryKey = roxKeys.inbox(workspaceId, captured.actorKey!, key)
        const shared = client.getQueryState<T>(queryKey)
        const reuse = !which && mode === 'shared'
        const value = reuse && shared?.status === 'success' && !shared.isInvalidated && shared.data !== undefined
          && Date.now() - shared.dataUpdatedAt < INBOX_SHARED_FRESH_MS
          ? shared.data
          : await sharedRead(client, queryKey, async () => {
            const request = fn()
            if (!request) throw new Error('This source is unavailable in the current runtime')
            return (await request) ?? ([] as unknown as T)
          }, { join: reuse })
        if (!current()) return
        set(value)
        setHasSnapshot((previous) => ({ ...previous, [key]: true }))
        setFresh((previous) => (previous[key] ? previous : { ...previous, [key]: true }))
        setErrors((e) => ({ ...e, [key]: undefined }))
      } catch (error) {
        if (!current()) return
        setErrors((e) => ({ ...e, [key]: toErrorMessage(error) }))
      } finally {
        if (current()) {
          setLoaded((l) => (l[key] ? l : { ...l, [key]: true }))
          setLoading((previous) => ({ ...previous, [key]: false }))
        }
      }
    }
    await Promise.all([
      run('memory', () => api.listMemoryProposals?.(workspaceId), (v) => setMemory((v ?? []) as MemoryProposalLike[])),
      run('skills', () => api.listPendingSkills?.(workspaceId), (v) => setSkills((v ?? []) as unknown as PendingSkillLike[])),
      run('senders', () => api.getMessagingPendingSenders?.(), (v) => setSenders((v ?? []) as PendingSenderLike[])),
    ])
  }, [contextRef, refreshIdentity, workspaceId])

  useEffect(() => {
    if (!withRemote || !context.actorKey) return
    void load(undefined, 'shared')
    const api = window.electronAPI
    const offSenders = api?.onMessagingPendingChanged?.(() => void load('senders'))
    const offSkills = api?.onSkillsPendingChanged?.(() => void load('skills'))
    const offMemory = api?.onMemoryChanged?.((changedWorkspace) => { if (!changedWorkspace || changedWorkspace === workspaceId) void load('memory') })
    const onFocus = () => void load(undefined, 'shared')
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void load(undefined, 'shared'), 60_000)
    return () => {
      offSenders?.()
      offSkills?.()
      offMemory?.()
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [withRemote, load, workspaceId, context])

  const sessions = useMemo(
    () => [...sessionMap.values()].filter((s) =>
      (!workspaceId || !s.workspaceId || s.workspaceId === workspaceId) && !isInternalAgentSession(s)),
    [sessionMap, workspaceId],
  )

  const items: InboxItem[] = useMemo(() => {
    const built = buildInboxItems({
      sessions,
      permissions: shell?.pendingPermissions ?? EMPTY_MAP,
      credentials: shell?.pendingCredentials ?? EMPTY_MAP,
      memoryProposals: withRemote && remoteContext === context ? memory : [],
      pendingSkills: withRemote && remoteContext === context ? skills : [],
      pendingSenders: withRemote && remoteContext === context ? senders : [],
      teamInbox: options.teamActorKey === undefined || options.teamActorKey === context.actorKey ? options.teamInbox : [],
      notifications: options.notifications ?? [],
      enabledKinds,
      firstSeen: firstSeen.current,
      now,
    })
    for (const item of built) if (!firstSeen.current.has(item.id)) firstSeen.current.set(item.id, item.at)
    return built
  }, [sessions, shell?.pendingPermissions, shell?.pendingCredentials, memory, skills, senders, options.teamInbox, options.teamActorKey, options.notifications, enabledKinds, withRemote, now, remoteContext, context])

  const allFresh = fresh.memory && fresh.skills && fresh.senders
  const allSuccessful = remoteContext === context && allFresh && !errors.memory && !errors.skills && !errors.senders
  const staleSources = remoteContext === context
    ? (['memory', 'skills', 'senders'] as const).filter((key) => hasSnapshot[key] && !!errors[key])
    : []
  useEffect(() => {
    // Failed sources retain their last snapshot; pruning then could erase valid triage state.
    if (!withRemote || !allSuccessful) return
    const next = pruneInboxState(state, new Set(items.map((i) => i.id)), now)
    if (next !== state) setState(next)
  }, [withRemote, allSuccessful, items, state, now, setState])

  const counts = useMemo(() => inboxCounts(items, state, now), [items, state, now])
  // Enabled activity surfaces in the model's canonical order (sidebar order).
  const activityKinds = useMemo(() => ACTIVITY_KINDS.filter((kind) => enabledKinds.has(kind)), [enabledKinds])

  return {
    items,
    state,
    setState,
    counts,
    activityKinds,
    now,
    loaded: identityError ? { memory: true, skills: true, senders: true } : remoteContext === context ? loaded : { memory: false, skills: false, senders: false },
    loading: remoteContext === context ? loading : { memory: false, skills: false, senders: false },
    errors: identityError ? { memory: identityError, skills: identityError, senders: identityError } : remoteContext === context ? errors : {},
    staleSources,
    reload: load,
    workspaceId,
    shell,
    sessions,
    actorContext: context,
    actorContextRef: contextRef,
  }

}

/** Blocking count for the titlebar pill badge (no IPC). */
export function useInboxBlockingCount(): number {
  const { counts } = useInboxItems({ withRemote: false })
  return counts.blocking
}
