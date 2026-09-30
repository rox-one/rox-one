import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { FolderKanban, Lock } from 'lucide-react'
import { projectCatalogAtom } from '@/atoms/projects'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useRegisterModal } from '@/context/ModalContext'
import {
  createSharedProjectIntent,
  PROJECT_AUTHORITY_NAME_MAX_LENGTH, SHARED_PROJECT_PAGE_LIMIT, projectAuthorityErrorMessageKey,
  requireSharedProject,
  requireSharedProjectPage,
  requireSharedProjectResult,
  safeProjectAuthorityCode,
  type ProjectAuthorityState,
} from '../../../shared/project-authority'
import type { SharedProject } from '../../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'

import type { ProjectCreateIntentView, ProjectCreateAttempt } from '../../../shared/project-create-intent'

/** Additional projection within the existing projects catalog; local folder entries are retained. */
export function SharedProjectsSection({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useAtom(projectCatalogAtom)
  const [verifiedWorkspace, setVerifiedWorkspace] = useState<string | null>(null)
  const requestGeneration = useRef(0)
  const scopeGeneration = useRef(0)
  const [readError, setReadError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | undefined>()
  const [authorityWorkspaceName, setAuthorityWorkspaceName] = useState<string | null>(null)
  const [authorityWorkspaceId, setAuthorityWorkspaceId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'members'>('private')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingIntent, setPendingIntent] = useState<ProjectCreateIntentView>({ state: 'none', eligible: false })
  const closeCreate = useCallback(() => {
    if (creating) return
    setCreateOpen(false); setNewName(''); setCreateError(null)
  }, [creating])
  useRegisterModal(createOpen, closeCreate)

  const refresh = useCallback(async (nextCursor?: string) => {
    const generation = ++requestGeneration.current
    setVerifiedWorkspace(null)
    setReadError(null)
    setCatalog(previous => ({ ...previous, sharedWorkspaceId: workspaceId, shared: [], sharedState: 'connecting' }))
    try {
      const [state, configuration, intent] = await Promise.all([window.electronAPI.getProjectAuthorityState(),
        window.electronAPI.getProjectAuthorityConfiguration(workspaceId), window.electronAPI.getSharedProjectCreateIntent(workspaceId)])
      if (generation !== requestGeneration.current) return
      setPendingIntent(intent)
      if (intent.state === 'blocked' || !intent.eligible) { setCreateOpen(false); setNewName('') }
      setAuthorityWorkspaceName(configuration?.workspaceName ?? null)
      setAuthorityWorkspaceId(configuration?.workspaceId ?? null)
      if (state !== 'ready') {
        setCatalog(previous => ({ ...previous, sharedWorkspaceId: workspaceId, shared: [], sharedState: state }))
        setCursor(undefined)
        setVerifiedWorkspace(workspaceId)
        return
      }
      const page = requireSharedProjectPage(await window.electronAPI.getSharedProjects(workspaceId,
        { limit: SHARED_PROJECT_PAGE_LIMIT, ...(nextCursor ? { cursor: nextCursor } : {}) }))
      if (generation !== requestGeneration.current) return
      setCatalog(previous => ({ ...previous, sharedWorkspaceId: workspaceId,
        shared: page.items.map(project => ({ kind: 'shared' as const, localWorkspaceId: workspaceId, project })), sharedState: 'ready' }))
      setCursor(page.nextCursor)
      setVerifiedWorkspace(workspaceId)
    } catch (error) {
      if (generation !== requestGeneration.current) return
      const code = safeProjectAuthorityCode(error)
      setReadError(code)
      setCatalog(previous => ({ ...previous, sharedWorkspaceId: workspaceId, shared: [],
        sharedState: ['PROVIDER_UNAVAILABLE', 'CAPABILITY_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(code) ? 'unavailable' : 'denied' }))
      setCursor(undefined)
      setVerifiedWorkspace(workspaceId)
    }
  }, [workspaceId, setCatalog])

  useEffect(() => {
    ++scopeGeneration.current
    void refresh()
    setPendingIntent({ state: 'none', eligible: false }); setCreateOpen(false); setCreateError(null); setNewName(''); setCreating(false)
    const unsubscribe = window.electronAPI.onProjectAuthorityChanged(() => {
      ++scopeGeneration.current
      // A transport outage preserves the local draft; main independently hides a foreign/quiesced durable intent.
      setCreateError(null); setCreating(false)
      void refresh()
    })
    return () => { ++requestGeneration.current; ++scopeGeneration.current; unsubscribe() }
  }, [refresh])

  const state = catalog.sharedWorkspaceId === workspaceId && verifiedWorkspace === workspaceId ? catalog.sharedState : 'connecting'
  const entries = state === 'ready' ? catalog.shared : []
  const canCreate = pendingIntent.state === 'none' && pendingIntent.eligible && !!authorityWorkspaceName
    && state !== 'denied' && state !== 'unconfigured'
  const acceptAttempt = async (attempt: ProjectCreateAttempt, generation: number, commandId?: string) => {
    if (generation !== scopeGeneration.current) return
    if (attempt.state !== 'applied') { setPendingIntent(attempt); setCreateError(attempt.state === 'blocked' ? attempt.code : null); return }
    const result = requireSharedProjectResult(attempt.result, commandId ?? attempt.result.commandId)
    if (result.data.entity.workspaceId !== authorityWorkspaceId) throw new Error('Unexpected canonical project scope')
    setPendingIntent({ state: 'none', eligible: true }); setCreateOpen(false); setNewName('')
    await refresh()
    if (generation === scopeGeneration.current) navigate(routes.view.projects(result.entity.entityId))
  }
  const retryCreate = async () => {
    if (creating || (pendingIntent.state !== 'queued' && pendingIntent.state !== 'uncertain')) return
    const generation = scopeGeneration.current
    const commandId = pendingIntent.command.commandId
    setCreating(true); setCreateError(null)
    try { await acceptAttempt(await window.electronAPI.retrySharedProjectCreate(workspaceId), generation, commandId) }
    catch (error) { if (generation === scopeGeneration.current) setCreateError(safeProjectAuthorityCode(error)) }
    finally { if (generation === scopeGeneration.current) setCreating(false) }
  }
  const cancelQueued = async () => {
    if (creating) return
    const generation = scopeGeneration.current
    setCreating(true)
    try {
      const result = await window.electronAPI.cancelSharedProjectCreate(workspaceId)
      if (generation !== scopeGeneration.current) return
      setPendingIntent(result); setCreateError(result.state === 'blocked' ? result.code : null)
      await refresh()
    } finally { if (generation === scopeGeneration.current) setCreating(false) }
  }
  const submitCreate = async () => {
    if (!canCreate || !authorityWorkspaceName || creating || !newName.trim()) return
    const generation = scopeGeneration.current
    const intent = createSharedProjectIntent(workspaceId, authorityWorkspaceName, newName, visibility)
    setCreating(true); setCreateError(null)
    try {
      const queued = await window.electronAPI.queueSharedProjectCreate(workspaceId, intent)
      if (generation !== scopeGeneration.current) return
      setPendingIntent(queued)
      if (queued.state === 'blocked') { setCreateError(queued.code); return }
      // Persisted in main before the first outbound CREATE. Offline enqueue performs no send.
      setCreateOpen(false); setNewName('')
      if (state === 'ready') await acceptAttempt(await window.electronAPI.retrySharedProjectCreate(workspaceId), generation, intent.commandId)
    } catch (error) {
      if (generation === scopeGeneration.current) setCreateError(safeProjectAuthorityCode(error))
    } finally { if (generation === scopeGeneration.current) setCreating(false) }
  }
  return <section className="border-b border-foreground/10 px-4 py-3" data-project-authority-state={state}>
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xs font-semibold">{t('sharedProjects.heading')}</h2>
      <Button size="sm" data-testid="shared-project-create-open" disabled={!canCreate} onClick={() => setCreateOpen(true)}>{t('sharedProjects.create')}</Button>
    </div>
    <p className="mt-1 text-xs text-foreground/50">{t('sharedProjects.localBoundary')}</p>
    {state !== 'ready' && <p className="mt-2 text-sm" role="status">{t(readError ? projectAuthorityErrorMessageKey(readError) : messageKey(state))}
      {readError && <span className="mt-1 block text-xs">{readError}</span>}
    </p>}
    {(pendingIntent.state === 'queued' || pendingIntent.state === 'uncertain') && <div className="mt-2 rounded-md border border-foreground/10 p-2" role="status"
      data-testid="shared-project-queued" data-state={pendingIntent.state} data-command-id={pendingIntent.command.commandId} data-idempotency-key={pendingIntent.command.idempotencyKey}>
      <p className="text-sm">{t(pendingIntent.state === 'queued' ? 'sharedProjects.offlineQueued' : 'sharedProjects.uncertainQueued')}</p>
      <p className="mt-1 truncate text-sm">{pendingIntent.command.payload.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t('sharedProjects.singlePendingHelp')}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" data-testid="shared-project-queued-retry" disabled={creating} onClick={() => { void retryCreate() }}>{t('sharedProjects.retry')}</Button>
        <Button size="sm" variant="outline" data-testid="shared-project-queued-cancel" disabled={creating} onClick={() => { void cancelQueued() }}>{t('sharedProjects.cancelQueued')}</Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('sharedProjects.cancelQueuedHelp')}</p>
    </div>}
    {pendingIntent.state === 'blocked' && <div className="mt-2 text-sm" role="alert" data-testid="shared-project-queued-blocked" data-error-code={pendingIntent.code}>
      <p>{t('sharedProjects.queuedBlocked')}</p>
      <Button size="sm" variant="outline" data-testid="shared-project-queued-cancel" disabled={creating} onClick={() => { void cancelQueued() }}>{t('sharedProjects.cancelQueued')}</Button>
    </div>}
    {state === 'ready' && entries.length === 0 && <p className="mt-2 text-sm">{t('sharedProjects.empty')}</p>}
    {entries.map(({ project }) => <button key={project.entity.entityId} type="button" data-testid="shared-project-row" data-entity-ref={project.entity.entityId}
      className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-foreground/5"
      onClick={() => navigate(routes.view.projects(project.entity.entityId))}>
      {project.visibility === 'private' ? <Lock size={15} /> : <FolderKanban size={15} />}
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      <span className="text-xs text-foreground/50">{t(project.visibility === 'private' ? 'sharedProjects.private' : 'sharedProjects.members')}</span>
    </button>)}
    <div className="mt-2 flex gap-2">
      <Button size="sm" variant="outline" onClick={() => { void refresh() }}>{t('sharedProjects.refresh')}</Button>
      {cursor && <Button size="sm" variant="outline" onClick={() => { void refresh(cursor) }}>{t('sharedProjects.nextPage')}</Button>}
    </div>
    <Dialog open={createOpen} onOpenChange={open => { if (!open) closeCreate() }}>
      <DialogContent className="sm:max-w-md" data-testid="shared-project-create-dialog">
        <DialogHeader><DialogTitle>{t('sharedProjects.create')}</DialogTitle></DialogHeader>
        <label className="grid gap-1 text-sm" htmlFor="shared-project-name">{t('sharedProjects.name')}
          <Input id="shared-project-name" data-testid="shared-project-name" value={newName} maxLength={PROJECT_AUTHORITY_NAME_MAX_LENGTH} disabled={creating || pendingIntent.state !== 'none'}
            onChange={event => setNewName(event.target.value)} autoFocus />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="shared-project-visibility">{t('sharedProjects.visibility')}
          <select id="shared-project-visibility" data-testid="shared-project-visibility" value={visibility} disabled={creating || pendingIntent.state !== 'none'}
            className="h-9 rounded-md border border-foreground/10 bg-background px-2" onChange={event => setVisibility(event.target.value === 'members' ? 'members' : 'private')}>
            <option value="private">{t('sharedProjects.private')}</option><option value="members">{t('sharedProjects.members')}</option>
          </select>
          <span className="text-xs text-muted-foreground">{t('sharedProjects.visibilityHelp')}</span>
        </label>
        {createError && <p role="alert" data-testid="shared-project-create-error" data-error-code={createError} className="text-sm text-destructive">{t(projectAuthorityErrorMessageKey(createError))}<span className="mt-1 block text-xs">{t('sharedProjects.createError', { code: createError })}</span></p>}
        <DialogFooter>
          <Button variant="outline" disabled={creating} onClick={closeCreate}>{t('common.cancel')}</Button>
          <Button data-testid="shared-project-create-submit" disabled={creating || !newName.trim() || !canCreate} onClick={() => { void submitCreate() }}>
            {t(creating ? 'sharedProjects.creating' : state === 'ready' ? 'sharedProjects.create' : 'sharedProjects.queueOffline')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}

function messageKey(state: ProjectAuthorityState): string {
  return state === 'unconfigured' ? 'sharedProjects.unconfigured'
    : state === 'connecting' ? 'sharedProjects.connecting'
    : state === 'denied' ? 'sharedProjects.denied' : 'sharedProjects.unavailable'
}

/** Uses the existing Projects route; GET authorizes the ref again, regardless of cached list titles. */
export function SharedProjectDetails({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const [projection, setProjection] = useState<{ localWorkspaceId: string; project: SharedProject } | null>(null)
  const [state, setState] = useState<ProjectAuthorityState>('connecting')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const generation = useRef(0)
  const load = useCallback(async () => {
    const request = ++generation.current
    setProjection(null)
    setState('connecting')
    setErrorCode(null)
    if (!workspace) { setState('unconfigured'); return }
    try {
      const value = requireSharedProject(await window.electronAPI.getSharedProject(workspace.id, { entityId }))
      if (request !== generation.current) return
      if (value.entity.entityId !== entityId) throw new Error('Unexpected project ref')
      setProjection({ localWorkspaceId: workspace.id, project: value })
      setState('ready')
    } catch (error) {
      if (request === generation.current) { setProjection(null); setState('denied'); setErrorCode(safeProjectAuthorityCode(error)) }
    }
  }, [workspace?.id, entityId])
  useEffect(() => {
    void load()
    const unsubscribe = window.electronAPI.onProjectAuthorityChanged(() => { void load() })
    return () => { ++generation.current; unsubscribe() }
  }, [load])
  const project = projection?.localWorkspaceId === workspace?.id && projection?.project.entity.entityId === entityId
    ? projection.project : null
  return <div className="h-full overflow-auto p-6" data-shared-project-detail={state}>
    <h1 className="text-lg font-semibold">{project?.name ?? t('sharedProjects.heading')}</h1>
    {!project && <p className="mt-4" role="status" data-error-code={errorCode ?? undefined}>
      {errorCode ? t(projectAuthorityErrorMessageKey(errorCode)) : t(messageKey(state))}
      {errorCode && <span className="mt-1 block text-xs">{errorCode}</span>}
    </p>}
    {project && <>
      <p className="mt-2 text-sm text-foreground/60">{t(project.visibility === 'private' ? 'sharedProjects.private' : 'sharedProjects.members')}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt>{t('sharedProjects.entityRef')}</dt><dd className="break-all">{project.entity.entityId}</dd>
        <dt>{t('sharedProjects.workspace')}</dt><dd>{project.entity.workspaceId}</dd>
        <dt>{t('sharedProjects.revision')}</dt><dd>{project.revision}</dd>
      </dl>
      <p className="mt-6 text-sm text-foreground/60">{t('sharedProjects.localFeaturesUnavailable')}</p>
    </>}
    <Button className="mt-4" variant="outline" onClick={() => { void load() }}>{t('sharedProjects.refresh')}</Button>
  </div>
}
