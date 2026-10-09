import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Play, RefreshCw, Sparkles } from 'lucide-react'
import type { DevSpaceArtifactSummary, DevSpaceQuestion, DevSpaceQuestionBlockName } from '@rox/shared/dev-space'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/markdown'
import { devSpaceErrorKey } from './errors'
import {
  DEV_SPACE_QUESTION_BLOCK_KEYS,
  DEV_SPACE_QUESTION_BLOCK_ORDER,
  DEV_SPACE_QUESTIONS_PER_BLOCK,
  DEV_SPACE_WHY_KEYS,
  devSpaceSecurityBadgeKey,
  isDevSpaceQuestionsDenied,
  matchesDevSpaceQuestionTour,
  parseDevSpaceQuestions,
  type DevSpaceGeneratedTour,
  type DevSpaceQuestionsDocument,
} from './questions'

export interface QuestionsSurfaceProps {
  workspaceId: string
  /** Catalog record id (`devrepo_<...>`) — the `generateQuestions` input. */
  repositoryId: string
  projectSlug: string | null
  stale: boolean
  /** The repo manifest projection; the surface picks `questions` + source kinds from it. */
  artifacts: readonly DevSpaceArtifactSummary[]
  tours: readonly DevSpaceGeneratedTour[]
  /** Launch the generated tour for a block question (page owns the tour controller). */
  onWatchTour: (block: DevSpaceQuestionBlockName, indexInBlock: number) => void
  /** Re-read the page's artifact list after a successful generation. */
  onGenerated: () => Promise<void>
}

interface AnswerState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly text?: string
  readonly format?: string
  readonly errorKey?: string
}

const WHY_FIELDS = ['profile', 'repo', 'signals'] as const

/**
 * С-10 — three pre-generated question columns + the «свой вопрос» composer
 * (04-UI-SPEC §B.10, D8/D11). A card expands a text answer grounded in the
 * question's own source artifact, or launches the generated tour.
 */
