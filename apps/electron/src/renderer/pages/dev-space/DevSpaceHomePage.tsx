import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, Search } from 'lucide-react'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { emitDevSpaceEvent } from '@/features/dev-space/analytics'
import { AddRepositoryDialog, type AddRepositorySource } from './components/AddRepositoryDialog'
import { RepositoryCard, type CloneProgress } from './components/RepositoryCard'
import { devSpaceErrorKey } from './components/errors'

/** С-01 «Разработчикам» — catalog of connected repositories (§B.1). */
export default function DevSpaceHomePage() {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [repositories, setRepositories] = useState<DevSpaceRepositoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addErrorKey, setAddErrorKey] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<Record<string, CloneProgress>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<DevSpaceRepositoryRecord | null>(null)
  const [query, setQuery] = useState('')
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const searchRef = useRef<HTMLInputElement>(null)
  const requestIds = useRef(new Map<string, string>())
  const repositoriesRef = useRef(repositories)
  repositoriesRef.current = repositories

  const load = useCallback(async () => {
    if (!workspaceId) { setRepositories([]); setLoading(false); return }
    setLoading(true)
    setErrorKey(null)
    try {
      const catalog = await window.electronAPI.listDevSpaceRepositories({ workspaceId })
      setRepositories([...catalog.repositories])
    }
    catch (error) { setErrorKey(devSpaceErrorKey(error)) }
    finally { setLoading(false) }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!workspaceId) return
    const offProgress = window.electronAPI.onDevSpaceCloneProgress((update) => {
      setProgress((previous) => ({ ...previous, [update.repositoryId]: { phase: update.phase, receivedBytes: update.receivedBytes, totalBytes: update.totalBytes } }))
    })
    const offChanged = window.electronAPI.onDevSpaceChanged((update) => {
      const previous = repositoriesRef.current.find((record) => record.id === update.repositoryId)
      setRepositories((list) => list.map((record) => record.id === update.repositoryId ? { ...record, status: update.status } : record))
      if (previous?.status === 'cloning' && update.status !== 'cloning') {
        emitDevSpaceEvent({ eventName: 'devspace.clone-finished', ok: update.status !== 'error' })
        setProgress((current) => { const next = { ...current }; delete next[update.repositoryId]; return next })
      }
    })
    return () => { offProgress(); offChanged() }
  }, [workspaceId])

  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) }
  }, [])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return repositories
    return repositories.filter((record) => record.displayName.toLowerCase().includes(needle) || record.origin.kind === 'git-url' && record.origin.url.toLowerCase().includes(needle))
  }, [repositories, query])

  const replaceRecord = (next: DevSpaceRepositoryRecord) => setRepositories((list) => list.map((record) => record.id === next.id ? next : record))

  const addRepository = async (source: AddRepositorySource) => {
    if (!workspaceId) return
    setSubmitting(true)
    setAddErrorKey(null)
    try {
      const addInput = { workspaceId, source }
      const record = await window.electronAPI.addDevSpaceRepository(addInput)
      emitDevSpaceEvent({ eventName: 'devspace.repo-added', sourceKind: source.kind })
      setRepositories((list) => [record, ...list.filter((item) => item.id !== record.id)])
      setAddOpen(false)
      if (source.kind === 'git-url') {
        const requestId = crypto.randomUUID()
        requestIds.current.set(record.id, requestId)
        const cloneInput = { workspaceId, repositoryId: record.id, requestId }
        try { replaceRecord(await window.electronAPI.startDevSpaceClone(cloneInput)) }
        catch (error) {
          emitDevSpaceEvent({ eventName: 'devspace.clone-finished', ok: false })
          replaceRecord({ ...record, status: 'error' })
          setErrorKey(devSpaceErrorKey(error))
        }
      }
    } catch (error) { setAddErrorKey(devSpaceErrorKey(error)) }
    finally { setSubmitting(false) }
  }

  const refresh = async (record: DevSpaceRepositoryRecord) => {
    if (!workspaceId) return
    setBusyId(record.id)
    const refreshInput = { workspaceId, repositoryId: record.id, requestId: crypto.randomUUID() }
    try { replaceRecord(await window.electronAPI.refreshDevSpaceRepository(refreshInput)) }
    catch (error) { setErrorKey(devSpaceErrorKey(error)) }
    finally { setBusyId(null) }
  }

  const cancel = async (record: DevSpaceRepositoryRecord) => {
    const requestId = requestIds.current.get(record.id)
    if (!workspaceId || !requestId) return
    const cancelInput = { workspaceId, requestId }
    try { await window.electronAPI.cancelDevSpaceRequest(cancelInput); requestIds.current.delete(record.id) }
    catch (error) { setErrorKey(devSpaceErrorKey(error)) }
  }

  const confirmRemove = async () => {
    const record = pendingRemove
    if (!workspaceId || !record) return
    setBusyId(record.id)
    try {
      const removeInput = { workspaceId, repositoryId: record.id, confirm: true }
      const removed = await window.electronAPI.removeDevSpaceRepository(removeInput)
      if (removed) setRepositories((list) => list.filter((item) => item.id !== record.id))
      setPendingRemove(null)
    } catch (error) { setErrorKey(devSpaceErrorKey(error)) }
    finally { setBusyId(null) }
  }

  const connect = () => { setAddErrorKey(null); setAddOpen(true) }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="dev-space-home">
      <PanelHeader
        title={t('devSpace.home.title')}
        actions={<Button type="button" size="sm" data-testid="dev-space-connect" onClick={connect}><Plus className="icon-caption" aria-hidden />{t('devSpace.home.connect')}</Button>}
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t('devSpace.home.subtitle')}</p>
        {offline ? <p className="mb-4 text-xs text-muted-foreground" role="status" data-testid="dev-space-offline">{t('devSpace.home.offlineNotice')}</p> : null}

        {!workspaceId ? (
          <p className="text-sm text-muted-foreground">{t('devSpace.home.noWorkspace')}</p>
        ) : loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" data-testid="dev-space-loading">
            {[0, 1, 2].map((index) => <div key={index} className="h-32 animate-pulse rounded-[var(--radius-card)] border border-border-subtle bg-surface-hover motion-reduce:animate-none" />)}
          </div>
        ) : errorKey ? (
          <div className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm text-destructive">{t(errorKey)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>{t('devSpace.home.retry')}</Button>
          </div>
        ) : repositories.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Plus aria-hidden /></EmptyMedia>
              <EmptyTitle>{t('devSpace.home.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('devSpace.home.emptyDescription')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" data-testid="dev-space-empty-connect" onClick={connect}><Plus className="icon-caption" aria-hidden />{t('devSpace.home.emptyAction')}</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="space-y-4">
            <label className="flex max-w-sm items-center gap-2 rounded-md border border-border-subtle px-2 py-1.5 text-xs focus-within:ring-1 focus-within:ring-ring">
              <Search className="icon-caption text-muted-foreground" aria-hidden />
              <Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('devSpace.home.searchPlaceholder')} className="h-6 border-0 bg-transparent p-0 text-xs focus-visible:ring-0" />
            </label>
            <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((record) => (
                <li key={record.id} className="min-w-0">
                  <RepositoryCard
                    record={record}
                    progress={progress[record.id]}
                    busy={busyId === record.id}
                    onOpen={(item) => navigate(routes.view.developers(item.id))}
                    onRefresh={(item) => void refresh(item)}
                    onRemove={(item) => setPendingRemove(item)}
                    onCancel={(item) => void cancel(item)}
                  />
                </li>
              ))}
            </ul>
            {visible.length === 0 ? <p className="text-sm text-muted-foreground">{t('devSpace.home.noMatches')}</p> : null}
          </div>
        )}

        {submitting ? <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden />{t('devSpace.progress.working')}</div> : null}
      </div>

      <AddRepositoryDialog open={addOpen} onOpenChange={setAddOpen} submitting={submitting} errorKey={addErrorKey} offline={offline} onSubmit={(source) => void addRepository(source)} />

      <Dialog open={pendingRemove !== null} onOpenChange={(open) => { if (!open) setPendingRemove(null) }}>
        <DialogContent data-testid="dev-space-remove-dialog">
          <DialogHeader>
            <DialogTitle>{t('devSpace.remove.title')}</DialogTitle>
            <DialogDescription>{t('devSpace.remove.description', { name: pendingRemove?.displayName ?? '' })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingRemove(null)}>{t('devSpace.remove.cancel')}</Button>
            <Button type="button" variant="destructive" data-testid="dev-space-remove-confirm" disabled={busyId !== null} onClick={() => void confirmRemove()}>{t('devSpace.remove.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}