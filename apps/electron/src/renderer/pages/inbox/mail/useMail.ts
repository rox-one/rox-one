/**
 * Renderer state for Rox Mail (inbox.mail.v1): status, folders, the current
 * list, the open message and «Все» unread rows. Talks to the main-process
 * bridge only through window.electronAPI.mailLocal; refreshes on JMAP push
 * (main → mail:changed). Creates the user's mailbox automatically on the
 * first Входящие open when the local server is reachable.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MailFolder, MailFolderRole, MailLocalApi, MailMessage, MailResult, MailStatus, MailSummary } from '../../../../shared/mail-local'

function api(): MailLocalApi | null {
  return (typeof window !== 'undefined' ? (window.electronAPI as { mailLocal?: MailLocalApi } | undefined)?.mailLocal : undefined) ?? null
}

export function unwrap<T>(r: MailResult<T>): T {
  if (!r.ok) throw Object.assign(new Error(r.message), { code: r.code })
  return r.value
}

let autoEnsureTried = false

export interface MailSelection {
  folderId: string | null
  role: MailFolderRole | null
}

export function useMail(options: { active: boolean }) {
  const [status, setStatus] = useState<MailStatus | null>(null)
  const [folders, setFolders] = useState<MailFolder[]>([])
  const [folder, setFolder] = useState<MailSelection>({ folderId: null, role: 'inbox' })
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<MailSummary[]>([])
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState<MailSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<MailMessage | null>(null)
  const openId = useRef<string | null>(null)
  const ready = status?.state === 'ready'

  const refreshStatus = useCallback(async () => {
    const a = api()
    if (!a) return null
    const s = await a.status()
    setStatus(s)
    return s
  }, [])

  const refresh = useCallback(async () => {
    const a = api()
    if (!a || !ready) return
    setLoading(true)
    try {
      const [f, list, un] = await Promise.all([
        a.folders().then(unwrap),
        a.list({ folderId: folder.folderId ?? undefined, role: folder.folderId ? undefined : folder.role ?? 'inbox', text: search || undefined, limit: 100 }).then(unwrap),
        a.list({ role: 'inbox', unseenOnly: true, limit: 50 }).then(unwrap),
      ])
      setFolders(f)
      setItems(list.items)
      setTotal(list.total)
      setUnread(un.items)
      setError(null)
      if (openId.current) {
        const m = await a.get(openId.current).then(unwrap)
        setMessage(m)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [ready, folder.folderId, folder.role, search])

  const ensure = useCallback(async () => {
    const a = api()
    if (!a) return
    setStatus((s) => (s ? { ...s, state: 'provisioning' } : s))
    const r = await a.ensureMailbox()
    if (r.ok) setStatus(r.value)
    else setError(r.message)
  }, [])

  useEffect(() => {
    if (!options.active) return
    void refreshStatus()
    const off = api()?.onChanged((event) => {
      if (event.status) setStatus(event.status)
      else void refresh()
    })
    const timer = window.setInterval(() => void refreshStatus(), 30_000)
    return () => {
      off?.()
      window.clearInterval(timer)
    }
  }, [options.active, refreshStatus, refresh])

  useEffect(() => {
    if (!options.active || !status) return
    if (status.enabled && status.reachable && status.local && status.state === 'no-mailbox' && !autoEnsureTried) {
      autoEnsureTried = true
      void ensure()
    }
  }, [options.active, status, ensure])

  useEffect(() => {
    if (options.active && ready) void refresh()
  }, [options.active, ready, refresh])

  const open = useCallback(async (id: string | null, markSeen = true) => {
    openId.current = id
    if (!id) {
      setMessage(null)
      return
    }
    const a = api()
    if (!a) return
    try {
      const m = await a.get(id).then(unwrap)
      if (openId.current !== id) return
      setMessage(m)
      if (m && markSeen && !m.seen) {
        await a.setFlags([id], { seen: true })
        setMessage({ ...m, seen: true })
        setItems((list) => list.map((i) => (i.id === id ? { ...i, seen: true } : i)))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const act = useCallback(async <T,>(fn: (a: MailLocalApi) => Promise<MailResult<T>>): Promise<T> => {
    const a = api()
    if (!a) throw new Error('Mail bridge is unavailable')
    const value = unwrap(await fn(a))
    void refresh()
    return value
  }, [refresh])

  return {
    available: !!api(),
    status, folders, folder, setFolder, search, setSearch, items, total, unread, loading, error, setError,
    message, open, refresh, refreshStatus, ensure, act,
  }
}

export type MailController = ReturnType<typeof useMail>
