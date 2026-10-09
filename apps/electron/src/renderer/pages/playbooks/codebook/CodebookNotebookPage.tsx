/**
 * С-15 «Кодбук» (docs/specs/2026-10-09-dev-space-and-playbooks 04-UI-SPEC B.15,
 * D12, В5). A codebook notebook is an ordered cell pipeline over a repo project:
 * script cells (executable + args, never a shell string), agent cells (repo-bound
 * prompt) and artifact cells (a В2 artifact id). The run is a long host job — the
 * RPC returns `{ jobId, runId }` immediately and every step transition arrives on
 * the `playbooks:codebookJob` push, which this page folds by monotonic `seq`.
 *
 * Surfaces reused (not duplicated): the notebook record/store from В4, the
 * `saveTextFile` export precedent from С-14, and the optional В2 artifact reader
 * for step results. Gated by `playbooks.v1` + `playbooks.codebook.v1` upstream.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Ban, Download, FilePlus2, Loader2, Play, Plus } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { createCodebookCell, type PlaybookNotebook } from '../notebook-store'
import {
  cancelCodebook,
  exportCodebookNotebook,
  listCodebookRuns,
  onCodebookJob,
  runCodebook,
  type CodebookCell,
  type CodebookCellKind,
  type CodebookJob,
  type CodebookRun,
} from './codebook-client'
import { CellEditor } from './components/CellEditor'

export interface CodebookNotebookProps {
  notebook: PlaybookNotebook
  onBack: () => void
  onUpdate: (patch: Partial<Pick<PlaybookNotebook, 'name' | 'cells' | 'note' | 'projectSlug'>>) => void
}

const ALL_KINDS: readonly CodebookCellKind[] = ['script', 'agent', 'artifact']

export default function CodebookNotebookPage({ notebook, onBack, onUpdate }: CodebookNotebookProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const cells = useMemo(() => notebook.cells ?? [], [notebook.cells])
  const projectSlug = notebook.projectSlug

  const [job, setJob] = useState<CodebookJob | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [runs, setRuns] = useState<CodebookRun[]>([])
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const jobIdRef = useRef<string | null>(null)

  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Fold the push stream by `seq` (the only ordering authority); a late event never rewinds.
  useEffect(() => {
    let dispose: (() => void) | null = null
    try {
      dispose = onCodebookJob((next) => {
        if (jobIdRef.current && next.id !== jobIdRef.current) return
        setJob((current) => (current && current.id === next.id && current.seq >= next.seq ? current : next))
      })
    } catch {
      /* bridge unavailable — surfaced on start */
    }
    return () => dispose?.()
  }, [])

  const refreshRuns = useCallback(async () => {
    if (!workspaceId) return
    try {
      const result = await listCodebookRuns({ workspaceId, ...(projectSlug ? { projectSlug } : {}) })
      setRuns(result.runs)
    } catch {
      /* the journal is supplementary; the run surface stays usable */
    }
  }, [workspaceId, projectSlug])

  useEffect(() => {
    if (job?.state === 'done' || job?.state === 'failed' || job?.state === 'cancelled') void refreshRuns()
  }, [job?.state, refreshRuns])

  const persistCells = useCallback((next: readonly CodebookCell[]) => onUpdate({ cells: next }), [onUpdate])

  const addCell = useCallback((kind: CodebookCellKind) => persistCells([...cells, createCodebookCell(kind)]), [cells, persistCells])

  const useTemplate = useCallback(
    () => persistCells(ALL_KINDS.map((kind) => ({ ...createCodebookCell(kind), title: t(`playbooks.codebook.kind.${kind}`) }))),
    [persistCells, t],
  )

  const updateCell = useCallback(
    (id: string, patch: Partial<CodebookCell>) => persistCells(cells.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell))),
    [cells, persistCells],
  )

  const removeCell = useCallback((id: string) => persistCells(cells.filter((cell) => cell.id !== id)), [cells, persistCells])

  const moveCell = useCallback(
    (id: string, direction: -1 | 1) => {
      const index = cells.findIndex((cell) => cell.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= cells.length) return
      const next = [...cells]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      persistCells(next)
    },
    [cells, persistCells],
  )

  const start = useCallback(
    async (cellIds?: readonly string[]) => {
      if (!workspaceId || cells.length === 0) return
      setStarting(true)
      setStartError(null)
      try {
        const { jobId, runId } = await runCodebook({
          workspaceId,
          notebookId: notebook.id,
          ...(projectSlug ? { projectSlug } : {}),
          title: notebook.name,
          cells,
          ...(cellIds ? { cellIds } : {}),
        })
        jobIdRef.current = jobId
        setJob((current) => (current && current.id === jobId
          ? current
          : {
              schemaVersion: 1,
              id: jobId,
              notebookId: notebook.id,
              runId,
              projectSlug: projectSlug ?? '',
              state: 'queued',
              seq: 0,
              cellIndex: 0,
              totalCells: cellIds?.length ?? cells.length,
              doneSteps: 0,
              steps: [],
            }))
      } catch (err) {
        setStartError(err instanceof Error ? err.message : String(err))
      } finally {
        setStarting(false)
      }
    },
    [workspaceId, cells, notebook.id, notebook.name, projectSlug],
  )

  const cancel = useCallback(async () => {
    if (!workspaceId || !job) return
    try {
      await cancelCodebook({ workspaceId, jobId: job.id, notebookId: notebook.id })
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err))
    }
  }, [workspaceId, job, notebook.id])

  const exportNotebook = useCallback(
    async (format: 'json' | 'md') => {
      setExportError(null)
      try {
        await exportCodebookNotebook({ notebook, job, format, defaultPath: `${notebook.name}.${format}` })
      } catch (err) {
        setExportError(err instanceof Error ? err.message : String(err))
      }
    },
    [notebook, job],
  )

  const running = job !== null && job.state !== 'done' && job.state !== 'failed' && job.state !== 'cancelled'
  const resultsByCell = useMemo(() => new Map((job?.steps ?? []).map((step) => [step.cellId, step] as const)), [job])
  const artifacts = useMemo(() => (job?.steps ?? []).filter((step) => step.output?.artifactId), [job])

  const focusRelativeCell = (from: HTMLElement, direction: -1 | 1) => {
    const list = from.closest('[data-testid="playbooks-codebook-cells"]')
    if (!list) return
    const items = Array.from(list.querySelectorAll<HTMLElement>('[data-codebook-cell]'))
    const current = Number(from.closest<HTMLElement>('[data-codebook-cell]')?.dataset.codebookCell ?? '-1')
    const next = items.find((item) => Number(item.dataset.codebookCell) === current + direction)
    next?.focus()
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="playbooks-codebook"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          onUpdate({ cells })
          setSavedAt(Date.now())
        }
      }}
    >
      <PanelHeader
        title={notebook.name}
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onBack} data-testid="playbooks-codebook-back">
              <ArrowLeft className="icon-caption" aria-hidden />
              {t('playbooks.codebook.back')}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={cells.length === 0} onClick={() => void exportNotebook('json')} data-testid="playbooks-codebook-export-json">
              <Download className="icon-caption" aria-hidden />
              {t('playbooks.codebook.exportJson')}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={cells.length === 0} onClick={() => void exportNotebook('md')} data-testid="playbooks-codebook-export-md">
              <Download className="icon-caption" aria-hidden />
              {t('playbooks.codebook.exportMarkdown')}
            </Button>
            {running ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void cancel()} data-testid="playbooks-codebook-stop">
                <Ban className="icon-caption" aria-hidden />
                {t('playbooks.codebook.stop')}
              </Button>
            ) : (
              <Button type="button" size="sm" disabled={cells.length === 0 || starting} onClick={() => void start()} data-testid="playbooks-codebook-run-all">
                {starting ? <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden /> : <Play className="icon-caption" aria-hidden />}
                {t('playbooks.codebook.runAll')}
              </Button>
            )}
          </div>
        }
      />

      {offline ? (
        <p className="border-b border-border-subtle px-5 py-2 text-xs text-muted-foreground" role="status" data-testid="playbooks-codebook-offline">
          {t('playbooks.codebook.offline')}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
        <section className="min-h-0 overflow-auto border-b border-border-subtle p-5 lg:border-b-0 lg:border-r" data-testid="playbooks-codebook-editor">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t('playbooks.codebook.cellsTitle')}</h2>
            <div className="flex items-center gap-2">
              {ALL_KINDS.map((kind) => (
                <Button key={kind} type="button" variant="outline" size="sm" disabled={running} onClick={() => addCell(kind)} data-testid={`playbooks-codebook-add-${kind}`}>
                  <Plus className="icon-caption" aria-hidden />
                  {t(`playbooks.codebook.kind.${kind}`)}
                </Button>
              ))}
            </div>
          </div>

          {job ? (
            <div className="mb-3 rounded-[var(--radius-card)] border border-border-subtle p-3" aria-live="polite" data-testid="playbooks-codebook-progress">
              <div className="mb-2 flex items-center gap-2 text-xs">
                {running ? <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden /> : <Play className="icon-caption" aria-hidden />}
                <span className="font-medium">{t(`playbooks.codebook.jobState.${job.state}`)}</span>
                <span className="tabular-nums text-muted-foreground" data-testid="playbooks-codebook-progress-count">
                  {t('playbooks.codebook.progress', { done: job.doneSteps, total: job.totalCells })}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-surface-pressed"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={Math.max(1, job.totalCells)}
                aria-valuenow={job.doneSteps}
                data-testid="playbooks-codebook-progressbar"
              >
                <div
                  className="h-full bg-accent transition-[width] duration-[var(--motion-base)] motion-reduce:transition-none"
                  style={{ width: `${Math.round((job.doneSteps / Math.max(1, job.totalCells)) * 100)}%` }}
                />
              </div>
              {job.error ? (
                <p className="mt-2 text-xs text-destructive" role="alert" data-testid="playbooks-codebook-job-error">
                  {t('playbooks.codebook.errorCode', { code: job.error.code })}
                </p>
              ) : null}
            </div>
          ) : null}

          {startError ? <p className="mb-3 text-xs text-destructive" role="alert" data-testid="playbooks-codebook-start-error">{t('playbooks.codebook.startFailed', { error: startError })}</p> : null}
          {exportError ? <p className="mb-3 text-xs text-destructive" role="alert" data-testid="playbooks-codebook-export-error">{t('playbooks.codebook.exportFailed', { error: exportError })}</p> : null}

          {cells.length === 0 ? (
            <Empty data-testid="playbooks-codebook-empty">
              <EmptyHeader>
                <EmptyMedia variant="icon"><FilePlus2 aria-hidden /></EmptyMedia>
                <EmptyTitle>{t('playbooks.codebook.emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('playbooks.codebook.emptyDescription')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" onClick={() => addCell('script')} data-testid="playbooks-codebook-empty-add">
                  <Plus className="icon-caption" aria-hidden />
                  {t('playbooks.codebook.emptyAction')}
                </Button>
                <Button type="button" variant="outline" onClick={useTemplate} data-testid="playbooks-codebook-template">
                  {t('playbooks.codebook.templateAction')}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ol
              className="space-y-3 p-0"
              data-testid="playbooks-codebook-cells"
              onKeyDown={(event) => {
                if (event.target instanceof HTMLTextAreaElement) return
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                const target = event.target as HTMLElement
                if (!target.closest('[data-codebook-cell]')) return
                event.preventDefault()
                focusRelativeCell(target, event.key === 'ArrowDown' ? 1 : -1)
              }}
            >
              {cells.map((cell, index) => {
                const result = resultsByCell.get(cell.id)
                return (
                  <CellEditor
                    key={cell.id}
                    cell={cell}
                    index={index}
                    total={cells.length}
                    {...(result ? { result } : {})}
                    workspaceId={workspaceId}
                    {...(projectSlug ? { projectSlug } : {})}
                    running={running}
                    onChange={(patch) => updateCell(cell.id, patch)}
                    onMove={(direction) => moveCell(cell.id, direction)}
                    onRemove={() => removeCell(cell.id)}
                    onRun={() => void start([cell.id])}
                  />
                )
              })}
            </ol>
          )}

          <p className="mt-4 text-caption text-muted-foreground">
            {t('playbooks.codebook.runHint')}
            {' · '}
            {t('playbooks.codebook.saveHint')}
          </p>
        </section>

        <aside className="min-h-0 overflow-auto p-4" data-testid="playbooks-codebook-context" tabIndex={-1}>
          <h2 className="mb-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">{t('playbooks.codebook.contextTitle')}</h2>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="codebook-project">{t('playbooks.codebook.projectLabel')}</label>
          <Input
            id="codebook-project"
            value={projectSlug ?? ''}
            onChange={(event) => onUpdate({ projectSlug: event.target.value })}
            placeholder={t('playbooks.codebook.projectPlaceholder')}
            className="h-8 text-xs"
            data-testid="playbooks-codebook-project"
          />
          <p className="mt-1 text-caption text-muted-foreground">{t('playbooks.codebook.projectHint')}</p>

          <h3 className="mt-4 text-caption font-medium uppercase tracking-wide text-muted-foreground">{t('playbooks.codebook.artifactsTitle')}</h3>
          {artifacts.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="playbooks-codebook-no-artifacts">{t('playbooks.codebook.noArtifacts')}</p>
          ) : (
            <ul className="mt-1 list-none space-y-1 p-0" data-testid="playbooks-codebook-artifacts">
              {artifacts.map((step) => (
                <li key={step.cellId} className="truncate font-mono text-caption text-muted-foreground">{step.output?.artifactId}</li>
              ))}
            </ul>
          )}

          <h3 className="mt-4 text-caption font-medium uppercase tracking-wide text-muted-foreground">{t('playbooks.codebook.runsTitle')}</h3>
          {runs.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="playbooks-codebook-no-runs">{t('playbooks.codebook.noRuns')}</p>
          ) : (
            <ul className="mt-1 list-none space-y-1 p-0" data-testid="playbooks-codebook-runs">
              {runs.slice(0, 5).map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
                  <span className="truncate">{run.title ?? run.id}</span>
                  <span className="tabular-nums">{t(`playbooks.codebook.runStatus.${run.status}`)}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-caption text-muted-foreground" role="status" aria-live="polite">
            {savedAt ? t('playbooks.codebook.saved') : ''}
          </p>
        </aside>
      </div>
    </div>
  )
}