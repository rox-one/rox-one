/**
 * С-12 «Playbooks Home» list/grid (docs/specs/2026-10-09-dev-space-and-playbooks
 * 04-UI-SPEC B.12, D12): notebook list, create (knowledge/codebook), search,
 * removal confirmation, and the recent-podcasts secondary zone.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Mic2, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import type { NotebookMode, PlaybookNotebook } from '../notebook-store'
import { PRESET_QUESTION_IDS } from '../knowledge/PresetQuestions'
import type { RecentPodcast } from '../podcast/podcast-history'

export interface NotebookHomeProps {
  notebooks: readonly PlaybookNotebook[]
  loading: boolean
  error: string | null
  recentPodcasts: readonly RecentPodcast[]
  offline: boolean
  /** `playbooks.codebook.v1` — enables creating and opening codebook notebooks. */
  codebookEnabled: boolean
  onOpen: (id: string) => void
  onCreate: (mode: NotebookMode, name: string) => void
  onDelete: (id: string) => void
  onRetry: () => void
}

export function NotebookHome({ notebooks, loading, error, recentPodcasts, offline, codebookEnabled, onOpen, onCreate, onDelete, onRetry }: NotebookHomeProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMode, setNewMode] = useState<NotebookMode>('knowledge')
  const [pendingDelete, setPendingDelete] = useState<PlaybookNotebook | null>(null)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return notebooks
    return notebooks.filter((notebook) => notebook.name.toLowerCase().includes(needle))
  }, [notebooks, query])

  const submitCreate = () => {
    const name = newName.trim() || t('playbooks.home.defaultName')
    onCreate(newMode, name)
    setCreateOpen(false)
    setNewName('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="playbooks-home">
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <div>
          <h1 className="text-sm font-medium">{t('playbooks.home.heading')}</h1>
          <p className="text-xs text-muted-foreground">{t('playbooks.home.subtitle')}</p>
        </div>
        <Button type="button" size="sm" data-testid="playbooks-home-new" onClick={() => setCreateOpen(true)}>
          <Plus className="icon-caption" aria-hidden />
          {t('playbooks.home.newNotebook')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {offline ? (
          <p className="mb-4 text-xs text-muted-foreground" role="status" data-testid="playbooks-home-offline">
            {t('playbooks.home.offline')}
          </p>
        ) : null}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" data-testid="playbooks-home-loading">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-28 animate-pulse rounded-[var(--radius-card)] border border-border-subtle bg-surface-hover motion-reduce:animate-none" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm text-destructive">{t('playbooks.home.error', { error })}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('playbooks.home.retry')}</Button>
          </div>
        ) : notebooks.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><BookOpen aria-hidden /></EmptyMedia>
              <EmptyTitle>{t('playbooks.home.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('playbooks.home.emptyDescription')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" data-testid="playbooks-home-empty-create" onClick={() => setCreateOpen(true)}>
                <Plus className="icon-caption" aria-hidden />
                {t('playbooks.home.emptyAction')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="space-y-4">
            <label className="flex max-w-sm items-center gap-2 rounded-md border border-border-subtle px-2 py-1.5 text-xs focus-within:ring-1 focus-within:ring-ring">
              <Search className="icon-caption text-muted-foreground" aria-hidden />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('playbooks.home.searchPlaceholder')} className="h-6 border-0 bg-transparent p-0 text-xs focus-visible:ring-0" />
            </label>

            <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3" data-testid="playbooks-home-list">
              {visible.map((notebook) => (
                <li key={notebook.id} className="min-w-0">
                  <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-border-subtle p-3 transition-colors duration-[var(--motion-fast)] hover:bg-surface-hover motion-reduce:transition-none">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(notebook.id)} data-testid={`playbooks-home-notebook-${notebook.id}`}>
                      <span className="block truncate text-sm font-medium">{notebook.name}</span>
                      <span className="mt-1 block text-caption text-muted-foreground">
                        {notebook.mode === 'knowledge' ? t('playbooks.home.modeKnowledge') : t('playbooks.home.modeCodebook')}
                        {' · '}
                        {notebook.mode === 'knowledge'
                          ? t('playbooks.home.sourcesCount', { count: notebook.sourceSlugs.length })
                          : t('playbooks.codebook.cellsCount', { count: notebook.cells?.length ?? 0 })}
                      </span>
                      <span className="mt-1 block text-caption text-muted-foreground tabular-nums">
                        {new Date(notebook.updatedAt).toLocaleDateString()}
                      </span>
                    </button>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-caption text-muted-foreground">{t('playbooks.home.statusReady')}</span>
                      <Button type="button" variant="ghost" size="sm" aria-label={t('playbooks.home.delete')} onClick={() => setPendingDelete(notebook)} data-testid={`playbooks-home-delete-${notebook.id}`}>
                        <Trash2 className="icon-caption" aria-hidden />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {visible.length === 0 ? <p className="text-sm text-muted-foreground">{t('playbooks.home.noMatches')}</p> : null}
          </div>
        )}

        <section className="mt-6" data-testid="playbooks-home-recent-podcasts">
          <h2 className="mb-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">{t('playbooks.home.recentPodcasts')}</h2>
          {recentPodcasts.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('playbooks.home.noPodcasts')}</p>
          ) : (
            <ul className="list-none space-y-1 p-0">
              {recentPodcasts.slice(0, 5).map((podcast) => (
                <li key={podcast.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mic2 className="icon-caption" aria-hidden />
                  <span className="truncate">{podcast.topic}</span>
                  <span className="ml-auto tabular-nums">{new Date(podcast.at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6" data-testid="playbooks-home-presets">
          <h2 className="mb-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">{t('playbooks.notebook.presetsTitle')}</h2>
          <ul className="list-none space-y-0.5 p-0">
            {PRESET_QUESTION_IDS.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onOpen(notebooks[0].id)}
                  className="w-full rounded-[var(--radius-control)] px-2 py-1 text-left text-xs text-muted-foreground transition-colors duration-[var(--motion-fast)] hover:bg-surface-hover motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-ring"
                  data-testid={`playbooks-home-preset-${id}`}
                >
                  {t(`playbooks.notebook.presets.${id}`)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="playbooks-home-create-dialog">
          <DialogHeader>
            <DialogTitle>{t('playbooks.home.createTitle')}</DialogTitle>
            <DialogDescription>{t('playbooks.home.createDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t('playbooks.home.namePlaceholder')} data-testid="playbooks-home-name" />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={newMode === 'knowledge' ? 'default' : 'outline'} size="sm" onClick={() => setNewMode('knowledge')} data-testid="playbooks-home-mode-knowledge">
                {t('playbooks.home.modeKnowledge')}
              </Button>
              {codebookEnabled ? (
                <Button type="button" variant={newMode === 'codebook' ? 'default' : 'outline'} size="sm" onClick={() => setNewMode('codebook')} className="w-full" data-testid="playbooks-home-mode-codebook">
                  {t('playbooks.home.modeCodebook')}
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* Wrapper keeps the tooltip alive while the button is disabled. */}
                    <span className="inline-flex w-full" tabIndex={0}>
                      <Button type="button" variant="outline" size="sm" disabled className="w-full" data-testid="playbooks-home-mode-codebook">
                        {t('playbooks.home.modeCodebook')}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('playbooks.home.codebookSoon')}</TooltipContent>
                </Tooltip>
              )}
            </div>
            {!codebookEnabled ? <p className="text-caption text-muted-foreground">{t('playbooks.home.codebookSoon')}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t('playbooks.home.cancel')}</Button>
            <Button type="button" onClick={submitCreate} data-testid="playbooks-home-create-confirm">{t('playbooks.home.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(openValue) => { if (!openValue) setPendingDelete(null) }}>
        <DialogContent data-testid="playbooks-home-delete-dialog">
          <DialogHeader>
            <DialogTitle>{t('playbooks.home.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('playbooks.home.deleteDescription', { name: pendingDelete?.name ?? '' })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>{t('playbooks.home.cancel')}</Button>
            <Button type="button" variant="destructive" onClick={() => { if (pendingDelete) onDelete(pendingDelete.id); setPendingDelete(null) }} data-testid="playbooks-home-delete-confirm">
              {t('playbooks.home.deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}