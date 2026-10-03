/**
 * Входящие aggregator: joins the live sources that already exist in the app
 * into InboxItem rows. Blocking sources (permissions, credentials, plans) are
 * read from AppShellContext + session metadata (no IPC); the rest are fetched
 * through existing RPCs only when `withRemote` (the Входящие page) is on.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { inboxStateAtom } from '@/atoms/inbox'
import { isInternalAgentSession } from '@craft-agent/shared/sessions/internal-prompts'
import {
  buildInboxItems,
  inboxCounts,
  pruneInboxState,
  type InboxItem,
  type MemoryProposalLike,
  type PendingSenderLike,
  type PendingSkillLike,
  type SessionLike,
} from '@/pages/inbox/inbox-model'
import type { TeamInboxItem } from '@craft-agent/shared/team'

const EMPTY_MAP = new Map<string, never[]>()

export type InboxRemoteSource = 'memory' | 'skills' | 'senders'

export function useInboxItems(options: { withRemote?: boolean; teamInbox?: readonly TeamInboxItem[] } = {}) {
  const withRemote = options.withRemote ?? false
  const shell = useOptionalAppShellContext()
  const workspaceId = shell?.activeWorkspaceId ?? null
  const sessionMap = useAtomValue(sessionMetaMapAtom)
  const [state, setState] = useAtom(inboxStateAtom)
  const [memory, setMemory] = useState<MemoryProposalLike[]>([])
  const [skills, setSkills] = useState<PendingSkillLike[]>([])
  const [senders, setSenders] = useState<PendingSenderLike[]>([])
  const [loaded, setLoaded] = useState<Record<InboxRemoteSource, boolean>>({ memory: false, skills: false, senders: false })
  const [errors, setErrors] = useState<Partial<Record<InboxRemoteSource, string>>>({})
  const [hasSnapshot, setHasSnapshot] = useState<Record<InboxRemoteSource, boolean>>({ memory: false, skills: false, senders: false })
  const [remoteWorkspaceId, setRemoteWorkspaceId] = useState(workspaceId)
  const workspaceRef = useRef(workspaceId)
  workspaceRef.current = workspaceId
  const firstSeen = useRef(new Map<string, number>())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setMemory([])
    setSkills([])
    setSenders([])
    setLoaded({ memory: false, skills: false, senders: false })
    setErrors({})
    setRemoteWorkspaceId(workspaceId)
    setHasSnapshot({ memory: false, skills: false, senders: false })
    firstSeen.current.clear()
  }, [workspaceId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const load = useCallback(async (which?: InboxRemoteSource) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api || !workspaceId) return
    const run = async <T,>(key: InboxRemoteSource, fn: () => Promise<T> | undefined, set: (v: T) => void) => {
      if (which && which !== key) return
      try {
        const request = fn()
        if (!request) throw new Error('This source is unavailable in the current runtime')
        const value = await request
        if (workspaceRef.current !== workspaceId) return
        set(value)
        setHasSnapshot((previous) => ({ ...previous, [key]: true }))
        setErrors((e) => ({ ...e, [key]: undefined }))
      } catch (error) {
        if (workspaceRef.current !== workspaceId) return
        setErrors((e) => ({ ...e, [key]: error instanceof Error ? error.message : String(error) }))
      } finally {
        if (workspaceRef.current === workspaceId) setLoaded((l) => (l[key] ? l : { ...l, [key]: true }))
      }
    }
    await Promise.all([
      run('memory', () => api.listMemoryProposals?.(workspaceId), (v) => setMemory((v ?? []) as MemoryProposalLike[])),
      run('skills', () => api.listPendingSkills?.(workspaceId), (v) => setSkills((v ?? []) as unknown as PendingSkillLike[])),
      run('senders', () => api.getMessagingPendingSenders?.(), (v) => setSenders((v ?? []) as PendingSenderLike[])),
    ])
  }, [workspaceId])

  useEffect(() => {
    if (!withRemote) return
    void load()
    const api = window.electronAPI
    const offSenders = api?.onMessagingPendingChanged?.(() => void load('senders'))
    const offSkills = api?.onSkillsPendingChanged?.(() => void load('skills'))
    const onFocus = () => void load('memory')
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void load('memory'), 60_000)
    return () => {
      offSenders?.()
      offSkills?.()
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [withRemote, load])

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
      memoryProposals: withRemote && remoteWorkspaceId === workspaceId ? memory : [],
      pendingSkills: withRemote && remoteWorkspaceId === workspaceId ? skills : [],
      pendingSenders: withRemote && remoteWorkspaceId === workspaceId ? senders : [],
      teamInbox: options.teamInbox,
      firstSeen: firstSeen.current,
      now,
    })
    for (const item of built) if (!firstSeen.current.has(item.id)) firstSeen.current.set(item.id, item.at)
    return built
  }, [sessions, shell?.pendingPermissions, shell?.pendingCredentials, memory, skills, senders, options.teamInbox, withRemote, now, remoteWorkspaceId, workspaceId])

  const allLoaded = loaded.memory && loaded.skills && loaded.senders
  const allSuccessful = remoteWorkspaceId === workspaceId && allLoaded && !errors.memory && !errors.skills && !errors.senders
  const staleSources = remoteWorkspaceId === workspaceId
    ? (['memory', 'skills', 'senders'] as const).filter((key) => hasSnapshot[key] && !!errors[key])
    : []
  useEffect(() => {
    // Failed sources retain their last snapshot; pruning then could erase valid triage state.
    if (!withRemote || !allSuccessful) return
    const next = pruneInboxState(state, new Set(items.map((i) => i.id)), now)
    if (next !== state) setState(next)
  }, [withRemote, allSuccessful, items, state, now, setState])

  const counts = useMemo(() => inboxCounts(items, state, now), [items, state, now])

  return {
    items,
    state,
    setState,
    counts,
    now,
    loaded,
    errors,
    staleSources,
    reload: load,
    workspaceId,
    shell,
    sessions,
  }

}

/** Blocking count for the titlebar pill badge (no IPC). */
export function useInboxBlockingCount(): number {
  const { counts } = useInboxItems({ withRemote: false })
  return counts.blocking
}
