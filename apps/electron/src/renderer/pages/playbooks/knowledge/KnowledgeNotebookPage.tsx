/**
 * С-13 «Ноутбук знаний» (docs/specs/2026-10-09-dev-space-and-playbooks 04-UI-SPEC B.13,
 * D12). Sources reuse `SourcesListPanel` + the `sources:*` RPC surface; questions
 * reuse the `sources:search` retrieval precedent. The podcast button hands off to
 * С-14 (D13).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Loader2, Mic2, RefreshCw, Send, Sparkles } from 'lucide-react'
import type { LoadedSource } from '../../../../shared/types'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { SourcesListPanel } from '@/components/app-shell/SourcesListPanel'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { searchSourceIndex, useSourceIndex, type SourceIndexHit } from './useSourceIndex'
import type { PlaybookNotebook } from '../notebook-store'
import { PresetQuestions } from './PresetQuestions'
import { SourceAnswerList } from './SourceAnswerList'

export interface KnowledgeNotebookProps {
  notebook: PlaybookNotebook
  onBack: () => void
  onUpdate: (patch: Partial<Pick<PlaybookNotebook, 'name' | 'sourceSlugs' | 'note'>>) => void
  onGeneratePodcast: (topic: { sourceSlug: string | null; question: string | null }) => void
}

export default function KnowledgeNotebookPage({ notebook, onBack, onUpdate, onGeneratePodcast }: KnowledgeNotebookProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const index = useSourceIndex(workspaceId)
  const [selectedSourceSlug, setSelectedSourceSlug] = useState<string | null>(notebook.sourceSlugs[0] ?? null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [hits, setHits] = useState<SourceIndexHit[] | null>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const askSeq = useRef(0)

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

  const ask = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return
      const seq = ++askSeq.current
      setAsking(true)
      setAskError(null)
      setAsked(trimmed)
      try {
        const next = await searchSourceIndex(workspaceId, trimmed)
        if (askSeq.current !== seq) return
        setHits(next)
      } catch (err) {
        if (askSeq.current !== seq) return
        setHits(null)
        setAskError(err instanceof Error ? err.message : String(err))
      } finally {
        if (askSeq.current === seq) setAsking(false)
      }
    },
    [workspaceId],
  )

  const deleteSource = useCallback(
    async (sourceSlug: string) => {
      if (!workspaceId) return
      try {
        await window.electronAPI.deleteSource(workspaceId, sourceSlug)
        onUpdate({ sourceSlugs: notebook.sourceSlugs.filter((slug) => slug !== sourceSlug) })
      } catch (err) {
        setAskError(err instanceof Error ? err.message : String(err))
      }
    },
    [workspaceId, notebook.sourceSlugs, onUpdate],
  )

  const trackSource = useCallback(
    (source: LoadedSource) => {
      setSelectedSourceSlug(source.config.slug)
      if (!notebook.sourceSlugs.includes(source.config.slug)) {
        onUpdate({ sourceSlugs: [...notebook.sourceSlugs, source.config.slug] })
      }
    },
    [notebook.sourceSlugs, onUpdate],
  )

  const partial = index.status !== null && index.lastReindexAt === null
  const hasSources = index.sources.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="playbooks-notebook">
      <PanelHeader
        title={notebook.name}
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onBack} data-testid="playbooks-notebook-back">
              <ArrowLeft className="icon-caption" aria-hidden />
              {t('playbooks.notebook.back')}
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="playbooks-notebook-podcast"
              onClick={() => onGeneratePodcast({ sourceSlug: selectedSourceSlug, question: asked })}
            >
              <Mic2 className="icon-caption" aria-hidden />
              {t('playbooks.notebook.podcast')}
            </Button>
          </div>
        }
      />

      {offline ? (
        <p className="border-b border-border-subtle px-5 py-2 text-xs text-muted-foreground" role="status" data-testid="playbooks-notebook-offline">
          {t('playbooks.notebook.offline')}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(280px,360px)]">
        <aside className="min-h-0 overflow-auto border-b border-border-subtle lg:border-b-0 lg:border-r" data-testid="playbooks-notebook-sources">
          <h2 className="px-3 pt-3 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {t('playbooks.notebook.sourcesTitle')}
          </h2>
          {index.loading ? (
            <div className="space-y-2 p-3" aria-busy="true" data-testid="playbooks-notebook-sources-loading">
              {[0, 1, 2].map((key) => (
                <div key={key} className="h-9 animate-pulse rounded-[var(--radius-control)] bg-surface-hover motion-reduce:animate-none" />
              ))}
            </div>
          ) : index.error ? (
            <div className="space-y-2 p-3" role="alert">
              <p className="text-xs text-destructive">{t('playbooks.notebook.indexError', { error: index.error })}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void index.reload()}>
                {t('playbooks.notebook.retry')}
              </Button>
            </div>
          ) : (
            <SourcesListPanel
              sources={index.sources}
              workspaceRootPath={workspace?.rootPath}
              selectedSourceSlug={selectedSourceSlug}
              onSourceClick={trackSource}
              onDeleteSource={(slug) => void deleteSource(slug)}
              className="pb-3"
            />
          )}
          {index.status !== null ? (
            <p className="px-3 pb-3 text-caption text-muted-foreground tabular-nums" data-testid="playbooks-notebook-index-status">
              {t('playbooks.notebook.indexStatus', { count: index.status.indexed })}
              {' · '}
              {index.status.primary === 'native' ? t('playbooks.notebook.indexNative') : t('playbooks.notebook.indexTs')}
            </p>
          ) : null}
          {partial ? (
            <p className="px-3 pb-3 text-caption text-status-warning" role="status" data-testid="playbooks-notebook-partial">
              {t('playbooks.notebook.partial')}
            </p>
          ) : null}
        </aside>

        <section className="min-h-0 overflow-auto border-b border-border-subtle p-5 lg:border-b-0 lg:border-r" data-testid="playbooks-notebook-note">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t('playbooks.notebook.noteTitle')}</h2>
            <Button type="button" variant="outline" size="sm" disabled={index.reindexing} onClick={() => void index.reindex()} data-testid="playbooks-notebook-reindex">
              <RefreshCw className={index.reindexing ? 'icon-caption animate-spin motion-reduce:animate-none' : 'icon-caption'} aria-hidden />
              {index.reindexing ? t('playbooks.notebook.reindexing') : t('playbooks.notebook.reindex')}
            </Button>
          </div>
          <Textarea
            value={notebook.note}
            onChange={(event) => onUpdate({ note: event.target.value })}
            placeholder={t('playbooks.notebook.notePlaceholder')}
            className="min-h-[320px] w-full resize-y text-sm"
            aria-label={t('playbooks.notebook.noteTitle')}
            data-testid="playbooks-notebook-note-input"
          />
        </section>

        <section className="flex min-h-0 flex-col" data-testid="playbooks-notebook-ask">
          <PresetQuestions
            disabled={!hasSources}
            onSelect={(key) => void ask(t(`playbooks.notebook.presets.${key}`))}
          />
          <div className="flex min-h-0 flex-1 flex-col border-t border-border-subtle">
            <div className="flex items-center gap-2 px-3 py-2">
              <Sparkles className="icon-caption text-muted-foreground" aria-hidden />
              <span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                {t('playbooks.notebook.askTitle')}
              </span>
            </div>
            {!hasSources ? (
              <div className="p-3">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Sparkles aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>{t('playbooks.notebook.emptyTitle')}</EmptyTitle>
                    <EmptyDescription>{t('playbooks.notebook.emptyDescription')}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button type="button" size="sm" disabled>
                      {t('playbooks.notebook.emptyAction')}
                    </Button>
                  </EmptyContent>
                </Empty>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto px-3" aria-live="polite">
                {asking ? (
                  <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground" role="status" data-testid="playbooks-notebook-asking">
                    <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden />
                    {t('playbooks.notebook.asking')}
                  </p>
                ) : askError ? (
                  <p className="py-3 text-xs text-destructive" role="alert">{t('playbooks.notebook.askError', { error: askError })}</p>
                ) : hits ? (
                  hits.length > 0 ? (
                    <SourceAnswerList question={asked ?? ''} hits={hits} />
                  ) : (
                    <p className="py-3 text-xs text-muted-foreground" role="status">{t('playbooks.notebook.noAnswer')}</p>
                  )
                ) : (
                  <p className="py-3 text-xs text-muted-foreground">{t('playbooks.notebook.askHint')}</p>
                )}
              </div>
            )}
            <form
              className="flex items-center gap-2 border-t border-border-subtle p-3"
              onSubmit={(event) => {
                event.preventDefault()
                void ask(question)
              }}
            >
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={t('playbooks.notebook.askPlaceholder')}
                className="h-8 text-xs"
                aria-label={t('playbooks.notebook.askPlaceholder')}
                data-testid="playbooks-notebook-ask-input"
              />
              <Button type="submit" size="sm" disabled={!hasSources || asking || question.trim().length === 0} data-testid="playbooks-notebook-ask-send">
                <Send className="icon-caption" aria-hidden />
                {t('playbooks.notebook.ask')}
              </Button>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}