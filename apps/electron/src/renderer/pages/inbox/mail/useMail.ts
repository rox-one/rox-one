/**
 * Renderer state for Rox Mail (inbox.mail.v1): status, folders, the current
 * list, the open message and «Все» unread rows. Talks to the main-process
 * bridge only through window.electronAPI.mailLocal; refreshes on JMAP push
 * (main → mail:changed). Creates the user's mailbox automatically on the
 * first Входящие open when the local server is reachable.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MailFolder, MailFolderRole, MailLocalApi, MailMessage, MailResult, MailStatus, MailSummary } from '../../../../shared/mail-local'
import type { InboxActorContext } from '../../../hooks/useInboxActorContext'

function api(): MailLocalApi | null {
  return (typeof window !== 'undefined' ? (window.electronAPI as { mailLocal?: MailLocalApi } | undefined)?.mailLocal : undefined) ?? null
}

export function unwrap<T>(r: MailResult<T>): T {
  if (!r.ok) throw Object.assign(new Error(r.message), { code: r.code })
  return r.value
}

export interface MailSelection {
  folderId: string | null
  role: MailFolderRole | null
}

export function useMail(options: { active: boolean; workspaceId?: string | null; actorContext?: InboxActorContext; actorContextRef?: { current: InboxActorContext } }) {
  const [status, setStatus] = useState<MailStatus | null>(null)
  const [folders, setFolders] = useState<MailFolder[]>([])
  const [folder, setFolder] = useState<MailSelection>({ folderId: null, role: 'inbox' })
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<MailSummary[]>([])
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState<MailSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(() => !!api())
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<MailMessage | null>(null)
  const openId = useRef<string | null>(null)
  const contextRef = useRef({ workspaceId: options.workspaceId, actorContext: options.actorContext })
  if (contextRef.current.workspaceId !== options.workspaceId || contextRef.current.actorContext !== options.actorContext) contextRef.current = { workspaceId: options.workspaceId, actorContext: options.actorContext }
  const [snapshotContext, setSnapshotContext] = useState(contextRef.current)
  const sameActor = useCallback(() => !options.actorContextRef || options.actorContextRef.current === options.actorContext, [options.actorContextRef, options.actorContext])
  const visibleSnapshot = snapshotContext === contextRef.current && sameActor()
  const statusRequest = useRef(0)
  const listRequest = useRef(0)
  const openRequest = useRef(0)
  const ensureTried = useRef(false)
  const ready = visibleSnapshot && status?.state === 'ready'

  useEffect(() => {
    setStatus(null); setFolders([]); setItems([]); setUnread([]); setMessage(null); setTotal(0); setError(null); setLoading(false)
    setFolder({ folderId: null, role: 'inbox' }); setSearch(''); setSnapshotContext(contextRef.current)
    setStatusLoading(!!api()); openId.current = null; ensureTried.current = false
  }, [options.workspaceId, sameActor])

  const refreshStatus = useCallback(async () => {
    const a = api()
    if (!a) return null
    const context = contextRef.current
    if (context.workspaceId !== options.workspaceId || !sameActor()) return null
    const request = ++statusRequest.current
    const current = () => contextRef.current === context && sameActor() && statusRequest.current === request
    setStatusLoading(true)
    try {
      const s = await a.status()
      if (!current()) return null
      setStatus(s); setError(null)
      return s
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : String(failure))
      return null
    } finally { if (current()) setStatusLoading(false) }
  }, [options.workspaceId, sameActor])

  const refresh = useCallback(async () => {
    const a = api()
    if (!a || !ready) return
    const context = contextRef.current
    if (context.workspaceId !== options.workspaceId || !sameActor()) return
    const request = ++listRequest.current
    const current = () => contextRef.current === context && sameActor() && listRequest.current === request
    setLoading(true)
    try {
      const [f, list, un] = await Promise.all([
        a.folders().then(unwrap),
        a.list({ folderId: folder.folderId ?? undefined, role: folder.folderId ? undefined : folder.role ?? 'inbox', text: search || undefined, limit: 100 }).then(unwrap),
        a.list({ role: 'inbox', unseenOnly: true, limit: 50 }).then(unwrap),
      ])
      if (!current()) return
      setFolders(f)
      setItems(list.items)
      setTotal(list.total)
      setUnread(un.items)
      setError(null)
      if (openId.current) {
        const m = await a.get(openId.current).then(unwrap)
        if (current() && openId.current === m?.id) setMessage(m)
      }
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (current()) setLoading(false)
    }
  }, [ready, folder.folderId, folder.role, search, options.workspaceId, sameActor])

  const ensure = useCallback(async () => {
    const a = api()
    if (!a) return
    const context = contextRef.current
    if (context.workspaceId !== options.workspaceId || !sameActor()) return
    const request = ++statusRequest.current
    const current = () => contextRef.current === context && sameActor() && statusRequest.current === request
    setStatus((s) => (s ? { ...s, state: 'provisioning' } : s))
    try { const r = await a.ensureMailbox(); if (!current()) return; if (r.ok) { setStatus(r.value); setError(null) } else setError(r.message) }
    catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : String(failure)) }
  }, [options.workspaceId, sameActor])

  useEffect(() => {
    if (!options.active) return
    const context = contextRef.current
    void refreshStatus()
    const off = api()?.onChanged((event) => {
      if (contextRef.current !== context || !sameActor()) return
      if (event.status) { statusRequest.current++; setStatus(event.status); setStatusLoading(false) }
      else void refresh()
    })
    const timer = window.setInterval(() => void refreshStatus(), 30_000)
    return () => {
      off?.()
      window.clearInterval(timer)
    }
  }, [options.active, refreshStatus, refresh, sameActor])

  useEffect(() => {
    if (!options.active || !status) return
    if (status.enabled && status.reachable && status.local && status.state === 'no-mailbox' && !ensureTried.current) {
      ensureTried.current = true
      void ensure()
    }
  }, [options.active, status, ensure])

  useEffect(() => {
    if (options.active && ready) void refresh()
  }, [options.active, ready, refresh])

  const open = useCallback(async (id: string | null, markSeen = true) => {
    const context = contextRef.current
    if (context.workspaceId !== options.workspaceId || !sameActor()) return
    const request = ++openRequest.current
    const current = () => contextRef.current === context && sameActor() && openRequest.current === request && openId.current === id
    openId.current = id
    if (!id) {
      setMessage(null)
      return
    }
    const a = api()
    if (!a) return
    try {
      const m = await a.get(id).then(unwrap)
      if (!current()) return
      setMessage(m)
      if (m && markSeen && !m.seen) {
        const updated = unwrap(await a.setFlags([id], { seen: true }))
        if (!current()) return
        if (updated === 0) throw new Error('Mail server did not mark the message as read')
        setMessage({ ...m, seen: true })
        setItems((list) => list.map((i) => (i.id === id ? { ...i, seen: true } : i)))
        setUnread((list) => list.filter((item) => item.id !== id))
      }
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : String(e))
    }
  }, [options.workspaceId, sameActor])

  const act = useCallback(async <T,>(fn: (a: MailLocalApi) => Promise<MailResult<T>>): Promise<T> => {
    const a = api()
    if (!a) throw new Error('Mail bridge is unavailable')
    const context = contextRef.current
    if (context.workspaceId !== options.workspaceId || !sameActor()) throw new Error('Mailbox context changed')
    const value = unwrap(await fn(a))
    if (contextRef.current !== context || !sameActor()) throw new Error('Mailbox context changed')
    void refresh()
    return value
  }, [refresh, options.workspaceId, sameActor])
  const getThread = useCallback(async (threadId: string) => {
    const a = api()
    if (!a) throw new Error('Mail bridge is unavailable')
    const context = contextRef.current
    if (context.workspaceId !== options.workspaceId || !sameActor()) throw new Error('Mailbox context changed')
    const result = unwrap(await a.getThread(threadId))
    if (contextRef.current !== context || !sameActor()) throw new Error('Mailbox context changed')
    return result
  }, [options.workspaceId, sameActor])

  return {
    available: !!api(),
    status: visibleSnapshot ? status : null, statusLoading: visibleSnapshot ? statusLoading : !!api(), folders: visibleSnapshot ? folders : [], folder, setFolder, search, setSearch,
    items: visibleSnapshot ? items : [], total: visibleSnapshot ? total : 0, unread: visibleSnapshot ? unread : [], loading,
    error: visibleSnapshot ? error : null, setError: (value: string | null) => { if (sameActor()) setError(value) },
    message: visibleSnapshot ? message : null, open, refresh, refreshStatus, ensure, act, getThread,
  }
}

export type MailController = ReturnType<typeof useMail>
