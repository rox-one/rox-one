/**
 * Память: репозиторий — shell for the git-backed memory projection.
 *
 * Data + state machine live here; the four views (Файлы / История / Сны /
 * Граф) are rendering-only panels with frozen props (contract §4). Selection
 * is persisted through the navigation state, so a file or commit survives
 * navigation, panel persistence and deep links:
 *
 *   memory | memory/repo | memory/repo/file/<enc> | memory/repo/commit/<sha>
 *
 * States (spec §8): loading / ready / empty / busy /
 * degraded-no-git / repo-in-foreign-tree / edited / bank-forbidden /
 * file-not-found / commit-not-found / exporting / dream-running / dream-failed.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, GitBranch, RefreshCw, Sparkles } from 'lucide-react'
import type {
  MemoryDreamEvent,
  MemoryDreamStatus,
  MemoryRepoBankInfo,
  MemoryRepoCommit,
  MemoryRepoCommitFile,
  MemoryRepoFile,
  MemoryRepoGraph,
  MemoryRepoStatus,
  MemoryRepoTreeNode,
} from '@rox/shared/memory/repo'
import { useNavigation, routes } from '@/contexts/NavigationContext'
import { isMemoryNavigation } from '../../../shared/types'
import { useTourTarget } from '@/features/product-tour/runtime/hooks'
import { toErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { MemoryRepoFilesPanel } from './repo/MemoryRepoFilesPanel'
import { MemoryRepoHistoryPanel } from './repo/MemoryRepoHistoryPanel'
import { MemoryRepoDreamsPanel } from './repo/MemoryRepoDreamsPanel'
import { MemoryRepoGraphPanel } from './repo/MemoryRepoGraphPanel'
import { MemoryRepoSearchOverlay } from './repo/MemoryRepoSearchOverlay'

export interface MemoryRepoScreenProps {
  workspaceId?: string
}

type MemoryRepoTab = 'files' | 'history' | 'dreams' | 'graph'

const TABS: ReadonlyArray<{ id: MemoryRepoTab; labelKey: string }> = [
  { id: 'files', labelKey: 'memory.repo.tab.files' },
  { id: 'history', labelKey: 'memory.repo.tab.history' },
  { id: 'dreams', labelKey: 'memory.repo.tab.dreams' },
  { id: 'graph', labelKey: 'memory.repo.tab.graph' },
]

/** Map a thrown RPC error to one of the two explicit denial states. */
function isForbidden(message: string): boolean {
  return /forbidden|not[_\s-]?authorized|permission|access denied/i.test(message)
}

function defaultBankId(workspaceId?: string): string {
  return workspaceId ? `ws:${workspaceId}` : 'main'
}

