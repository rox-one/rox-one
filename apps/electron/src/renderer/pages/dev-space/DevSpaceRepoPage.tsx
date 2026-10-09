import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Play, RefreshCw } from 'lucide-react'
import type { DevSpaceArtifactSummary, DevSpaceRepositoryRecord, DevSpaceRun, DevSpaceRunProgress } from '@rox/shared/dev-space'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { ArtifactSurface } from './components/ArtifactSurface'
import { devSpaceErrorKey } from './components/errors'
import {
  DEV_SPACE_RUN_STATUS_KEYS, DEV_SPACE_STAGE_KEYS, DEV_SPACE_STATUS_KEYS, DEV_SPACE_STATUS_VARIANT, isRepositoryOutdated,
} from './components/status'
import { DEV_SPACE_SURFACES } from './components/surfaces'

const OVERVIEW_TAB = 'overview'
const REPO_TABS = [{ id: OVERVIEW_TAB, labelKey: 'devSpace.repo.tabs.overview' }, ...DEV_SPACE_SURFACES.map((surface) => ({ id: surface.id, labelKey: surface.labelKey }))]

export interface DevSpaceRepoPageProps { devSpaceRepoId?: string }

interface ArtifactListState { projectSlug: string | null; snapshotId?: string; stale: boolean; artifacts: DevSpaceArtifactSummary[] }