export function QuestionsSurface({ workspaceId, repositoryId, projectSlug, stale, artifacts, tours, onWatchTour, onGenerated }: QuestionsSurfaceProps) {
  const { t } = useTranslation()
  const [doc, setDoc] = useState<DevSpaceQuestionsDocument | null>(null)
  const [view, setView] = useState<'loading' | 'ready' | 'empty' | 'error' | 'denied'>('loading')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [deniedReasons, setDeniedReasons] = useState<readonly string[]>([])
  const [generating, setGenerating] = useState(false)
  const [expandedWhy, setExpandedWhy] = useState<Record<string, boolean>>({})
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({})
  const requestSeq = useRef(0)

  const questionsEntries = useMemo(
    () => artifacts.filter((artifact) => artifact.kind === 'questions').sort((a, b) => b.createdAt - a.createdAt),
    [artifacts],
  )
  const newestEntryId = questionsEntries[0]?.id ?? null

  /** All three columns always render (D8): a block absent from a partial run shows its pending state. */
  const columns = useMemo(
    () => DEV_SPACE_QUESTION_BLOCK_ORDER.map((block) => ({
      block,
      questions: doc?.blocks.find((entry) => entry.block === block)?.questions ?? [],
    })),
    [doc],
  )

  const load = useCallback(async (artifactId: string | null) => {
    if (!workspaceId || !projectSlug || !artifactId) { setDoc(null); setView('empty'); setErrorKey(null); return }
    const seq = ++requestSeq.current
    setView('loading'); setErrorKey(null)
    try {
      const result = await window.electronAPI.readDevSpaceArtifact({ workspaceId, projectSlug, artifactId })
      if (requestSeq.current !== seq) return
      const parsed = result.encoding === 'utf8' ? parseDevSpaceQuestions(result.content) : null
      if (!parsed) { setDoc(null); setView('error'); setErrorKey('devSpaceQuestions.error'); return }
      setDoc(parsed); setView('ready')
    } catch (error) {
      if (requestSeq.current !== seq) return
      setDoc(null); setView('error'); setErrorKey(devSpaceErrorKey(error))
    }
  }, [workspaceId, projectSlug])

  useEffect(() => { void load(newestEntryId) }, [load, newestEntryId])

  const generate = useCallback(async () => {
    setGenerating(true); setErrorKey(null)
    try {
      const result = await window.electronAPI.generateDevSpaceQuestions({ workspaceId, repositoryId })
      setDeniedReasons(result.reasons)
      if (result.status === 'denied' || isDevSpaceQuestionsDenied(result.reasons)) {
        setDoc(null); setView('denied'); return
      }
      setDoc({
        schemaVersion: 1,
        repositoryId: result.repositoryId,
        snapshotId: result.snapshotId,
        generatedAt: result.generatedAt,
        blocks: result.blocks,
        security: result.security,
      })
      setView(result.blocks.length ? 'ready' : 'empty')
      // The generator writes new manifest entries; re-read the list to keep freshness honest.
      await onGenerated()
    } catch (error) {
      setDoc(null); setView('error'); setErrorKey(devSpaceErrorKey(error))
    } finally { setGenerating(false) }
  }, [workspaceId, repositoryId, onGenerated])

  const loadAnswer = useCallback(async (question: DevSpaceQuestion) => {
    const entry = artifacts.find((artifact) => artifact.kind === question.source.kind)
    if (!entry || !projectSlug || !workspaceId) {
      setAnswers((previous) => ({ ...previous, [question.id]: { status: 'error', errorKey: 'devSpaceQuestions.answerUnavailable' } }))
      return
    }
    setAnswers((previous) => ({ ...previous, [question.id]: { status: 'loading' } }))
    try {
      const result = await window.electronAPI.readDevSpaceArtifact({ workspaceId, projectSlug, artifactId: entry.id })
      setAnswers((previous) => ({ ...previous, [question.id]: { status: 'ready', text: result.content, format: result.artifact.format } }))
    } catch (error) {
      setAnswers((previous) => ({ ...previous, [question.id]: { status: 'error', errorKey: devSpaceErrorKey(error) } }))
    }
  }, [artifacts, projectSlug, workspaceId])

  const gridRef = useRef<HTMLDivElement>(null)
  const moveFocus = useCallback((column: number, row: number) => {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-question-cell="${column}:${row}"] button`)?.focus()
  }, [])
  const handleGridKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-question-cell]')
    if (!cell) return
    const [column, row] = (cell.dataset.questionCell ?? '').split(':').map(Number)
    if (!Number.isInteger(column) || !Number.isInteger(row)) return
    const columnCount = columns.length
    const rows = columns[column]?.questions.length ?? 0
    const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max))
    let next: [number, number] | null = null
    if (event.key === 'ArrowUp') next = [column, clamp(row - 1, rows - 1)]
    else if (event.key === 'ArrowDown') next = [column, clamp(row + 1, rows - 1)]
    else if (event.key === 'ArrowLeft') next = [clamp(column - 1, columnCount - 1), clamp(row, (columns[clamp(column - 1, columnCount - 1)]?.questions.length ?? 1) - 1)]
    else if (event.key === 'ArrowRight') next = [clamp(column + 1, columnCount - 1), clamp(row, (columns[clamp(column + 1, columnCount - 1)]?.questions.length ?? 1) - 1)]
    else if (event.key === 'Home') next = [column, 0]
    else if (event.key === 'End') next = [column, rows - 1]
    if (!next) return
    event.preventDefault()
    moveFocus(next[0], next[1])
  }, [columns, moveFocus])

  const securityBadgeKey = doc ? devSpaceSecurityBadgeKey(doc.security) : null

  return (
    <section className="space-y-4 rounded-[var(--radius-card)] border border-border-subtle p-5" data-testid="dev-space-surface-questions" aria-labelledby="dev-space-questions-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id="dev-space-questions-title" className="text-sm font-semibold">{t('devSpaceQuestions.title')}</h2>
          {stale ? <Badge variant="outline" data-testid="dev-space-questions-stale">{t('devSpaceQuestions.stale')}</Badge> : null}
        </div>
        <Button type="button" size="sm" variant="outline" disabled={generating} onClick={() => void generate()} data-testid="dev-space-questions-recalculate">
          {generating ? <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw className="icon-caption" aria-hidden />}
          {generating ? t('devSpaceQuestions.recalculating') : t('devSpaceQuestions.recalculate')}
        </Button>
      </div>

      {view === 'loading' ? (
        <div className="grid gap-4 lg:grid-cols-3" aria-busy="true" role="status" data-testid="dev-space-questions-loading">
          {[0, 1, 2].map((column) => (
            <div key={column} className="space-y-2">
              <div className="h-5 w-32 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
              {[0, 1, 2, 3].map((row) => <div key={row} className="h-16 animate-pulse rounded-[var(--radius-card)] border border-border-subtle bg-surface-hover motion-reduce:animate-none" />)}
            </div>
          ))}
        </div>
      ) : view === 'denied' ? (
        <div className="flex flex-col items-start gap-3" role="alert" data-testid="dev-space-questions-denied">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="icon-caption" aria-hidden />{t('devSpaceQuestions.denied')}</p>
          {deniedReasons.length ? <p className="text-xs text-muted-foreground">{t('devSpaceQuestions.deniedReason', { reason: deniedReasons.join(', ') })}</p> : null}
          <Button type="button" size="sm" variant="outline" onClick={() => void generate()}>{t('devSpaceQuestions.retry')}</Button>
        </div>
      ) : view === 'empty' ? (
        <div className="flex flex-col items-start gap-3" data-testid="dev-space-questions-empty">
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Sparkles className="icon-caption" aria-hidden />{t('devSpaceQuestions.emptyTitle')}</p>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('devSpaceQuestions.emptyDescription')}</p>
          <Button type="button" size="sm" disabled={generating} onClick={() => void generate()} data-testid="dev-space-questions-generate">
            {generating ? <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden /> : <Play className="icon-caption" aria-hidden />}
            {t('devSpaceQuestions.emptyAction')}
          </Button>
        </div>
      ) : view === 'error' ? (
        <div className="flex flex-col items-start gap-3" role="alert" data-testid="dev-space-questions-error">
          <p className="text-sm text-destructive">{t(errorKey ?? 'devSpaceQuestions.error')}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void (newestEntryId ? load(newestEntryId) : generate())} data-testid="dev-space-questions-retry">
            <RefreshCw className="icon-caption" aria-hidden />{t('devSpaceQuestions.retry')}
          </Button>
        </div>
      ) : doc ? (
        <div ref={gridRef} role="list" onKeyDown={handleGridKeyDown} className="grid gap-4 lg:grid-cols-3" data-testid="dev-space-questions-grid">
          {columns.map((column, columnIndex) => (
            <section key={column.block} role="listitem" className="min-w-0 space-y-2" aria-labelledby={`dev-space-questions-block-${column.block}`} data-testid={`dev-space-questions-block-${column.block}`}>
              <h3 id={`dev-space-questions-block-${column.block}`} className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {t(DEV_SPACE_QUESTION_BLOCK_KEYS[column.block])}
                <Badge variant={column.questions.length === DEV_SPACE_QUESTIONS_PER_BLOCK ? 'secondary' : 'outline'} data-testid={`dev-space-questions-count-${column.block}`}>
                  {t('devSpaceQuestions.count', { count: column.questions.length })}
                </Badge>
                {column.block === 'security' && securityBadgeKey ? (
                  <Badge variant="outline" data-testid="dev-space-questions-security-badge">{t(securityBadgeKey)}</Badge>
                ) : null}
              </h3>
              {column.block === 'security' ? (
                <p className="text-xs text-muted-foreground" data-testid="dev-space-questions-security-note">
                  {t('devSpaceQuestions.security.note', { packages: doc.security.sbom.packageCount, vulnerabilities: doc.security.cve.vulnerabilityCount })}
                </p>
              ) : null}
              {column.questions.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid={`dev-space-questions-pending-${column.block}`}>{t('devSpaceQuestions.blockPending')}</p>
              ) : (
                <ul className="list-none space-y-2 p-0">
                  {column.questions.map((question, row) => (
                    <li key={question.id} data-question-cell={`${columnIndex}:${row}`}>
                      <QuestionCard
                        question={question}
                        expandedWhy={!!expandedWhy[question.id]}
                        answer={answers[question.id]}
                        tourAvailable={tours.some((tour) => matchesDevSpaceQuestionTour(tour, column.block, row))}
                        onToggleWhy={() => setExpandedWhy((previous) => ({ ...previous, [question.id]: !previous[question.id] }))}
                        onAnswer={() => void loadAnswer(question)}
                        onWatchTour={() => onWatchTour(column.block, row)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </section>
  )
}

interface QuestionCardProps {
  question: DevSpaceQuestion
  expandedWhy: boolean
  answer?: AnswerState
  tourAvailable: boolean
  onToggleWhy: () => void
  onAnswer: () => void
  onWatchTour: () => void
}

function QuestionCard({ question, expandedWhy, answer, tourAvailable, onToggleWhy, onAnswer, onWatchTour }: QuestionCardProps) {
  const { t } = useTranslation()
  return (
    <article className="rounded-[var(--radius-card)] border border-border-subtle p-3" data-testid={`dev-space-question-${question.block}-${question.id}`}>
      <h4 className="text-sm font-medium">{question.text}</h4>
      <button type="button" onClick={onToggleWhy} aria-expanded={expandedWhy} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground" data-testid={`dev-space-question-why-${question.id}`}>
        {expandedWhy ? <ChevronDown className="icon-caption" aria-hidden /> : <ChevronRight className="icon-caption" aria-hidden />}
        {t('devSpaceQuestions.why.toggle')}
      </button>
      {expandedWhy ? (
        <ul className="mt-1 list-none space-y-0.5 p-0 text-xs text-muted-foreground" data-testid={`dev-space-question-why-body-${question.id}`}>
          {WHY_FIELDS.map((field) => {
            const value = question.why[field]
            return value ? <li key={field}><span className="font-medium">{t(DEV_SPACE_WHY_KEYS[field])}: </span>{value}</li> : null
          })}
          <li className="font-mono">{t('devSpaceQuestions.why.source', { kind: question.source.kind, ref: question.source.ref })}</li>
        </ul>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onAnswer} data-testid={`dev-space-question-answer-${question.id}`}>{t('devSpaceQuestions.answerText')}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={!tourAvailable} title={tourAvailable ? undefined : t('devSpaceQuestions.tourUnavailable')} onClick={onWatchTour} data-testid={`dev-space-question-tour-${question.id}`}>
          <Play className="icon-caption" aria-hidden />{t('devSpaceQuestions.watchTour')}
        </Button>
      </div>
      {answer ? (
        <div className="mt-2 text-sm" data-testid={`dev-space-question-answer-body-${question.id}`}>
          {answer.status === 'loading' ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden />{t('devSpaceQuestions.answerLoading')}</p>
          ) : answer.status === 'error' ? (
            <p className="text-xs text-destructive" role="alert">{t(answer.errorKey ?? 'devSpaceQuestions.answerUnavailable')}</p>
          ) : answer.format === 'md' ? (
            <div className="dev-space-markdown"><Markdown mode="full">{answer.text ?? ''}</Markdown></div>
          ) : (
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-hover p-3 text-xs"><code>{answer.text ?? ''}</code></pre>
          )}
        </div>
      ) : null}
    </article>
  )
}