export function MemoryRepoScreen({ workspaceId }: MemoryRepoScreenProps) {
  const { t } = useTranslation()
  const { navigationState, navigate } = useNavigation()
  const repoTarget = useTourTarget('memory.repo', { workspaceId })

  const selectedPath = isMemoryNavigation(navigationState) && navigationState.details?.type === 'file'
    ? navigationState.details.path
    : null
  const selectedSha = isMemoryNavigation(navigationState) && navigationState.details?.type === 'commit'
    ? navigationState.details.sha
    : null

  const [tab, setTab] = React.useState<MemoryRepoTab>(() => {
    if (!isMemoryNavigation(navigationState)) return 'files'
    if (navigationState.tab === 'dream') return 'dreams'
    if (navigationState.details?.type === 'commit') return 'history'
    return 'files'
  })
  const [banks, setBanks] = React.useState<MemoryRepoBankInfo[]>([])
  const [bankId, setBankId] = React.useState<string | null>(null)
  const [bankMenuOpen, setBankMenuOpen] = React.useState(false)
  const [status, setStatus] = React.useState<MemoryRepoStatus | null>(null)
  const [tree, setTree] = React.useState<MemoryRepoTreeNode[]>([])
  const [file, setFile] = React.useState<MemoryRepoFile | null>(null)
  const [commits, setCommits] = React.useState<MemoryRepoCommit[]>([])
  const [diff, setDiff] = React.useState<MemoryRepoCommitFile[]>([])
  const [graph, setGraph] = React.useState<MemoryRepoGraph | null>(null)
  const [dreamStatus, setDreamStatus] = React.useState<MemoryDreamStatus | null>(null)
  const [dreamLog, setDreamLog] = React.useState<MemoryDreamEvent[]>([])
  const [loading, setLoading] = React.useState(true)
  const [fileLoading, setFileLoading] = React.useState(false)
  const [dreamRunning, setDreamRunning] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [dreamFailed, setDreamFailed] = React.useState(false)
  const [forbidden, setForbidden] = React.useState(false)
  const [notFound, setNotFound] = React.useState<null | 'file' | 'commit'>(null)

  const bankGeneration = React.useRef(0)
  const fileGeneration = React.useRef(0)
  const diffGeneration = React.useRef(0)
  // Whether a `start` dream event was observed since the last «Собрать сейчас»
  // click. The transport timeout (30 s) can reject `runMemoryDream` while the
  // server keeps running — the event stream, not the RPC promise, owns the run
  // state, so a rejection after `start` must not re-enable the button.
  const dreamStartSeen = React.useRef(false)
  const effectiveBankId = bankId ?? defaultBankId(workspaceId)

  const reload = React.useCallback(() => {
    const id = effectiveBankId
    const current = ++bankGeneration.current
    setLoading(true)
    setForbidden(false)
    Promise.allSettled([
      window.electronAPI.getMemoryRepoStatus(id),
      window.electronAPI.getMemoryRepoTree(id),
      window.electronAPI.listMemoryRepoCommits(id, 100),
      window.electronAPI.getMemoryDreamStatus(id),
      window.electronAPI.getMemoryDreamLog(id, 200),
      window.electronAPI.getMemoryRepoGraph(id),
    ]).then(([statusResult, treeResult, commitsResult, dreamStatusResult, logResult, graphResult]) => {
      if (current !== bankGeneration.current) return
      if (statusResult.status === 'rejected') {
        setForbidden(isForbidden(toErrorMessage(statusResult.reason)))
        setLoading(false)
        return
      }
      setStatus(statusResult.value)
      setTree(treeResult.status === 'fulfilled' ? treeResult.value : [])
      setCommits(commitsResult.status === 'fulfilled' ? commitsResult.value : [])
      setDreamStatus(dreamStatusResult.status === 'fulfilled' ? dreamStatusResult.value : null)
      setDreamLog(logResult.status === 'fulfilled' ? logResult.value : [])
      setGraph(graphResult.status === 'fulfilled' ? graphResult.value : null)
      if (dreamStatusResult.status === 'fulfilled') setDreamRunning(dreamStatusResult.value.running)
      setLoading(false)
    })
  }, [effectiveBankId])

  // Banks + initial selection (spec §8 header switcher).
  React.useEffect(() => {
    let cancelled = false
    const preferred = defaultBankId(workspaceId)
    window.electronAPI.listMemoryRepoBanks().then((items) => {
      if (cancelled) return
      setBanks(items)
      const match = items.find((item) => item.id === preferred)
      setBankId((prev) => prev ?? match?.id ?? items[0]?.id ?? preferred)
    }).catch((error) => {
      if (!cancelled) setForbidden(isForbidden(toErrorMessage(error)))
    })
    return () => { cancelled = true }
  }, [workspaceId])

  React.useEffect(() => {
    setFile(null)
    setDiff([])
    setNotFound(null)
    reload()
  }, [reload])

  // Follow externally-driven navigation: deep links to a commit open history,
// to a file open files, to the dream route open the dreams tab.
  React.useEffect(() => {
    if (isMemoryNavigation(navigationState) && navigationState.tab === 'dream') setTab('dreams')
  }, [navigationState])
  React.useEffect(() => { if (selectedPath) setTab('files') }, [selectedPath])
  React.useEffect(() => { if (selectedSha) setTab('history') }, [selectedSha])

  // Selected file / commit follow the navigation state.
  React.useEffect(() => {
    if (!selectedPath) {
      // Drop the stale guard too: a late response for a selection we just
      // cleared must not pass `current === fileGeneration.current`.
      fileGeneration.current += 1
      setFile(null)
      setFileLoading(false)
      setNotFound(null)
      return
    }
    const current = ++fileGeneration.current
    setFileLoading(true)
    setNotFound(null)
    window.electronAPI.readMemoryRepoFile(effectiveBankId, selectedPath).then((value) => {
      if (current === fileGeneration.current) { setFile(value); setNotFound(null); setFileLoading(false) }
    }).catch(() => {
      if (current === fileGeneration.current) { setFile(null); setNotFound('file'); setFileLoading(false) }
    })
  }, [effectiveBankId, selectedPath])

  React.useEffect(() => {
    if (!selectedSha) {
      diffGeneration.current += 1
      setDiff([])
      setNotFound(null)
      return
    }
    const current = ++diffGeneration.current
    window.electronAPI.getMemoryRepoCommitDiff(effectiveBankId, selectedSha).then((value) => {
      if (current === diffGeneration.current) { setDiff(value); setNotFound(null) }
    }).catch(() => { if (current === diffGeneration.current) { setDiff([]); setNotFound('commit') } })
  }, [effectiveBankId, selectedSha])

  // Live repository + dream signals.
  React.useEffect(() => {
    const offChanged = typeof window.electronAPI.onMemoryRepoChanged === 'function'
      ? window.electronAPI.onMemoryRepoChanged((changedBank) => { if (changedBank === effectiveBankId) reload() })
      : () => {}
    const offEvent = typeof window.electronAPI.onMemoryDreamEvent === 'function'
      ? window.electronAPI.onMemoryDreamEvent((event) => {
        if (event.bankId !== effectiveBankId) return
        setDreamLog((prev) => [...prev, event])
        if (event.kind === 'start') { dreamStartSeen.current = true; setDreamRunning(true); setDreamFailed(false) }
        if (event.kind === 'error') setDreamFailed(true)
        if (event.kind === 'end') setDreamRunning(false)
      })
      : () => {}
    const offDone = typeof window.electronAPI.onMemoryDreamDone === 'function'
      ? window.electronAPI.onMemoryDreamDone((run) => {
        if (run.bankId !== effectiveBankId) return
        setDreamRunning(false)
        setDreamFailed(run.status === 'error')
        setDreamStatus((prev) => (prev ? { ...prev, running: false, lastRun: run } : prev))
        reload()
      })
      : () => {}
    return () => { offChanged(); offEvent(); offDone() }
  }, [effectiveBankId, reload])

  const selectTab = (next: MemoryRepoTab) => {
    setTab(next)
    navigate(routes.view.memory(next === 'dreams' ? 'dream' : 'repo'))
  }

  const onDreamNow = () => {
    dreamStartSeen.current = false
    setDreamRunning(true)
    setDreamFailed(false)
    window.electronAPI.runMemoryDream(effectiveBankId).then((run) => {
      setDreamRunning(false)
      setDreamFailed(run.status === 'error')
      setDreamStatus((prev) => (prev ? { ...prev, running: false, lastRun: run } : prev))
      if (run.status === 'error') toast.error(t('memory.repo.state.dreamFailed'))
    }).catch((error) => {
      // A rejection after the run has actually started is the transport's 30 s
      // timeout, not a failure: the run is still alive server-side, so leave
      // `dreamRunning` set and let the `end`/`done` signals clear it.
      if (dreamStartSeen.current) return
      setDreamRunning(false)
      setDreamFailed(true)
      toast.error(isForbidden(toErrorMessage(error)) ? t('memory.repo.state.bankForbidden') : t('memory.repo.state.dreamFailed'))
    })
  }

  const onExport = () => {
    setExporting(true)
    window.electronAPI.exportMemoryRepo(effectiveBankId).then((result) => {
      setExporting(false)
      toast.success(t('memory.repo.export.done', { path: result.path }))
    }).catch((error) => {
      setExporting(false)
      toast.error(isForbidden(toErrorMessage(error)) ? t('memory.repo.state.bankForbidden') : t('memory.repo.state.fileNotFound'))
    })
  }

  const openMemoryFile = React.useCallback(
    (path: string) => navigate(routes.view.memory('repo', { type: 'file', path })),
    [navigate],
  )
  const openMemoryNote = React.useCallback((noteId: string) => navigate(routes.view.notes(noteId)), [navigate])
  const openMemorySession = React.useCallback((sessionId: string) => navigate(routes.view.allSessions(sessionId)), [navigate])

  const stateKey = (): string => {
    if (loading) return 'loading'
    if (forbidden) return 'bankForbidden'
    if (notFound === 'file') return 'fileNotFound'
    if (notFound === 'commit') return 'commitNotFound'
    if (exporting) return 'exporting'
    if (dreamFailed) return 'dreamFailed'
    if (dreamRunning) return 'dreamRunning'
    if (status?.mode === 'snapshots') return 'degradedNoGit'
    if (status?.foreignTree) return 'foreignTree'
    if (!status?.head && tree.length === 0 && commits.length === 0) return 'empty'
    if (status?.editedFiles?.length) return 'edited'
    if (status?.dirty) return 'dirty'
    return 'actual'
  }
  const state = stateKey()
  const tone = state === 'actual' ? 'ok'
    : state === 'fileNotFound' || state === 'commitNotFound' || state === 'dreamFailed' || state === 'bankForbidden' ? 'danger'
      : state === 'edited' || state === 'dirty' || state === 'foreignTree' ? 'warn'
        : 'muted'

  const headLabel = status?.head ? status.head.sha.slice(0, 7) : t('memory.repo.headNone')

  return (
    <div ref={repoTarget} className="flex h-full min-h-0 flex-col" data-testid="memory-repo-screen">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
        <GitBranch aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
        <span className="text-[13px] font-semibold">{t('memory.repo.title')}</span>

        <div className="relative">
          <button
            type="button"
            data-testid="memory-repo-bank"
            aria-haspopup="listbox"
            aria-expanded={bankMenuOpen}
            onClick={() => setBankMenuOpen((value) => !value)}
            className="flex h-7 items-center gap-1 rounded-[var(--radius-control)] border border-foreground/10 bg-background px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="truncate">{banks.find((bank) => bank.id === effectiveBankId)?.label ?? banks.find((bank) => bank.id === effectiveBankId)?.id ?? effectiveBankId}</span>
          </button>
          {bankMenuOpen ? (
            <ul role="listbox" className="absolute left-0 top-8 z-20 min-w-[180px] rounded-[var(--radius-control)] border border-border bg-popover p-1 shadow-lg">
              {banks.map((bank) => (
                <li key={bank.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={bank.id === effectiveBankId}
                    data-testid={`memory-repo-bank-${bank.id}`}
                    onClick={() => { setBankMenuOpen(false); setBankId(bank.id); setTab('files') }}
                    className={cn('flex w-full items-center rounded-[var(--radius-control)] px-2 py-1 text-left text-[12px]', bank.id === effectiveBankId ? 'bg-foreground/[0.09] font-semibold' : 'hover:bg-foreground/[0.05]')}
                  >
                    <span className="min-w-0 flex-1 truncate">{bank.label}</span>
                    <span className="shrink-0 text-[10px] text-text-muted">{t(bank.isMain ? 'memory.repo.bank.main' : 'memory.repo.bank.workspace')}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <span
          data-testid="memory-repo-state"
          data-state={state}
          className={cn('inline-flex items-center gap-1 text-[11px]', tone === 'ok' ? 'text-emerald-500' : tone === 'danger' ? 'text-destructive' : tone === 'warn' ? 'text-amber-500' : 'text-text-muted')}
        >
          <span aria-hidden="true" className={cn('size-1.5 rounded-full', tone === 'ok' ? 'bg-emerald-500' : tone === 'danger' ? 'bg-destructive' : tone === 'warn' ? 'bg-amber-500' : 'bg-text-muted')} />
          {t(`memory.repo.state.${state}`)}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-text-muted" data-testid="memory-repo-head">
          {t('memory.repo.head')} <span className="font-mono tabular-nums">{headLabel}</span>
        </span>

        <button type="button" data-testid="memory-repo-refresh" onClick={reload} className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] border border-foreground/10 px-2 text-[12px] hover:bg-foreground/[0.05]">
          <RefreshCw aria-hidden="true" className="size-3.5" />{t('memory.repo.action.refresh')}
        </button>
        <button type="button" data-testid="memory-repo-dream-now" onClick={onDreamNow} disabled={dreamRunning} className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] border border-foreground/10 px-2 text-[12px] hover:bg-foreground/[0.05] disabled:opacity-50">
          <Sparkles aria-hidden="true" className="size-3.5" />{dreamRunning ? t('memory.repo.state.dreamRunning') : t('memory.repo.action.dreamNow')}
        </button>
        <button type="button" data-testid="memory-repo-export" onClick={onExport} disabled={exporting} className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] border border-foreground/10 px-2 text-[12px] hover:bg-foreground/[0.05] disabled:opacity-50">
          <Download aria-hidden="true" className="size-3.5" />{exporting ? t('memory.repo.state.exporting') : t('memory.repo.action.export')}
        </button>
      </header>

      <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-border/50 px-3 py-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            data-testid={`memory-repo-tab-${entry.id}`}
            onClick={() => selectTab(entry.id)}
            className={cn('h-7 rounded-[var(--radius-control)] px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent', tab === entry.id ? 'bg-foreground/[0.09] font-semibold' : 'text-text-secondary hover:bg-foreground/[0.05]')}
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {tab === 'files' ? (
          <MemoryRepoFilesPanel
            bankId={effectiveBankId}
            tree={tree}
            selectedPath={selectedPath}
            onSelect={(path) => navigate(routes.view.memory('repo', { type: 'file', path }))}
            file={file}
            loading={loading}
            fileLoading={fileLoading}
          />
        ) : null}
        {tab === 'history' ? (
          <MemoryRepoHistoryPanel
            bankId={effectiveBankId}
            commits={commits}
            selectedSha={selectedSha}
            onSelect={(sha) => navigate(routes.view.memory('repo', { type: 'commit', sha }))}
            diff={diff}
            loading={loading}
            mode={status?.mode ?? 'git'}
          />
        ) : null}
        {tab === 'dreams' ? (
          <MemoryRepoDreamsPanel
            bankId={effectiveBankId}
            status={dreamStatus}
            log={dreamLog}
            running={dreamRunning}
            onRunNow={onDreamNow}
          />
        ) : null}
        {tab === 'graph' ? (
          <MemoryRepoGraphPanel graph={graph} onOpenFile={openMemoryFile} />
        ) : null}
      </div>

      <MemoryRepoSearchOverlay
        workspaceId={workspaceId}
        tree={tree}
        onOpenFile={openMemoryFile}
        onOpenNote={openMemoryNote}
        onOpenSession={openMemorySession}
      />
    </div>
  )
}