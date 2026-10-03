/**
 * Built-in AI on the Project screen: dump raw intent → clarifying questions →
 * spec proposal (goal, DoD, milestones with stages, requirements by kind with
 * acceptance criteria, risks, open questions) → accept per item. Also
 * «Улучшить текст». Runs on the model new sessions use in this workspace;
 * nothing is sent until the user presses a button, nothing is overwritten
 * without an explicit «Принять».
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, HelpCircle, Sparkles, Wand2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  proposalItemId,
  proposalItemKeys,
  type ProposalItemKey,
  type RoadmapAiAnswer,
  type RoadmapAiResponse,
  type RoadmapProposal,
} from '@rox/shared/projects/roadmap-ai'
import type { ProjectRoadmap } from '@rox/shared/projects/roadmap'
import { TextButton } from './roadmap-ui'
import { RoadmapModelResult } from './RoadmapModelResult'

export interface AiStatus {
  available: boolean
  connectionName?: string
  model?: string
  reason?: string
}

export type ImproveTarget = 'brief' | 'goal' | 'expectedResult'

export interface ImproveProposal {
  target: ImproveTarget
  before: string
  after: string
  roadmapRevision?: string
}

interface PersistedAiState {
  brief: string
  questions: string[]
  answers: Record<number, string>
  proposal: RoadmapProposal | null
  decided: string[]
  model?: string
  proposalRevision?: string
}

const EMPTY_STATE: PersistedAiState = { brief: '', questions: [], answers: {}, proposal: null, decided: [] }

function storageKey(projectId: string): string {
  return `rox.project-ai.${projectId}`
}

function loadState(projectId: string): PersistedAiState {
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (!raw) return EMPTY_STATE
    const parsed = JSON.parse(raw) as Partial<PersistedAiState>
    return {
      brief: typeof parsed.brief === 'string' ? parsed.brief : '',
      questions: Array.isArray(parsed.questions) ? parsed.questions.filter((q): q is string => typeof q === 'string') : [],
      answers: parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : {},
      proposal: parsed.proposal && typeof parsed.proposal === 'object' ? (parsed.proposal as RoadmapProposal) : null,
      decided: Array.isArray(parsed.decided) ? parsed.decided.filter((d): d is string => typeof d === 'string') : [],
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
      proposalRevision: typeof parsed.proposalRevision === 'string' ? parsed.proposalRevision : undefined,
    }
  } catch {
    return EMPTY_STATE
  }
}

function errorText(t: (k: string, o?: Record<string, unknown>) => string, res: Extract<RoadmapAiResponse, { ok: false }>): string {
  if (res.error === 'unparseable') return t('projectRoadmap.ai.errorUnparseable')
  if (res.error === 'empty') return t('projectRoadmap.ai.briefEmpty')
  if (res.unavailable) return t('projectRoadmap.ai.unavailableBody')
  return t('projectRoadmap.ai.errorGeneric', { error: res.error })
}

function ItemActions({ onAccept, onReject }: { onAccept: () => void; onReject: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={onAccept}
        data-testid="project-ai-accept"
        className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-success hover:bg-success/10"
      >
        <Check className="h-3 w-3" />
        {t('projectRoadmap.ai.accept')}
      </button>
      <button
        type="button"
        onClick={onReject}
        aria-label={t('projectRoadmap.ai.reject')}
        title={t('projectRoadmap.ai.reject')}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function DiffText({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {before ? (
        <div className="rounded-md bg-destructive/[0.06] px-2 py-1 text-[12px] leading-5 text-muted-foreground line-through decoration-destructive/40">
          {before}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground/70">{t('projectRoadmap.ai.wasEmpty')}</div>
      )}
      <div className="rounded-md bg-success/[0.08] px-2 py-1 text-[12px] leading-5 text-foreground">{after}</div>
    </div>
  )
}

export function ProjectAiPanel({
  projectId,
  roadmap,
  status,
  runAi,
  result,
  onAccept,
  improve,
  onImproveDone,
  onApplyImprove,
}: {
  projectId: string
  roadmap: ProjectRoadmap
  status: AiStatus | null
  result?: RoadmapAiResponse | null
  runAi: (request: { mode: 'clarify' | 'spec' | 'improve'; text: string; answers?: RoadmapAiAnswer[] }) => Promise<RoadmapAiResponse>
  onAccept: (proposal: RoadmapProposal, keys: ProposalItemKey[], expectedRevision?: string) => Promise<string>
  /** Improve request coming from a field (goal / expected result). */
  improve: ImproveProposal | null
  onImproveDone: () => void
  onApplyImprove: (proposal: ImproveProposal) => Promise<void>
}) {
  const { t } = useTranslation()
  const [state, setState] = React.useState<PersistedAiState>(() => loadState(projectId))
  const [busy, setBusy] = React.useState<null | 'clarify' | 'spec' | 'improve'>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [briefImprove, setBriefImprove] = React.useState<string | null>(null)
  const deciding = React.useRef(false)
  const alive = React.useRef(true)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  React.useEffect(() => setState(loadState(projectId)), [projectId])
  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify(state))
    } catch {
      // storage full — the draft simply won't survive a reload
    }
  }, [projectId, state])

  const available = status?.available === true
  const canRun = available && !busy && state.brief.trim().length > 0

  const answers: RoadmapAiAnswer[] = state.questions.map((question, i) => ({ question, answer: state.answers[i] ?? '' }))

  const run = async (mode: 'clarify' | 'spec' | 'improve') => {
    if (!state.brief.trim()) {
      setError(t('projectRoadmap.ai.briefEmpty'))
      return
    }
    setBusy(mode)
    setError(null)
    try {
      const res = await runAi({ mode, text: state.brief, ...(mode === 'spec' ? { answers } : {}) })
      if (!alive.current) return
      if (!res.ok) {
        setError(errorText(t, res))
        return
      }
      if (res.mode === 'clarify') setState((s) => ({ ...s, questions: res.questions, answers: {}, model: res.model }))
      else if (res.mode === 'spec') setState((s) => ({ ...s, proposal: res.proposal, decided: [], model: res.model, proposalRevision: res.roadmapRevision }))
      else setBriefImprove(res.text)
    } catch (err) {
      if (alive.current) setError(t('projectRoadmap.ai.errorGeneric', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  const proposal = state.proposal
  const pending = proposal ? proposalItemKeys(proposal).filter((k) => !state.decided.includes(proposalItemId(k))) : []
  const decide = async (keys: ProposalItemKey[], accept: boolean) => {
    if (!proposal || !keys.length || deciding.current) return
    const pendingKeys = keys.filter(key => !state.decided.includes(proposalItemId(key)))
    if (!pendingKeys.length) return
    deciding.current = true
    setError(null)
    try {
      const revision = accept ? await onAccept(proposal, pendingKeys, state.proposalRevision) : state.proposalRevision
      if (alive.current) setState((s) => s.proposal !== proposal ? s : ({ ...s, proposalRevision: revision, decided: [...new Set([...s.decided, ...pendingKeys.map(proposalItemId)])] }))
    } catch {
      if (alive.current) setError(t('projectRoadmap.saveFailed'))
    } finally {
      deciding.current = false
    }
  }
  const isPending = (key: ProposalItemKey) => !state.decided.includes(proposalItemId(key))

  const sectionTitle = (text: string) => (
    <div className="mt-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">{text}</div>
  )

  return (
    <div className="min-w-0 rounded-lg bg-foreground/[0.03] p-2" data-testid="project-ai-panel">
      <div className="flex min-w-0 items-center gap-2 px-1 pb-1">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="text-[13px] font-semibold text-foreground/90">{t('projectRoadmap.ai.title')}</span>
        <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground" data-testid="project-ai-model">
          {status === null
            ? t('projectRoadmap.ai.checking')
            : available
              ? t('projectRoadmap.ai.requestedConnection', { model: status.model ?? '—', connection: status.connectionName ?? '' })
              : t('projectRoadmap.ai.unavailable')}
        </span>
      </div>

      {status !== null && !available ? (
        <p className="px-1 pb-1 text-[12px] leading-5 text-muted-foreground" data-testid="project-ai-unavailable">
          {t('projectRoadmap.ai.unavailableBody')}
        </p>
      ) : null}

      <textarea
        value={state.brief}
        onChange={(e) => setState((s) => ({ ...s, brief: e.target.value }))}
        rows={5}
        disabled={status !== null && !available}
        data-testid="project-ai-brief"
        aria-label={t('projectRoadmap.ai.briefLabel')}
        placeholder={t('projectRoadmap.ai.briefPlaceholder')}
        className="block w-full resize-y rounded-md bg-background/70 px-2 py-1.5 text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/70 focus:bg-background disabled:opacity-60"
      />

      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
        <TextButton onClick={() => void run('clarify')} disabled={!canRun} testId="project-ai-clarify">
          <HelpCircle className="h-3.5 w-3.5" />
          {busy === 'clarify' ? t('projectRoadmap.ai.thinking') : t('projectRoadmap.ai.clarify')}
        </TextButton>
        <TextButton tone="primary" onClick={() => void run('spec')} disabled={!canRun} testId="project-ai-spec">
          <Sparkles className="h-3.5 w-3.5" />
          {busy === 'spec' ? t('projectRoadmap.ai.thinking') : t('projectRoadmap.ai.buildSpec')}
        </TextButton>
        <TextButton tone="ghost" onClick={() => void run('improve')} disabled={!canRun} testId="project-ai-improve">
          <Wand2 className="h-3.5 w-3.5" />
          {busy === 'improve' ? t('projectRoadmap.ai.thinking') : t('projectRoadmap.ai.improve')}
        </TextButton>
      </div>
      {available ? <p className="mt-1 px-1 text-[11px] leading-4 text-muted-foreground/80">{t('projectRoadmap.ai.consent', { model: status?.model ?? '—' })}</p> : null}
      <RoadmapModelResult result={result ?? null} t={t} />
      {error ? <p className="mt-1 px-1 text-[12px] text-destructive" role="alert">{error}</p> : null}

      {briefImprove !== null ? (
        <div className="mt-2 min-w-0 rounded-md bg-background/60 p-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[12px] font-medium">{t('projectRoadmap.ai.improvedBrief')}</span>
            <div className="ml-auto">
              <ItemActions
                onAccept={() => {
                  setState((s) => ({ ...s, brief: briefImprove }))
                  setBriefImprove(null)
                }}
                onReject={() => setBriefImprove(null)}
              />
            </div>
          </div>
          <DiffText before={state.brief} after={briefImprove} />
        </div>
      ) : null}

      {improve ? (
        <div className="mt-2 min-w-0 rounded-md bg-background/60 p-2" data-testid="project-ai-field-improve">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[12px] font-medium">{t(`projectRoadmap.ai.improvedField.${improve.target}`)}</span>
            <div className="ml-auto">
              <ItemActions
                onAccept={() => {
                  if (deciding.current) return
                  deciding.current = true
                  void onApplyImprove(improve).then(() => {
                    if (alive.current) onImproveDone()
                  }).catch(() => {
                    if (alive.current) setError(t('projectRoadmap.saveFailed'))
                  }).finally(() => { deciding.current = false })
                }}
                onReject={onImproveDone}
              />
            </div>
          </div>
          <DiffText before={improve.before} after={improve.after} />
        </div>
      ) : null}

      {state.questions.length ? (
        <div className="mt-2 min-w-0" data-testid="project-ai-questions">
          {sectionTitle(t('projectRoadmap.ai.questions'))}
          <div className="flex flex-col gap-1.5 pt-1">
            {state.questions.map((q, i) => (
              <label key={`${i}-${q}`} className="block min-w-0 px-1">
                <span className="block text-[12px] leading-5 text-foreground/90">{q}</span>
                <input
                  value={state.answers[i] ?? ''}
                  onChange={(e) => setState((s) => ({ ...s, answers: { ...s.answers, [i]: e.target.value } }))}
                  placeholder={t('projectRoadmap.ai.answerPlaceholder')}
                  className="mt-0.5 h-7 w-full rounded-md bg-background/70 px-2 text-[12px] outline-none focus:bg-background"
                />
              </label>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1 px-1">
            <TextButton tone="primary" onClick={() => void run('spec')} disabled={!canRun}>
              {busy === 'spec' ? t('projectRoadmap.ai.thinking') : t('projectRoadmap.ai.buildSpecWithAnswers')}
            </TextButton>
            <TextButton tone="ghost" onClick={() => setState((s) => ({ ...s, questions: [], answers: {} }))}>
              {t('projectRoadmap.ai.dismissQuestions')}
            </TextButton>
          </div>
        </div>
      ) : null}

      {proposal ? (
        <div className="mt-2 min-w-0" data-testid="project-ai-proposal">
          <div className="flex min-w-0 flex-wrap items-center gap-1 px-1">
            <span className="text-[12px] font-semibold text-foreground/90">{t('projectRoadmap.ai.proposal')}</span>
            <span className="text-[11px] text-muted-foreground">
              {pending.length ? t('projectRoadmap.ai.pendingCount', { count: pending.length }) : t('projectRoadmap.ai.allDecided')}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {pending.length ? (
                <>
                  <TextButton tone="ghost" onClick={() => decide(pending, false)}>{t('projectRoadmap.ai.rejectAll')}</TextButton>
                  <TextButton onClick={() => decide(pending, true)} testId="project-ai-accept-all">{t('projectRoadmap.ai.acceptAll')}</TextButton>
                </>
              ) : (
                <TextButton tone="ghost" onClick={() => setState((s) => ({ ...s, proposal: null, decided: [] }))}>{t('projectRoadmap.ai.clearProposal')}</TextButton>
              )}
            </div>
          </div>

          {proposal.goal && isPending({ section: 'goal' }) ? (
            <>
              {sectionTitle(t('projectRoadmap.goal'))}
              <div className="flex min-w-0 items-start gap-2 px-1 pt-1">
                <div className="min-w-0 flex-1"><DiffText before={roadmap.goal} after={proposal.goal} /></div>
                <ItemActions onAccept={() => decide([{ section: 'goal' }], true)} onReject={() => decide([{ section: 'goal' }], false)} />
              </div>
            </>
          ) : null}
          {proposal.expectedResult && isPending({ section: 'expectedResult' }) ? (
            <>
              {sectionTitle(t('projectRoadmap.expectedResult'))}
              <div className="flex min-w-0 items-start gap-2 px-1 pt-1">
                <div className="min-w-0 flex-1"><DiffText before={roadmap.expectedResult} after={proposal.expectedResult} /></div>
                <ItemActions onAccept={() => decide([{ section: 'expectedResult' }], true)} onReject={() => decide([{ section: 'expectedResult' }], false)} />
              </div>
            </>
          ) : null}

          <ProposalList
            title={t('projectRoadmap.doneCriteria')}
            items={proposal.doneCriteria.map((text, index) => ({ key: { section: 'doneCriteria', index } as ProposalItemKey, body: <span>{text}</span> }))}
            isPending={isPending}
            decide={decide}
            sectionTitle={sectionTitle}
          />
          <ProposalList
            title={t('projectRoadmap.milestones')}
            items={proposal.milestones.map((m, index) => ({
              key: { section: 'milestones', index } as ProposalItemKey,
              body: (
                <div className="min-w-0">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-medium">{m.title}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{t('projectRoadmap.ai.days', { count: m.durationDays })}</span>
                  </div>
                  {m.description ? <div className="text-[12px] text-muted-foreground">{m.description}</div> : null}
                  {m.stages.length ? (
                    <ul className="mt-0.5 text-[12px] text-foreground/80">
                      {m.stages.map((s, si) => (
                        <li key={si} className="min-w-0">
                          <span className="text-muted-foreground">— </span>{s.title}
                          {s.substages.length ? <span className="text-muted-foreground"> ({s.substages.join('; ')})</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ),
            }))}
            isPending={isPending}
            decide={decide}
            sectionTitle={sectionTitle}
          />
          <ProposalList
            title={t('projectRoadmap.requirements')}
            items={proposal.requirements.map((r, index) => ({
              key: { section: 'requirements', index } as ProposalItemKey,
              body: (
                <div className="min-w-0">
                  <span className="mr-1 rounded-xs bg-foreground/[0.06] px-1 text-[11px] text-muted-foreground">{t(`projectRoadmap.requirementKind.${r.kind}`)}</span>
                  {r.text}
                  {r.acceptance.length ? (
                    <ul className="mt-0.5 text-[12px] text-muted-foreground">
                      {r.acceptance.map((a, ai) => <li key={ai}>✓ {a}</li>)}
                    </ul>
                  ) : null}
                </div>
              ),
            }))}
            isPending={isPending}
            decide={decide}
            sectionTitle={sectionTitle}
          />
          <ProposalList
            title={t('projectRoadmap.risks')}
            items={proposal.risks.map((text, index) => ({ key: { section: 'risks', index } as ProposalItemKey, body: <span>{text}</span> }))}
            isPending={isPending}
            decide={decide}
            sectionTitle={sectionTitle}
          />
          <ProposalList
            title={t('projectRoadmap.openQuestions')}
            items={proposal.openQuestions.map((text, index) => ({ key: { section: 'openQuestions', index } as ProposalItemKey, body: <span>{text}</span> }))}
            isPending={isPending}
            decide={decide}
            sectionTitle={sectionTitle}
          />

        </div>
      ) : null}
    </div>
  )
}

function ProposalList({
  title,
  items,
  isPending,
  decide,
  sectionTitle,
}: {
  title: string
  items: { key: ProposalItemKey; body: React.ReactNode }[]
  isPending: (key: ProposalItemKey) => boolean
  decide: (keys: ProposalItemKey[], accept: boolean) => void
  sectionTitle: (text: string) => React.ReactNode
}) {
  const visible = items.filter((i) => isPending(i.key))
  if (!visible.length) return null
  return (
    <>
      {sectionTitle(title)}
      <div className="flex flex-col">
        {visible.map((item) => (
          <div key={proposalItemId(item.key)} className={cn('flex min-w-0 items-start gap-2 rounded-md px-1 py-1 text-[13px] leading-5 hover:bg-foreground/[0.03]')}>
            <div className="min-w-0 flex-1">{item.body}</div>
            <ItemActions onAccept={() => decide([item.key], true)} onReject={() => decide([item.key], false)} />
          </div>
        ))}
      </div>
    </>
  )
}
