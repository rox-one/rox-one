/**
 * С-12…С-14 — Playbooks notebook surface (docs/specs/2026-10-09-dev-space-and-playbooks,
 * D12/D13). Gated by the master flag `playbooks.v1` plus the knowledge sub-flag
 * `playbooks.knowledge.v1`. The home list switches between the knowledge
 * notebook (С-13) and the podcast studio dialog (С-14) in-place, so no new
 * top-level route is introduced (the В1 nav entry owns `route: playbooks`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { playbooksEnabledAtom } from '@/atoms/playbooks'
import { workbenchFlagAtom } from '@/platform/unified-flags'
import { createNotebook, loadNotebooks, saveNotebooks, type NotebookMode, type PlaybookNotebook } from './notebook-store'
import { NotebookHome } from './components/NotebookHome'
import KnowledgeNotebookPage from './knowledge/KnowledgeNotebookPage'
import CodebookNotebookPage from './codebook/CodebookNotebookPage'
import { PodcastStudio } from './podcast/PodcastStudio'
import { appendRecentPodcast, loadRecentPodcasts, type RecentPodcast } from './podcast/podcast-history'

type PlaybooksView = { kind: 'home' } | { kind: 'notebook'; id: string }

export default function PlaybooksHomePage() {
  const { t } = useTranslation()
  const enabled = useAtomValue(playbooksEnabledAtom)
  const knowledgeEnabled = useAtomValue(workbenchFlagAtom(WORKBENCH_FLAG.playbooksKnowledgeV1))
  const codebookEnabled = useAtomValue(workbenchFlagAtom(WORKBENCH_FLAG.playbooksCodebookV1))
  const [notebooks, setNotebooks] = useState<PlaybookNotebook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<PlaybooksView>({ kind: 'home' })
  const [podcasts, setPodcasts] = useState<RecentPodcast[]>([])
  const [podcastOpen, setPodcastOpen] = useState(false)
  const [podcastSeed, setPodcastSeed] = useState<{ sourceSlug: string | null; question: string | null }>({ sourceSlug: null, question: null })
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)

  useEffect(() => {
    try {
      setNotebooks(loadNotebooks())
      setPodcasts(loadRecentPodcasts())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

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

  const persist = useCallback((next: PlaybookNotebook[]) => {
    setNotebooks(next)
    saveNotebooks(next)
  }, [])

  const create = useCallback(
    (mode: NotebookMode, name: string) => {
      const notebook = createNotebook(name, mode)
      persist([notebook, ...notebooks])
      setView({ kind: 'notebook', id: notebook.id })
    },
    [notebooks, persist],
  )

  const update = useCallback(
    (id: string, patch: Partial<Pick<PlaybookNotebook, 'name' | 'sourceSlugs' | 'note' | 'cells' | 'projectSlug'>>) => {
      persist(notebooks.map((notebook) => (notebook.id === id ? { ...notebook, ...patch, updatedAt: Date.now() } : notebook)))
    },
    [notebooks, persist],
  )

  const remove = useCallback((id: string) => persist(notebooks.filter((notebook) => notebook.id !== id)), [notebooks, persist])

  const activeNotebook = useMemo(
    () => (view.kind === 'notebook' ? notebooks.find((notebook) => notebook.id === view.id) ?? null : null),
    [view, notebooks],
  )

  if (!enabled) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="playbooks-home">
        <PanelHeader title={t('playbooks.home.title')} />
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <p className="mb-2 max-w-2xl text-sm" role="status" data-testid="playbooks-disabled-notice">{t('playbooks.home.disabledNotice')}</p>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('playbooks.home.disabledHint')}</p>
        </div>
      </div>
    )
  }

  if (view.kind === 'notebook' && activeNotebook && activeNotebook.mode === 'codebook') {
    if (!codebookEnabled) {
      return (
        <div className="flex h-full min-h-0 flex-col" data-testid="playbooks-home">
          <PanelHeader title={activeNotebook.name} actions={<button type="button" className="text-xs text-muted-foreground" onClick={() => setView({ kind: 'home' })}>{t('playbooks.notebook.back')}</button>} />
          <div className="min-h-0 flex-1 overflow-auto p-5">
            <p className="max-w-2xl text-sm" role="status" data-testid="playbooks-codebook-disabled">{t('playbooks.codebook.disabled')}</p>
          </div>
        </div>
      )
    }
    return (
      <CodebookNotebookPage
        notebook={activeNotebook}
        onBack={() => setView({ kind: 'home' })}
        onUpdate={(patch) => update(activeNotebook.id, patch)}
      />
    )
  }

  if (view.kind === 'notebook' && activeNotebook && !knowledgeEnabled) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="playbooks-home">
        <PanelHeader title={activeNotebook.name} actions={<button type="button" className="text-xs text-muted-foreground" onClick={() => setView({ kind: 'home' })}>{t('playbooks.notebook.back')}</button>} />
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <p className="max-w-2xl text-sm" role="status" data-testid="playbooks-knowledge-disabled">{t('playbooks.notebook.knowledgeDisabled')}</p>
        </div>
      </div>
    )
  }

  if (view.kind === 'notebook' && activeNotebook) {
    return (
      <>
        <KnowledgeNotebookPage
          notebook={activeNotebook}
          onBack={() => setView({ kind: 'home' })}
          onUpdate={(patch) => update(activeNotebook.id, patch)}
          onGeneratePodcast={(seed) => {
            setPodcastSeed(seed)
            setPodcastOpen(true)
          }}
        />
        <PodcastStudio
          open={podcastOpen}
          onOpenChange={setPodcastOpen}
          projectSlug={activeNotebook.projectSlug}
          seed={podcastSeed}
          onCompleted={(info) => {
            setPodcasts(
              appendRecentPodcast({
                id: info.jobId,
                notebookId: activeNotebook.id,
                topic: info.topic,
                engine: info.engine,
                at: Date.now(),
              }),
            )
          }}
        />
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="playbooks-home-root">
      <PanelHeader title={t('playbooks.home.title')} />
      {!knowledgeEnabled ? (
        <p className="border-b border-border-subtle px-5 py-2 text-xs text-muted-foreground" role="status" data-testid="playbooks-home-knowledge-off">
          {t('playbooks.home.knowledgeOff')}
        </p>
      ) : null}
      <NotebookHome
        notebooks={notebooks}
        loading={loading}
        error={error}
        recentPodcasts={podcasts}
        offline={offline}
        codebookEnabled={codebookEnabled}
        onOpen={(id) => setView({ kind: 'notebook', id })}
        onCreate={create}
        onDelete={remove}
        onRetry={() => {
          setLoading(true)
          try {
            setNotebooks(loadNotebooks())
            setError(null)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setLoading(false)
          }
        }}
      />
    </div>
  )
}