/** С-03 repo workspace — overview + one real artifact surface per tab (§B.3–§B.9). */
export default function DevSpaceRepoPage({ devSpaceRepoId }: DevSpaceRepoPageProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [record, setRecord] = useState<DevSpaceRepositoryRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [tab, setTab] = useState<string>(OVERVIEW_TAB)
  const [list, setList] = useState<ArtifactListState>({ projectSlug: null, stale: false, artifacts: [] })
  const [runs, setRuns] = useState<DevSpaceRun[]>([])
  const [progress, setProgress] = useState<DevSpaceRunProgress | null>(null)
  const [starting, setStarting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const recordRef = useRef<DevSpaceRepositoryRecord | null>(null)
  recordRef.current = record

  const loadRecord = useCallback(async () => {
    if (!workspaceId || !devSpaceRepoId) { setRecord(null); setLoading(false); return }
    setLoading(true); setErrorKey(null)
    try {
      const catalog = await window.electronAPI.listDevSpaceRepositories({ workspaceId })
      const repositories = catalog.repositories
      // The address is opaque: it may carry the catalog id or the project id
      // (project deep-link from the roadmap), so match either.
      setRecord(repositories.find((item) => item.id === devSpaceRepoId) ?? repositories.find((item) => item.projectId === devSpaceRepoId) ?? null)
    } catch (error) { setErrorKey(devSpaceErrorKey(error)) }
    finally { setLoading(false) }
  }, [workspaceId, devSpaceRepoId])

  const loadArtifacts = useCallback(async (current: DevSpaceRepositoryRecord) => {
    try {
      const result = await window.electronAPI.listDevSpaceArtifacts({ workspaceId: current.workspaceId, repositoryId: current.id })
      setList({ projectSlug: result.projectSlug, snapshotId: result.snapshotId, stale: result.stale, artifacts: [...result.artifacts] })
    } catch (error) { setErrorKey(devSpaceErrorKey(error)) }
  }, [])

  const loadRuns = useCallback(async (current: DevSpaceRepositoryRecord) => {
    try {
      const result = await window.electronAPI.listDevSpaceRuns({ workspaceId: current.workspaceId, projectSlug: current.projectSlug })
      setRuns(result.runs.filter((item) => item.repositoryId === current.repositoryId))
    } catch (error) { setErrorKey(devSpaceErrorKey(error)) }
  }, [])

  useEffect(() => { void loadRecord() }, [loadRecord])

  useEffect(() => {
    if (!record) { setList({ projectSlug: null, stale: false, artifacts: [] }); setRuns([]); return }
    void loadArtifacts(record)
    void loadRuns(record)
  }, [record, loadArtifacts, loadRuns])

  useEffect(() => {
    if (!workspaceId) return
    const offRun = window.electronAPI.onDevSpaceRunProgress((update) => {
      const current = recordRef.current
      if (!current || update.repositoryId !== current.repositoryId) return
      setProgress(update)
      // The run journal is the only completion signal (startRun emits progress, not CHANGED).
      if (update.done >= update.total) {
        setAnalyzing(false)
        void loadArtifacts(current); void loadRuns(current)
      }
    })
    const offChanged = window.electronAPI.onDevSpaceChanged((change) => {
      const current = recordRef.current
      if (!current || change.repositoryId !== current.repositoryId) return
      // A new record identity re-runs the loader effect, so no explicit refetch here.
      setRecord((previous) => (previous && previous.repositoryId === change.repositoryId ? { ...previous, status: change.status } : previous))
    })
    return () => { offRun(); offChanged() }
  }, [workspaceId, loadArtifacts, loadRuns])

  const startAnalysis = useCallback(async () => {
    const current = recordRef.current
    if (!workspaceId || !current) return
    setStarting(true); setErrorKey(null)
    try {
      // startRun returns the queued (or reused) journal record; progress arrives on runProgress.
      const started = await window.electronAPI.startDevSpaceRun({ workspaceId, repositoryId: current.id })
      setProgress({ repositoryId: started.repositoryId, runId: started.id, stage: started.progress.stage, done: started.progress.done, total: started.progress.total })
      if (started.status === 'queued' || started.status === 'running') {
        setAnalyzing(true)
      } else {
        // A cached terminal run (idempotent hit) has nothing left to stream.
        setAnalyzing(false)
        await loadArtifacts(current)
      }
      await loadRuns(current)
    } catch (error) { setAnalyzing(false); setErrorKey(devSpaceErrorKey(error)) }
    finally { setStarting(false) }
  }, [workspaceId, loadArtifacts, loadRuns])

  const refresh = async () => {
    if (!workspaceId || !record) return
    const input = { workspaceId, repositoryId: record.id, requestId: crypto.randomUUID() }
    try {
      const next = await window.electronAPI.refreshDevSpaceRepository(input)
      // A new record identity re-runs the loader effect (artifacts + runs).
      setRecord(next)
    } catch (error) { setErrorKey(devSpaceErrorKey(error)) }
  }

  const running = starting || analyzing
  const outdated = record ? isRepositoryOutdated(record) : false
  const countsByKind = useMemo(() => {
    const counts = new Map<string, number>()
    for (const artifact of list.artifacts) counts.set(artifact.kind, (counts.get(artifact.kind) ?? 0) + 1)
    return counts
  }, [list.artifacts])

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="dev-space-repo">
      <PanelHeader
        title={record?.displayName ?? t('devSpace.repo.title')}
        badge={outdated ? <Badge variant="outline" data-testid="dev-space-outdated">{t('devSpace.repository.outdated')}</Badge> : undefined}
        actions={record ? <Button type="button" size="sm" variant="outline" data-testid="dev-space-repo-refresh" onClick={() => void refresh()}><RefreshCw className="icon-caption" aria-hidden />{t('devSpace.repository.refresh')}</Button> : undefined}
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {loading ? (
          <div className="space-y-3" aria-busy="true" data-testid="dev-space-repo-loading">
            <div className="h-8 w-64 animate-pulse rounded-md bg-surface-hover motion-reduce:animate-none" />
            <div className="h-40 animate-pulse rounded-[var(--radius-card)] border border-border-subtle bg-surface-hover motion-reduce:animate-none" />
          </div>
        ) : errorKey && !record ? (
          <div className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm text-destructive">{t(errorKey)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadRecord()}>{t('devSpace.home.retry')}</Button>
          </div>
        ) : !record ? (
          <p className="text-sm text-muted-foreground" data-testid="dev-space-repo-not-found">{t('devSpace.repo.notFound')}</p>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto flex-wrap">
              {REPO_TABS.map((item) => <TabsTrigger key={item.id} value={item.id} data-testid={`dev-space-tab-${item.id}`}>{t(item.labelKey)}</TabsTrigger>)}
            </TabsList>

            <TabsContent value={OVERVIEW_TAB}>
              <section className="space-y-4 rounded-[var(--radius-card)] border border-border-subtle p-5" data-testid="dev-space-surface-overview" aria-labelledby="dev-space-overview-title">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="dev-space-overview-title" className="text-sm font-semibold">{t('devSpace.repo.tabs.overview')}</h2>
                  <div className="flex items-center gap-2">
                    <Badge variant={DEV_SPACE_STATUS_VARIANT[record.status]}>{t(DEV_SPACE_STATUS_KEYS[record.status])}</Badge>
                    <Button type="button" size="sm" disabled={running} onClick={() => void startAnalysis()} data-testid="dev-space-run">
                      {running ? <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden /> : <Play className="icon-caption" aria-hidden />}
                      {running ? t('devSpace.repo.running') : list.artifacts.length > 0 ? t('devSpace.repo.runAgain') : t('devSpace.repo.run')}
                    </Button>
                  </div>
                </div>

                {running && progress ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite" data-testid="dev-space-run-progress">
                    <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden />
                    {t('devSpace.repo.runProgress', { stage: t(DEV_SPACE_STAGE_KEYS[progress.stage]), done: progress.done, total: progress.total })}
                  </p>
                ) : null}
                {errorKey ? <p className="text-sm text-destructive" role="alert">{t(errorKey)}</p> : null}
                {list.snapshotId ? <p className="text-xs text-muted-foreground" data-testid="dev-space-snapshot">{t('devSpace.artifact.snapshot', { sha: list.snapshotId.slice(-12) })}</p> : null}

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('devSpace.repo.overview.artifacts')}</h3>
                  <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
                    {DEV_SPACE_SURFACES.map((surface) => {
                      const count = countsByKind.get(surface.kind) ?? 0
                      return (
                        <li key={surface.id} className="min-w-0">
                          <button type="button" onClick={() => setTab(surface.id)} data-testid={`dev-space-overview-card-${surface.id}`}
                            className="flex w-full flex-col items-start gap-2 rounded-[var(--radius-card)] border border-border-subtle p-3 text-left transition-colors duration-[var(--motion-fast)] hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none">
                            <span className="text-sm font-medium">{t(surface.labelKey)}</span>
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant={count > 0 && !list.stale ? 'default' : 'outline'}>{count > 0 ? (list.stale ? t('devSpace.repository.outdated') : t('devSpace.artifact.ready')) : t('devSpace.artifact.absent')}</Badge>
                              <span className="tabular-nums">{t('devSpace.artifact.count', { count })}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('devSpace.repo.runs.title')}</h3>
                  {runs.length === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="dev-space-runs-empty">{t('devSpace.repo.runs.empty')}</p>
                  ) : (
                    <ul className="list-none space-y-1 p-0 text-xs" data-testid="dev-space-runs">
                      {runs.map((item) => (
                        <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle px-3 py-1.5">
                          <Badge variant="secondary">{t(DEV_SPACE_RUN_STATUS_KEYS[item.status])}</Badge>
                          <span className="text-muted-foreground">{t(DEV_SPACE_STAGE_KEYS[item.progress.stage])}</span>
                          <span className="tabular-nums">{item.progress.done}/{item.progress.total}</span>
                          <span className="ml-auto font-mono text-muted-foreground">{new Date(item.startedAt).toISOString().slice(0, 16).replace('T', ' ')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </TabsContent>

            {DEV_SPACE_SURFACES.map((surface) => (
              <TabsContent key={surface.id} value={surface.id}>
                <ArtifactSurface
                  workspaceId={record.workspaceId}
                  projectSlug={list.projectSlug}
                  kind={surface.kind}
                  headingKey={surface.labelKey}
                  entries={list.artifacts.filter((artifact) => artifact.kind === surface.kind)}
                  stale={list.stale}
                  running={running}
                  onRun={() => void startAnalysis()}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  )
}