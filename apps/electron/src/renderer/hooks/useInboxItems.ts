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

const EMPTY_MAP = new Map<string, never[]>()

export type InboxRemoteSource = 'memory' | 'skills' | 'senders'

export function useInboxItems(options: { withRemote?: boolean } = {}) {
  const withRemote = options.withRemote ?? false
  const shell = useOptionalAppShellContext()
  const workspaceId = shell?.activeWorkspaceId ?? null
  const sessionMap = useAtomValue(sessionMetaMapAtom) as ReadonlyMap<string, SessionLike & { workspaceId?: string }>
  const [state, setState] = useAtom(inboxStateAtom)
  const [memory, setMemory] = useState<MemoryProposalLike[]>([])
  const [skills, setSkills] = useState<PendingSkillLike[]>([])
  const [senders, setSenders] = useState<PendingSenderLike[]>([])
  const [loaded, setLoaded] = useState<Record<InboxRemoteSource, boolean>>({ memory: false, skills: false, senders: false })
  const [errors, setErrors] = useState<Partial<Record<InboxRemoteSource, string>>>({})
  const firstSeen = useRef(new Map<string, number>())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const load = useCallback(async (which?: InboxRemoteSource) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api || !workspaceId) return
    const run = async <T,>(key: InboxRemoteSource, fn: () => Promise<T>, set: (v: T) => void) => {
      if (which && which !== key) return
      try {
        set(await fn())
        setErrors((e) => ({ ...e, [key]: undefined }))
      } catch (error) {
        setErrors((e) => ({ ...e, [key]: error instanceof Error ? error.message : String(error) }))
      } finally {
        setLoaded((l) => (l[key] ? l : { ...l, [key]: true }))
      }
    }
    await Promise.all([
      run('memory', () => api.listMemoryProposals?.(workspaceId) ?? Promise.resolve([]), (v) => setMemory((v ?? []) as MemoryProposalLike[])),
      run('skills', () => api.listPendingSkills?.(workspaceId) ?? Promise.resolve([]), (v) => setSkills((v ?? []) as unknown as PendingSkillLike[])),
      run('senders', () => api.getMessagingPendingSenders?.() ?? Promise.resolve([]), (v) => setSenders((v ?? []) as PendingSenderLike[])),
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
    () => [...sessionMap.values()].filter((s) => !workspaceId || !s.workspaceId || s.workspaceId === workspaceId),
    [sessionMap, workspaceId],
  )

  const items: InboxItem[] = useMemo(() => {
    const built = buildInboxItems({
      sessions,
      permissions: shell?.pendingPermissions ?? EMPTY_MAP,
      credentials: shell?.pendingCredentials ?? EMPTY_MAP,
      memoryProposals: withRemote ? memory : [],
      pendingSkills: withRemote ? skills : [],
      pendingSenders: withRemote ? senders : [],
      firstSeen: firstSeen.current,
      now,
    })
    for (const item of built) if (!firstSeen.current.has(item.id)) firstSeen.current.set(item.id, item.at)
    return built
  }, [sessions, shell?.pendingPermissions, shell?.pendingCredentials, memory, skills, senders, withRemote, now])

  const allLoaded = loaded.memory && loaded.skills && loaded.senders
  useEffect(() => {
    // Only prune once every source answered, or done-marks of unloaded kinds would be lost.
    if (!withRemote || !allLoaded) return
    const next = pruneInboxState(state, new Set(items.map((i) => i.id)), now)
    if (next !== state) setState(next)
  }, [withRemote, allLoaded, items, state, now, setState])

  const counts = useMemo(() => inboxCounts(items, state, now), [items, state, now])

  return { items, state, setState, counts, now, loaded, errors, reload: load, workspaceId, shell }
}

/** Blocking count for the titlebar pill badge (no IPC). */
export function useInboxBlockingCount(): number {
  const { counts } = useInboxItems({ withRemote: false })
  return counts.blocking
}
