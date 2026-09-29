/**
 * Shared read-only data hooks for the extra screens: sessions (renderer
 * atoms), personal tasks, meetings and messenger bindings. Every source
 * degrades to an empty list + `available: false` instead of throwing.
 */
import { useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import type { PersonalTask } from '@craft-agent/core/tasks/personal'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { subscribePersonalTasks } from '@/lib/personal-tasks'
import { listPersonalTasks } from './personal-task-bridge'

export function useWorkspaceSessions(workspaceId: string | null | undefined): SessionMeta[] {
  const map = useAtomValue(sessionMetaMapAtom)
  return useMemo(() => {
    const out: SessionMeta[] = []
    for (const meta of map.values()) {
      if (meta.hidden) continue
      if (workspaceId && meta.workspaceId !== workspaceId) continue
      out.push(meta)
    }
    return out
  }, [map, workspaceId])
}

export function sessionTitle(meta: Pick<SessionMeta, 'name' | 'preview' | 'id'>): string {
  return meta.name?.trim() || meta.preview?.trim() || meta.id
}

export function usePersonalTasks(): PersonalTask[] {
  const [tasks, setTasks] = useState<PersonalTask[]>(() => listPersonalTasks())
  useEffect(() => subscribePersonalTasks(() => setTasks(listPersonalTasks())), [])
  return tasks
}

export interface MeetingRow {
  id: string
  title: string
  at?: number
  status?: string
}

export function normalizeMeetingList(listed: unknown): MeetingRow[] {
  if (!listed || typeof listed !== 'object') return []
  const record = listed as { items?: unknown; page?: unknown }
  const rows = Array.isArray(record.items) ? record.items : Array.isArray(record.page) ? record.page : Array.isArray(listed) ? (listed as unknown[]) : []
  const out: MeetingRow[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : typeof r.meetingId === 'string' ? r.meetingId : ''
    const title = typeof r.title === 'string' ? r.title : ''
    if (!id) continue
    const at = [r.scheduledAt, r.startedAt, r.createdAt, r.updatedAt].find((v): v is number => typeof v === 'number')
    out.push({ id, title: title || id, at, status: typeof r.status === 'string' ? r.status : undefined })
  }
  return out
}

export function useMeetings(workspaceId: string | null | undefined): { meetings: MeetingRow[]; available: boolean } {
  const [state, setState] = useState<{ meetings: MeetingRow[]; available: boolean }>({ meetings: [], available: false })
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    // Local recordings (Встречи) are the source of real meetings on this device.
    const local = api?.meetingsLocal
    if (local) {
      const load = () => local.list(workspaceId ?? null).then(
        (listed) => { if (!cancelled) setState({ meetings: normalizeMeetingList(listed), available: true }) },
        () => { if (!cancelled) setState({ meetings: [], available: false }) },
      )
      void load()
      const off = local.onChanged(() => { void load() })
      return () => { cancelled = true; off() }
    }
    if (!workspaceId || typeof api?.listMeetings !== 'function') {
      setState({ meetings: [], available: false })
      return
    }
    api.listMeetings(workspaceId).then(
      (listed) => { if (!cancelled) setState({ meetings: normalizeMeetingList(listed), available: true }) },
      () => { if (!cancelled) setState({ meetings: [], available: false }) },
    )
    return () => { cancelled = true }
  }, [workspaceId])
  return state
}

export interface MessengerBinding {
  sessionId: string
  platform: string
  channelName?: string
  enabled: boolean
}

export function useMessengerBindings(): MessengerBinding[] {
  const [bindings, setBindings] = useState<MessengerBinding[]>([])
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    if (typeof api?.getMessagingBindings !== 'function') return
    api.getMessagingBindings().then(
      (rows) => {
        if (cancelled) return
        setBindings(rows.map((row) => ({ sessionId: row.sessionId, platform: row.platform, channelName: row.channelName, enabled: row.enabled })))
      },
      () => {},
    )
    return () => { cancelled = true }
  }, [])
  return bindings
}

export type FeedItemRow = import('@craft-agent/shared/feed').FeedItem

export interface FeedState {
  /** false = no feed:list IPC (honest «Лента недоступна»). */
  available: boolean
  loaded: boolean
  items: FeedItemRow[]
  /** User news/X sources configured in Лента. */
  sourceCount: number
  xConnected: boolean
}

/** Real items from the Лента aggregator (feed:list), live via feed:changed. */
export async function loadFeed(workspaceId: string | null | undefined): Promise<Omit<FeedState, 'loaded'>> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api || typeof api.feedList !== 'function') return { available: false, items: [], sourceCount: 0, xConnected: false }
  const res = await api.feedList(workspaceId ?? null)
  return {
    available: true,
    items: Array.isArray(res?.items) ? res.items : [],
    sourceCount: Array.isArray(res?.sources) ? res.sources.length : 0,
    xConnected: res?.x?.state === 'connected',
  }
}

export function useFeedItems(workspaceId: string | null | undefined): FeedState {
  const [state, setState] = useState<FeedState>({ available: true, loaded: false, items: [], sourceCount: 0, xConnected: false })
  useEffect(() => {
    let cancelled = false
    const load = () => {
      loadFeed(workspaceId).then(
        (next) => { if (!cancelled) setState({ ...next, loaded: true }) },
        () => { if (!cancelled) setState({ available: false, loaded: true, items: [], sourceCount: 0, xConnected: false }) },
      )
    }
    load()
    const off = window.electronAPI?.onFeedChanged?.(() => load())
    return () => { cancelled = true; off?.() }
  }, [workspaceId])
  return state
}

/** Feed items that are not Rox's own agent activity (news, X, page changes, team). */
export function externalFeedItems(items: readonly FeedItemRow[]): FeedItemRow[] {
  return items.filter((item) => item.tab !== 'agents')
}
