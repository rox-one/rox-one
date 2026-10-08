/**
 * Обучение — self-improvement dashboard over the real `learning:*` RPC surface.
 *
 * Views (PRD §25-30): dashboard (§26) · candidates (§27) · skills (§28) ·
 * timeline (§29) · help (§25). Candidates are *hypotheses*: nothing here is
 * durable until a validator promoted it, and every action is reversible (§3.6).
 *
 * Host contract: older hosts answer `UNSUPPORTED_OPERATION`, so an unavailable
 * host renders an explanatory state instead of crashing. There is no
 * `learning CHANGED` push channel yet, so every own mutation refetches.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChevronRight, GraduationCap, HelpCircle, Layers, ListTree, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { EffectivenessReport, PromotionResult, RollbackResult } from '@rox/server-core/memory/learning/learning-types'
import type {
  EffectivenessComponents,
  LearningCandidate,
  LearningCandidateStatus,
  LearningCandidateType,
  LearningEvidenceType,
  LearningPolicy,
  LearningScope,
  LearningStatsDto,
  LearningTimelineEntryDto,
  ValidationPassResult,
} from '@rox/shared/memory/learning'
import { cn } from '@/lib/utils'
import { formatHotkeyDisplay } from '@/lib/platform'
import { ShellSidebarPortal, useShellSidebarTarget } from '@/components/app-shell/ShellSidebarPortal'
import {
  LEARNING_EVIDENCE_TYPES,
  LEARNING_SCOPES,
  LEARNING_STATUSES,
  LEARNING_TYPES,
  TIMELINE_KINDS,
  approvedSkills,
  averageConfidence,
  confidenceRows,
  countCandidates,
  effectivenessBand,
  failedPasses,
  groupTimeline,
  matchesCandidateFilter,
  skillQueue,
  sortCandidates,
  type LearningFilter,
  type LearningSort,
  type LearningView,
} from '@/lib/learning-model'

/** `runSkillCuration` has no exported DTO name in server-core, so the shape is repeated here. */
interface SkillCurationItem {
  slug: string
  action: 'keep' | 'improve' | 'archive'
}

const VIEWS: readonly LearningView[] = ['dashboard', 'candidates', 'skills', 'timeline', 'help']
const SORTS: readonly LearningSort[] = ['recency', 'confidence', 'status']
const MUTATION_TARGETS = ['lesson', 'skill', 'policy', 'memory'] as const
const MUTATION_STATUSES = ['applied', 'confirmed', 'reverted'] as const
const POLICY_STATUSES = ['candidate', 'active', 'rolled_back'] as const
const EFFECTIVENESS_COMPONENTS: readonly (keyof EffectivenessComponents)[] = [
  'successRate', 'reuseRate', 'confidence', 'correctionRate', 'conflictRate',
]

type ActionResult =
  | { kind: 'promotion'; id: string; promotion: PromotionResult }
  | { kind: 'rollback'; id: string; rollback: RollbackResult }

export interface LearningScreenProps {
  workspaceId?: string
}

function FacetTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">{children}</div>
}

function FacetItem({ label, count, active, onClick, tone, testId }: {
  label: React.ReactNode
  count?: number
  active?: boolean
  onClick: () => void
  tone?: 'danger' | 'accent'
  testId?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex min-h-8 w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        active ? 'bg-foreground/[0.09] font-semibold text-foreground' : 'text-text-secondary hover:bg-foreground/[0.05] hover:text-foreground',
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate', tone === 'danger' && 'text-destructive', tone === 'accent' && 'text-accent')}>{label}</span>
      {count != null ? <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{count}</span> : null}
    </button>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-baseline gap-3 py-1.5 text-[12px]">
      <span className="text-text-muted">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'danger' | 'accent' | 'muted' | 'warning' }) {
  return (
    <span className={cn(
      'inline-flex h-[18px] max-w-[200px] shrink-0 items-center truncate rounded-[var(--radius-control)] px-1.5 text-[11px]',
      tone === 'danger' ? 'bg-destructive/12 text-destructive'
        : tone === 'warning' ? 'bg-[var(--warning,#d9a13b)]/15 text-[var(--warning,#a8761f)]'
        : tone === 'accent' ? 'bg-accent/15 text-accent'
        : tone === 'muted' ? 'bg-foreground/[0.04] text-text-muted'
        : 'bg-foreground/[0.07] text-text-secondary',
    )}>
      {children}
    </span>
  )
}

function Meter({ value, label, testId }: { value: number; label: string; testId?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <div className="relative h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-foreground/[0.1]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">{pct}%</span>
    </div>
  )
}

function Btn({ children, onClick, danger, primary, disabled, testId, title }: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
  primary?: boolean
  disabled?: boolean
  testId?: string
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-2.5 text-[12px] font-medium outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        primary ? 'bg-accent text-[var(--accent-foreground,white)] hover:brightness-110'
          : danger ? 'bg-destructive/12 text-destructive hover:bg-destructive/20'
          : 'bg-foreground/[0.07] text-foreground hover:bg-foreground/[0.11]',
      )}
    >
      {children}
    </button>
  )
}

function Confirm({ title, body, confirmLabel, onConfirm, onCancel, children }: {
  title: string
  body?: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => { ref.current?.focus() }, [])
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[14vh]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}
    >
      <div role="alertdialog" aria-modal="true" aria-label={title} className="w-[min(520px,92vw)] rounded-[var(--radius-overlay)] bg-background p-4 shadow-modal-small ring-1 ring-foreground/15">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {body ? <div className="mt-2 text-[13px] text-text-secondary">{body}</div> : null}
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={onCancel}>{t('learning.screen.cancel')}</Btn>
          <button ref={ref} type="button" onClick={onConfirm} data-testid="learning-confirm" className="inline-flex h-7 items-center rounded-[var(--radius-control)] bg-destructive px-2.5 text-[12px] font-medium text-white hover:brightness-110 focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Dashboard counters, in render order (§26). */
const STAT_KEYS: readonly (keyof LearningStatsDto)[] = [
  'observations', 'candidates', 'activeCandidates', 'rejectedCandidates', 'outcomes', 'mutations', 'revertedMutations', 'policies',
]

const STATUS_TONE: Record<LearningCandidateStatus, 'muted' | 'accent' | 'warning' | 'danger'> = {
  candidate: 'warning',
  validating: 'accent',
  approved: 'accent',
  active: 'accent',
  rejected: 'danger',
  rolled_back: 'muted',
}

export function LearningScreen({ workspaceId }: LearningScreenProps) {
  const { t, i18n } = useTranslation()
  const sidebarTarget = useShellSidebarTarget()

  const [view, setView] = React.useState<LearningView>('dashboard')
  const [candidates, setCandidates] = React.useState<LearningCandidate[] | null>(null)
  const [stats, setStats] = React.useState<LearningStatsDto | null>(null)
  const [timeline, setTimeline] = React.useState<LearningTimelineEntryDto[]>([])
  const [policies, setPolicies] = React.useState<LearningPolicy[]>([])
  const [curation, setCuration] = React.useState<SkillCurationItem[] | null>(null)
  const [effectiveness, setEffectiveness] = React.useState<ReadonlyMap<string, EffectivenessReport | null>>(new Map())
  const [filter, setFilter] = React.useState<LearningFilter>({})
  const [sort, setSort] = React.useState<LearningSort>('recency')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [rejectReason, setRejectReason] = React.useState('')
  const [result, setResult] = React.useState<ActionResult | null>(null)
  const [confirm, setConfirm] = React.useState<null | { action: 'approve' | 'reject' | 'rollback'; candidate: LearningCandidate }>(null)
  const [busy, setBusy] = React.useState(false)
  const [loadError, setLoadError] = React.useState(false)
  const [unavailable, setUnavailable] = React.useState(false)
  const [writeDenied, setWriteDenied] = React.useState(false)
  const [filtersOpen, setFiltersOpen] = React.useState(false)

  const loadGeneration = React.useRef(0)
  const currentWorkspace = React.useRef(workspaceId)
  currentWorkspace.current = workspaceId
  const searchRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const optionPrefix = React.useId()

  const readAvailable = typeof window.electronAPI?.listLearningCandidates === 'function'
  const writeAvailable = typeof window.electronAPI?.approveLearningCandidate === 'function'
    && typeof window.electronAPI?.rejectLearningCandidate === 'function'
  const ready = readAvailable && Boolean(workspaceId)

  const load = React.useCallback(() => {
    if (currentWorkspace.current !== workspaceId) return
    const generation = ++loadGeneration.current
    setLoadError(false)
    if (!readAvailable || !workspaceId) {
      ++loadGeneration.current
      setUnavailable(true)
      setCandidates([])
      setStats(null)
      setTimeline([])
      setPolicies([])
      return
    }
    setUnavailable(false)
    void Promise.allSettled([
      window.electronAPI.listLearningCandidates(workspaceId),
      window.electronAPI.getLearningStats(workspaceId),
      window.electronAPI.getLearningTimeline(workspaceId, 200),
      window.electronAPI.getLearningPolicy(workspaceId),
    ]).then(([listed, statsResult, timelineResult, policiesResult]) => {
      if (generation !== loadGeneration.current) return
      if (listed.status === 'rejected') {
        if ((listed.reason as { code?: string } | undefined)?.code === 'UNSUPPORTED_OPERATION') { setUnavailable(true); setCandidates([]); return }
        setLoadError(true)
        return
      }
      setCandidates(listed.value)
      setStats(statsResult.status === 'fulfilled' ? statsResult.value : null)
      setTimeline(timelineResult.status === 'fulfilled' ? timelineResult.value : [])
      setPolicies(policiesResult.status === 'fulfilled' ? policiesResult.value : [])
    })
  }, [workspaceId, readAvailable])

  React.useEffect(() => {
    setCandidates(null)
    setStats(null)
    setTimeline([])
    setPolicies([])
    setCuration(null)
    setEffectiveness(new Map())
    setSelectedId(null)
    setResult(null)
    setBusy(false)
    setLoadError(false)
    setUnavailable(false)
    setWriteDenied(false)
    load()
    return () => { ++loadGeneration.current }
  }, [load])

  const all = candidates ?? []
  const counts = React.useMemo(() => countCandidates(all), [all])
  const visible = React.useMemo(() => sortCandidates(all.filter((candidate) => matchesCandidateFilter(candidate, filter)), sort), [all, filter, sort])
  const visibleIndexes = React.useMemo(() => new Map(visible.map((candidate, index) => [candidate.id, index])), [visible])
  const selected = selectedId ? all.find((candidate) => candidate.id === selectedId) : undefined
  const queue = React.useMemo(() => sortCandidates(skillQueue(all), 'confidence'), [all])
  const approved = React.useMemo(() => approvedSkills(all), [all])
  const avgConfidence = React.useMemo(() => averageConfidence(all), [all])

  const dateFmt = React.useMemo(() => new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }), [i18n.language])
  const fmt = (iso?: string) => (iso && Date.parse(iso) ? dateFmt.format(new Date(iso)) : '—')

  const statusLabel = (status: LearningCandidateStatus) => t(`learning.screen.status.${status}`)
  const typeLabel = (type: LearningCandidateType) => t(`learning.screen.type.${type}`)
  const scopeLabel = (scope: LearningScope) => t(`learning.screen.scope.${scope}`)
  const evidenceLabel = (type: LearningEvidenceType) => t(`learning.screen.evidenceType.${type}`)
  const passLabel = (pass: ValidationPassResult['pass']) => t(`learning.screen.validationPass.${pass}`)
  const kindLabel = (kind: LearningTimelineEntryDto['kind']) => t(`learning.screen.timeline.kind.${kind}`)

  const clearFacets = () => { setSelectedId(null); setFiltersOpen(false); setFilter({}) }
  const toggleFacet = (key: 'status' | 'type' | 'scope', value: string) => {
    setSelectedId(null)
    setFiltersOpen(false)
    setFilter((prev) => {
      const next: LearningFilter = { ...prev }
      if (key === 'status') next.status = prev.status === value ? undefined : value as LearningCandidateStatus
      else if (key === 'type') next.type = prev.type === value ? undefined : value as LearningCandidateType
      else next.scope = prev.scope === value ? undefined : value as LearningScope
      return next
    })
  }
  const activeFacets = (Object.keys(filter) as Array<keyof LearningFilter>).filter((key) => key !== 'query' && filter[key] != null).length

  const onListKey = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select')) return
    const index = selected ? visible.findIndex((candidate) => candidate.id === selectedId) : -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.min(visible.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
      const next = visible[nextIndex]
      if (next) setSelectedId(next.id)
    } else if (event.key === 'Escape') {
      setSelectedId(null)
    } else if (event.key === 'Enter' && !selected && visible[0]) {
      setSelectedId(visible[0].id)
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && /\S/.test(event.key)) {
      searchRef.current?.focus()
    }
  }

  const run = async (fn: () => Promise<unknown>, okKey?: string) => {
    setBusy(true)
    try {
      await fn()
      if (okKey && currentWorkspace.current === workspaceId) toast.success(t(okKey))
    } catch (error) {
      if (currentWorkspace.current !== workspaceId) return
      const code = (error as { code?: string } | undefined)?.code
      if (code === 'AUTH_FAILED') setWriteDenied(true)
      else if (code === 'UNSUPPORTED_OPERATION') setUnavailable(true)
      else toast.error(t('learning.screen.toast.failed'), { description: error instanceof Error ? error.message : String(error) })
    } finally {
      if (currentWorkspace.current === workspaceId) { setBusy(false); load() }
    }
  }

  const approveCandidate = (candidate: LearningCandidate) => void run(async () => {
    const promotion = await window.electronAPI.approveLearningCandidate(workspaceId as string, candidate.id)
    if (currentWorkspace.current === workspaceId) setResult({ kind: 'promotion', id: candidate.id, promotion })
  }, 'learning.screen.toast.approved')
  const rejectCandidate = (candidate: LearningCandidate, reason: string) => void run(async () => {
    await window.electronAPI.rejectLearningCandidate(workspaceId as string, candidate.id, reason.trim() || undefined)
    if (currentWorkspace.current === workspaceId) { setResult(null); setRejectReason('') }
  }, 'learning.screen.toast.rejected')
  const rollbackCandidate = (candidate: LearningCandidate) => void run(async () => {
    const rollback = await window.electronAPI.rollbackLearningCandidate(workspaceId as string, candidate.id)
    if (currentWorkspace.current === workspaceId) setResult({ kind: 'rollback', id: candidate.id, rollback })
  }, 'learning.screen.toast.rolledBack')
  const revalidateCandidate = (candidate: LearningCandidate) => void run(
    () => window.electronAPI.revalidateLearningCandidate(workspaceId as string, candidate.id),
    'learning.screen.toast.revalidated',
  )
  const reflectCandidate = (candidate: LearningCandidate) => {
    const sessionId = candidate.evidence.find((ref) => ref.type === 'session')?.ref
    if (!sessionId) return
    void run(() => window.electronAPI.forceLearningReflect(workspaceId as string, sessionId), 'learning.screen.toast.reflected')
  }
  const consolidate = () => void run(
    () => window.electronAPI.runLearningConsolidation(workspaceId as string).then(() => undefined),
    'learning.screen.toast.consolidated',
  )
  const curateSkills = () => void run(async () => {
    const { items } = await window.electronAPI.curateLearningSkills(workspaceId as string)
    if (currentWorkspace.current === workspaceId) setCuration(items)
  }, 'learning.screen.toast.curated')
  const runPolicies = () => void run(
    () => window.electronAPI.runPolicyLearning(workspaceId as string).then(() => undefined),
    'learning.screen.toast.policyRun',
  )

  React.useEffect(() => {
    if (view !== 'skills' || !ready || !workspaceId) return
    const generation = loadGeneration.current
    const targets = approvedSkills(candidates ?? [])
    if (targets.length === 0) return
    void Promise.all(targets.map(async (candidate) => {
      try {
        const report = await window.electronAPI.getLearningSkillEffectiveness(workspaceId, candidate.id)
        return [candidate.id, report] as const
      } catch {
        return [candidate.id, null] as const
      }
    })).then((entries) => {
      if (generation === loadGeneration.current) setEffectiveness(new Map(entries))
    })
  }, [view, ready, workspaceId, candidates])

  React.useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector<HTMLElement>(`[data-candidate-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const confirmDialog = confirm ? (
    <Confirm
      title={t(confirm.action === 'approve' ? 'learning.screen.actions.confirmApproveTitle'
        : confirm.action === 'reject' ? 'learning.screen.actions.confirmRejectTitle'
          : 'learning.screen.actions.confirmRollbackTitle')}
      body={t(confirm.action === 'approve' ? 'learning.screen.actions.confirmApproveBody'
        : confirm.action === 'reject' ? 'learning.screen.actions.confirmRejectBody'
          : 'learning.screen.actions.confirmRollbackBody', { hypothesis: confirm.candidate.hypothesis })}
      confirmLabel={t(confirm.action === 'approve' ? 'learning.screen.actions.approve'
        : confirm.action === 'reject' ? 'learning.screen.actions.reject'
          : 'learning.screen.actions.rollback')}
      onConfirm={() => {
        const { action, candidate } = confirm
        setConfirm(null)
        if (action === 'approve') approveCandidate(candidate)
        else if (action === 'reject') rejectCandidate(candidate, rejectReason)
        else rollbackCandidate(candidate)
      }}
      onCancel={() => setConfirm(null)}
    >
      {confirm.action === 'reject' ? (
        <textarea
          value={rejectReason}
          onChange={(event) => setRejectReason(event.target.value)}
          rows={3}
          aria-label={t('learning.screen.actions.reasonPlaceholder')}
          placeholder={t('learning.screen.actions.reasonPlaceholder')}
          data-testid="learning-reject-reason"
          className="mt-3 w-full resize-y rounded-[var(--radius-control)] bg-foreground/[0.05] px-2 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      ) : null}
    </Confirm>
  ) : null

  // ── Facets ───────────────────────────────────────────────────────────────
  const facets = (
    <ShellSidebarPortal className={cn(
      'w-[208px] shrink-0 flex-col overflow-y-auto bg-surface-rail px-2 pb-3 pt-2',
      selected ? 'hidden @[920px]/learning:flex' : 'hidden @[760px]/learning:flex',
      filtersOpen && 'absolute inset-y-0 left-0 z-30 flex w-[min(280px,100%)] shadow-modal-small @[760px]/learning:static @[760px]/learning:w-[208px] @[760px]/learning:shadow-none',
    )} aria-label={t('learning.screen.facets')} data-testid="learning-facets">
      {!sidebarTarget ? (
        <button type="button" onClick={() => setFiltersOpen(false)} className="mb-2 flex min-h-8 items-center justify-between rounded-[var(--radius-control)] px-2 text-sm font-medium @[760px]/learning:hidden" aria-label={t('learning.screen.closeFilters')}>
          {t('learning.screen.facets')}<X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
      <FacetTitle>{t('learning.screen.views')}</FacetTitle>
      {VIEWS.map((id) => (
        <FacetItem
          key={id}
          label={t(`learning.screen.view.${id}`)}
          count={id === 'candidates' ? all.length : id === 'skills' ? queue.length : undefined}
          active={view === id}
          onClick={() => { setView(id); setSelectedId(null); setFiltersOpen(false) }}
          testId={`learning-view-${id}`}
        />
      ))}
      <FacetTitle>{t('learning.screen.status')}</FacetTitle>
      <FacetItem label={t('learning.screen.all')} count={all.length} active={!activeFacets} onClick={clearFacets} testId="learning-facet-all" />
      {LEARNING_STATUSES.filter((status) => (counts.status.get(status) ?? 0) > 0 || filter.status === status).map((status) => (
        <FacetItem
          key={status}
          label={statusLabel(status)}
          count={counts.status.get(status) ?? 0}
          active={filter.status === status}
          tone={STATUS_TONE[status] === 'danger' ? 'danger' : STATUS_TONE[status] === 'accent' ? 'accent' : undefined}
          onClick={() => toggleFacet('status', status)}
          testId={`learning-facet-status-${status}`}
        />
      ))}
      <FacetTitle>{t('learning.screen.type')}</FacetTitle>
      {LEARNING_TYPES.filter((type) => (counts.type.get(type) ?? 0) > 0 || filter.type === type).map((type) => (
        <FacetItem key={type} label={typeLabel(type)} count={counts.type.get(type) ?? 0} active={filter.type === type} onClick={() => toggleFacet('type', type)} testId={`learning-facet-type-${type}`} />
      ))}
      <FacetTitle>{t('learning.screen.scope')}</FacetTitle>
      {LEARNING_SCOPES.filter((scope) => (counts.scope.get(scope) ?? 0) > 0 || filter.scope === scope).map((scope) => (
        <FacetItem key={scope} label={scopeLabel(scope)} count={counts.scope.get(scope) ?? 0} active={filter.scope === scope} onClick={() => toggleFacet('scope', scope)} testId={`learning-facet-scope-${scope}`} />
      ))}
    </ShellSidebarPortal>
  )

  // ── Rows ─────────────────────────────────────────────────────────────────
  const renderRow = (candidate: LearningCandidate) => {
    const isSelected = candidate.id === selectedId
    return (
      <div
        key={candidate.id}
        id={`${optionPrefix}-${visibleIndexes.get(candidate.id)}`}
        role="option"
        aria-selected={isSelected}
        data-candidate-id={candidate.id}
        data-testid="learning-row"
        onClick={() => setSelectedId(candidate.id)}
        className={cn(
          'group mx-4 my-2.5 flex max-w-[860px] cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-3 py-3.5 transition-colors motion-reduce:transition-none @[1000px]/learning:mx-auto @[1000px]/learning:w-[calc(100%-2rem)]',
          isSelected ? 'border-l-2 border-accent/30 border-l-accent bg-accent/8' : 'border-foreground/6 bg-background/80 hover:border-foreground/15 hover:bg-background',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="break-words text-[13px] leading-5 text-foreground">{candidate.hypothesis}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip tone={STATUS_TONE[candidate.status]}>{statusLabel(candidate.status)}</Chip>
            <Chip>{typeLabel(candidate.type)}</Chip>
            <Chip tone="muted">{scopeLabel(candidate.scope)}</Chip>
            <span className="text-[11px] text-text-muted">{fmt(candidate.updatedAt)}</span>
          </div>
        </div>
        <div className="w-[96px] shrink-0 pt-1">
          <Meter value={candidate.confidence} label={t('learning.screen.detail.confidence')} testId="learning-row-confidence" />
        </div>
        <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
      </div>
    )
  }

  const unavailableSection = (
    <section className="flex min-w-0 w-full flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center" data-testid="learning-unavailable">
      <span className="grid size-10 place-items-center rounded-[var(--radius-control)] bg-foreground/[0.05] text-text-muted"><AlertTriangle aria-hidden="true" className="size-5" /></span>
      <h2 className="text-base font-semibold">{t('learning.screen.title')}</h2>
      <p className="max-w-[440px] text-[13px] leading-6 text-text-secondary">{t('learning.screen.unavailable.body')}</p>
      <Btn onClick={load} testId="learning-retry">{t('learning.screen.retry')}</Btn>
    </section>
  )

  // ── Candidate list ───────────────────────────────────────────────────────
  const list = (
    <section className={cn('min-w-0 flex-1 flex-col bg-foreground/[0.025]', selected ? 'hidden @[920px]/learning:flex' : 'flex')} data-testid="learning-list">
      <header className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3 pt-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-accent/10 text-accent"><GraduationCap aria-hidden="true" className="size-5" /></span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('learning.screen.title')}</h2>
          <p className="text-xs text-text-secondary">{t('learning.screen.shown', { count: visible.length, total: all.length })}</p>
        </div>
        <span className="flex-1" />
        <Btn disabled={busy || unavailable || !writeAvailable} onClick={consolidate} testId="learning-consolidate">{t('learning.screen.dashboard.consolidate')}</Btn>
      </header>
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 pb-3">
        <div className="relative min-w-0 basis-[220px] grow">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 size-4 text-text-muted" />
          <input
            ref={searchRef}
            value={filter.query ?? ''}
            onChange={(event) => setFilter((prev) => ({ ...prev, query: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.stopPropagation(); setFilter((prev) => ({ ...prev, query: '' })); listRef.current?.focus() }
              if (event.key === 'ArrowDown') { event.preventDefault(); if (visible[0]) setSelectedId(visible[0].id); listRef.current?.focus() }
            }}
            placeholder={t('learning.screen.searchPlaceholder')}
            aria-label={t('learning.screen.search')}
            data-testid="learning-search"
            className="h-9 w-full rounded-[var(--radius-control)] border border-foreground/8 bg-background/75 pl-9 pr-3 text-[13px] outline-none placeholder:text-text-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20"
          />
        </div>
        {!sidebarTarget ? (
          <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent @[760px]/learning:hidden" data-testid="learning-filters-toggle">
            {t('learning.screen.facets')}{activeFacets ? <span className="font-semibold tabular-nums">{activeFacets}</span> : null}
          </button>
        ) : null}
        <select
          aria-label={t('learning.screen.sort')}
          value={sort}
          onChange={(event) => setSort(event.target.value as LearningSort)}
          data-testid="learning-sort"
          className="h-9 max-w-full rounded-[var(--radius-control)] border border-foreground/8 bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {SORTS.map((id) => <option key={id} value={id}>{t(`learning.screen.sortBy.${id}`)}</option>)}
        </select>
        {activeFacets ? (
          <button type="button" onClick={clearFacets} data-testid="learning-clear-filters" className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <X aria-hidden="true" className="size-3.5" />{t('learning.screen.clearFilters')}
          </button>
        ) : null}
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-activedescendant={selectedId && visibleIndexes.has(selectedId) ? `${optionPrefix}-${visibleIndexes.get(selectedId)}` : undefined}
        aria-label={t('learning.screen.candidates.title')}
        tabIndex={0}
        onKeyDown={onListKey}
        data-testid="learning-listbox"
        className="min-h-0 flex-1 overflow-y-auto pb-4 outline-none focus-visible:rounded-[var(--radius-control)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
      >
        {loadError ? (
          <div className="mx-4 my-6 rounded-[var(--radius-control)] border border-destructive/15 bg-destructive/5 p-5" role="alert" data-testid="learning-load-error">
            <p className="mb-3 text-sm">{t('learning.screen.loadFailed')}</p>
            <Btn onClick={load}>{t('learning.screen.retry')}</Btn>
          </div>
        ) : candidates === null ? (
          <div className="px-4 py-6 text-[13px] text-text-muted" data-testid="learning-loading">{t('learning.screen.loading')}</div>
        ) : visible.length === 0 ? (
          <div className="mx-4 my-6 flex flex-col items-center rounded-[var(--radius-control)] border border-dashed border-foreground/12 bg-background/60 px-5 py-10 text-center" data-testid="learning-empty">
            <span className="mb-4 grid size-12 place-items-center rounded-[var(--radius-control)] bg-accent/10 text-accent"><GraduationCap aria-hidden="true" className="size-6" /></span>
            <p className="max-w-[360px] text-sm leading-6 text-text-secondary">{all.length ? t('learning.screen.noMatches') : t('learning.screen.empty')}</p>
            {all.length ? <div className="mt-4"><Btn onClick={clearFacets}>{t('learning.screen.clearFilters')}</Btn></div> : null}
          </div>
        ) : visible.map(renderRow)}
      </div>
    </section>
  )

  const resultBanner = (candidateId: string) => {
    if (!result || result.id !== candidateId) return null
    if (result.kind === 'promotion') {
      const { promotion } = result
      return (
        <div role="status" data-testid="learning-result" className={cn('rounded-[var(--radius-control)] border p-3 text-[12px]', promotion.promoted ? 'border-accent/25 bg-accent/8' : 'border-foreground/10 bg-foreground/[0.04]')}>
          <p className="flex items-center gap-1.5 font-medium"><Check aria-hidden="true" className="size-3.5" />{t(promotion.promoted ? 'learning.screen.result.promoted' : 'learning.screen.result.notPromoted')}</p>
          <p className="mt-1 text-text-muted">{t('learning.screen.result.status', { status: statusLabel(promotion.status) })}</p>
          {promotion.reason ? <p className="mt-1 text-text-secondary">{promotion.reason}</p> : null}
          {promotion.mutations.length ? (
            <ul className="mt-2 space-y-1" data-testid="learning-mutations">
              {promotion.mutations.map((mutation) => (
                <li key={mutation.id} className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                  <Chip tone="muted">{mutationTargetLabel(mutation.targetType)}</Chip>
                  <span className="min-w-0 flex-1 truncate">{mutation.targetId}</span>
                  <Chip>{mutationStatusLabel(mutation.status)}</Chip>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )
    }
    return (
      <div role="status" data-testid="learning-result" className="rounded-[var(--radius-control)] border border-foreground/10 bg-foreground/[0.04] p-3 text-[12px]">
        <p className="font-medium">{t(result.rollback.reverted ? 'learning.screen.result.reverted' : 'learning.screen.result.notReverted')}</p>
        <p className="mt-1 text-text-muted">{t('learning.screen.result.mutationCount', { count: result.rollback.mutationIds.length })}</p>
        {result.rollback.reason ? <p className="mt-1 text-text-secondary">{result.rollback.reason}</p> : null}
      </div>
    )
  }

  // ── Candidate inspector (§27) ────────────────────────────────────────────
  const detail = selected ? (() => {
    const failed = failedPasses(selected)
    const judged = selected.validation.judged
    return (
      <div className="flex flex-col" data-testid="learning-detail">
        <header className="flex shrink-0 items-start gap-2 border-b border-foreground/7 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-[14px] font-semibold leading-5">{selected.hypothesis}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Chip tone={STATUS_TONE[selected.status]}>{statusLabel(selected.status)}</Chip>
              <Chip>{typeLabel(selected.type)}</Chip>
              <Chip tone="muted">{scopeLabel(selected.scope)}</Chip>
            </div>
          </div>
          <button type="button" onClick={() => setSelectedId(null)} aria-label={t('learning.screen.close')} className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-text-muted outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>
        <div className="px-4 py-3">
          {resultBanner(selected.id)}
          <section className="mt-4">
            <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold"><ShieldCheck aria-hidden="true" className="size-3.5 text-accent" />{t('learning.screen.detail.confidence')}</p>
            <Meter value={selected.confidence} label={t('learning.screen.detail.confidence')} testId="learning-confidence-meter" />
            <div className="mt-2 space-y-1.5">
              {confidenceRows(selected.confidenceComponents).map(({ key, value }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-[150px] shrink-0 truncate text-[11px] text-text-muted">{t(`learning.screen.confidence.${key}`)}</span>
                  <div className="min-w-0 flex-1"><Meter value={value} label={t(`learning.screen.confidence.${key}`)} /></div>
                </div>
              ))}
            </div>
          </section>
          <section className="mt-4">
            <p className="mb-1.5 text-[12px] font-semibold">{t('learning.screen.detail.validation')}</p>
            <Chip tone={selected.validation.promotable ? 'accent' : 'warning'}>{t(selected.validation.promotable ? 'learning.screen.detail.promotable' : 'learning.screen.detail.notPromotable')}</Chip>
            {judged ? <p className="mt-1 text-[11px] text-text-muted">{t('learning.screen.detail.judged', { verdict: t(`learning.screen.verdict.${judged.verdict}`), rationale: judged.rationale ?? '' })}</p> : null}
            {failed.length ? (
              <div className="mt-2 space-y-1" data-testid="learning-failed-passes">
                <p className="text-[11px] font-semibold text-text-muted">{t('learning.screen.detail.failedPasses')}</p>
                {failed.map((pass) => (
                  <p key={pass.pass} className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
                    <Chip tone="danger">{passLabel(pass.pass)}</Chip>
                    {pass.detail ? <span className="text-text-secondary">{pass.detail}</span> : null}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
          <section className="mt-4">
            <p className="mb-1.5 text-[12px] font-semibold">{t('learning.screen.detail.evidence')}</p>
            {selected.evidence.length === 0 ? <p className="text-[11px] text-text-muted">{t('learning.screen.detail.noEvidence')}</p> : (
              <ul className="space-y-1.5" data-testid="learning-evidence">
                {[...selected.evidence].sort((a, b) => b.weight - a.weight).map((ref) => (
                  <li key={ref.evidenceId} className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
                    <Chip tone="muted">{evidenceLabel(ref.type)}</Chip>
                    <span className="min-w-0 flex-1 break-all font-mono">{ref.ref}</span>
                    <span className="shrink-0 tabular-nums text-text-muted">{t('learning.screen.detail.evidenceWeight', { weight: Math.round(ref.weight * 100) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="mt-4">
            <Row label={t('learning.screen.detail.fingerprint')}><span className="break-all font-mono text-[11px]">{selected.fingerprint}</span></Row>
            <Row label={t('learning.screen.detail.created')}>{fmt(selected.createdAt)}</Row>
            <Row label={t('learning.screen.detail.updated')}>{fmt(selected.updatedAt)}</Row>
            {selected.rollbackOf ? <Row label={t('learning.screen.detail.rollbackOf')}><span className="font-mono text-[11px]">{selected.rollbackOf}</span></Row> : null}
            {selected.rejectedReason ? <Row label={t('learning.screen.detail.rejectedReason')}>{selected.rejectedReason}</Row> : null}
            <Row label={t('learning.screen.detail.payload')}><pre className="max-h-[160px] overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] bg-foreground/[0.04] p-2 font-mono text-[11px]">{JSON.stringify(selected.payload, null, 2) ?? 'null'}</pre></Row>
          </section>
          {writeDenied ? <p className="mt-3 text-[11px] text-destructive" role="alert">{t('learning.screen.writeDenied')}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn primary disabled={busy || writeDenied || !writeAvailable} onClick={() => setConfirm({ action: 'approve', candidate: selected })} testId="learning-approve">{t('learning.screen.actions.approve')}</Btn>
            <Btn danger disabled={busy || writeDenied || !writeAvailable} onClick={() => setConfirm({ action: 'reject', candidate: selected })} testId="learning-reject">{t('learning.screen.actions.reject')}</Btn>
            <Btn disabled={busy || writeDenied || !writeAvailable} onClick={() => setConfirm({ action: 'rollback', candidate: selected })} testId="learning-rollback">{t('learning.screen.actions.rollback')}</Btn>
            <Btn disabled={busy || writeDenied || !writeAvailable} onClick={() => revalidateCandidate(selected)} testId="learning-revalidate">{t('learning.screen.actions.revalidate')}</Btn>
            <Btn disabled={busy || writeDenied || !writeAvailable || !selected.evidence.some((ref) => ref.type === 'session')} onClick={() => reflectCandidate(selected)} testId="learning-reflect">
              <Sparkles aria-hidden="true" className="size-3.5" />{t('learning.screen.dashboard.reflect')}
            </Btn>
          </div>
        </div>
      </div>
    )
  })() : (
    <div className="flex flex-col gap-2 px-5 py-6 text-[12px] text-text-muted" data-testid="learning-detail-empty">
      <span className="grid size-8 place-items-center rounded-[var(--radius-control)] bg-foreground/[0.04]"><HelpCircle aria-hidden="true" className="size-4" /></span>
      <p>{t('learning.screen.detail.empty')}</p>
      <p>{t('learning.screen.keysHint', { selectAll: formatHotkeyDisplay('mod+enter') })}</p>
    </div>
  )

  const mutationTargetLabel = (targetType: string) => (MUTATION_TARGETS.includes(targetType as typeof MUTATION_TARGETS[number])
    ? t(`learning.screen.target.${targetType}`)
    : targetType)
  const mutationStatusLabel = (status: string) => (MUTATION_STATUSES.includes(status as typeof MUTATION_STATUSES[number])
    ? t(`learning.screen.mutationStatus.${status}`)
    : status)
  const policyStatusLabel = (status: string) => (POLICY_STATUSES.includes(status as typeof POLICY_STATUSES[number])
    ? t(`learning.screen.policies.status.${status}`)
    : status)

  const renderTimelineEntry = (entry: LearningTimelineEntryDto) => (
    <li key={entry.id} data-testid="learning-timeline-row" className="flex flex-wrap items-baseline gap-1.5 rounded-[var(--radius-control)] bg-foreground/[0.03] px-2.5 py-1.5 text-[11px]">
      <Chip tone="muted">{kindLabel(entry.kind)}</Chip>
      <span className="min-w-0 flex-1 break-words text-text-secondary">{entry.summary}</span>
      <span className="shrink-0 tabular-nums text-text-muted">{fmt(entry.ts)}</span>
      {entry.detail ? <span className="w-full break-words text-text-muted">{entry.detail}</span> : null}
      {entry.sessionId ? <span className="w-full truncate font-mono text-text-muted">{t('learning.screen.timeline.session', { id: entry.sessionId })}</span> : null}
    </li>
  )

  // ── Dashboard (§26) ──────────────────────────────────────────────────────
  const dashboard = (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-5" data-testid="learning-dashboard">
      <h2 className="text-[15px] font-semibold">{t('learning.screen.dashboard.title')}</h2>
      <p className="mt-1 max-w-[620px] text-[12px] leading-5 text-text-secondary">{t('learning.screen.subtitle')}</p>
      <section className="mt-4 max-w-[680px]">
        <h3 className="text-[13px] font-semibold">{t('learning.screen.dashboard.stats')}</h3>
        {stats ? (
          <div className="mt-2 grid grid-cols-2 gap-2 @[760px]/learning:grid-cols-4">
            {STAT_KEYS.map((key) => (
              <div key={key} className="flex items-baseline justify-between gap-2 rounded-[var(--radius-control)] bg-foreground/[0.035] px-3 py-2">
                <span className="min-w-0 truncate text-[11px] text-text-secondary">{t(`learning.screen.dashboard.stat.${key}`)}</span>
                <span className="text-[14px] font-semibold tabular-nums">{stats[key]}</span>
              </div>
            ))}
          </div>
        ) : <p className="mt-2 text-[12px] text-text-muted">{t('learning.screen.loading')}</p>}
      </section>
      <section className="mt-5 max-w-[680px]">
        <h3 className="text-[13px] font-semibold">{t('learning.screen.dashboard.effectiveness')}</h3>
        <div className="mt-2 flex items-center gap-2">
          <span className="w-[150px] shrink-0 truncate text-[11px] text-text-muted">{t('learning.screen.dashboard.avgConfidence')}</span>
          <div className="min-w-0 flex-1"><Meter value={avgConfidence} label={t('learning.screen.dashboard.avgConfidence')} testId="learning-avg-confidence" /></div>
        </div>
        <div className="mt-2 max-w-[420px] space-y-1">
          {LEARNING_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => { setView('candidates'); setFilter({ status }) }}
              className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-1 py-1 text-[11px] text-text-secondary outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Chip tone={STATUS_TONE[status]}>{statusLabel(status)}</Chip>
              <span className="flex-1" />
              <span className="tabular-nums">{counts.status.get(status) ?? 0}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="mt-5 max-w-[680px]">
        <h3 className="text-[13px] font-semibold">{t('learning.screen.dashboard.ops')}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn disabled={busy || !writeAvailable} onClick={consolidate} testId="learning-dashboard-consolidate">{t('learning.screen.dashboard.consolidate')}</Btn>
          <Btn disabled={busy || !writeAvailable} onClick={curateSkills} testId="learning-dashboard-curate">{t('learning.screen.dashboard.curate')}</Btn>
          <Btn disabled={busy || !writeAvailable} onClick={runPolicies} testId="learning-dashboard-run-policy">{t('learning.screen.dashboard.runPolicy')}</Btn>
        </div>
      </section>
      <section className="mt-5 max-w-[680px]">
        <h3 className="text-[13px] font-semibold">{t('learning.screen.dashboard.recent')}</h3>
        {timeline.length === 0 ? <p className="mt-2 text-[12px] text-text-muted">{t('learning.screen.dashboard.timelineEmpty')}</p> : (
          <ul className="mt-2 space-y-1.5">{timeline.slice(0, 8).map(renderTimelineEntry)}</ul>
        )}
      </section>
    </section>
  )

  // ── Skills (§28) ─────────────────────────────────────────────────────────
  const skillCard = (candidate: LearningCandidate, showActions: boolean) => {
    const report = effectiveness.get(candidate.id)
    const band = effectivenessBand(report?.effectiveness ?? null)
    return (
      <li key={candidate.id} data-testid="learning-skill-row" className="rounded-[var(--radius-control)] border border-foreground/8 bg-background/70 p-3">
        <p className="break-words text-[13px] leading-5">{candidate.hypothesis}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Chip tone={STATUS_TONE[candidate.status]}>{statusLabel(candidate.status)}</Chip>
          <Chip tone="muted">{scopeLabel(candidate.scope)}</Chip>
          <span className="text-[11px] text-text-muted">{t('learning.screen.skills.samples', { count: report?.sampleSize ?? 0 })}</span>
          <Chip tone={band === 'high' ? 'accent' : band === 'low' ? 'danger' : 'muted'}>{t(`learning.screen.band.${band}`)}</Chip>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="w-[130px] shrink-0 truncate text-[11px] text-text-muted">{t('learning.screen.skills.effectiveness')}</span>
          <div className="min-w-0 flex-1"><Meter value={report?.effectiveness ?? 0} label={t('learning.screen.skills.effectiveness')} testId={`learning-skill-effectiveness-${candidate.id}`} /></div>
        </div>
        {report ? (
          <div className="mt-1.5 space-y-1">
            {EFFECTIVENESS_COMPONENTS.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-[130px] shrink-0 truncate text-[11px] text-text-muted">{t(`learning.screen.effectiveness.${key}`)}</span>
                <div className="min-w-0 flex-1"><Meter value={report.components[key]} label={t(`learning.screen.effectiveness.${key}`)} /></div>
              </div>
            ))}
          </div>
        ) : null}
        {showActions ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn primary disabled={busy || writeDenied || !writeAvailable} onClick={() => setConfirm({ action: 'approve', candidate })}>{t('learning.screen.actions.approve')}</Btn>
            <Btn danger disabled={busy || writeDenied || !writeAvailable} onClick={() => setConfirm({ action: 'reject', candidate })}>{t('learning.screen.actions.reject')}</Btn>
            <Btn disabled={busy} onClick={() => setSelectedId(candidate.id)}>{t('learning.screen.skills.open')}</Btn>
          </div>
        ) : null}
      </li>
    )
  }

  const skills = (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-5" data-testid="learning-skills">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold"><Layers aria-hidden="true" className="size-4 text-accent" />{t('learning.screen.skills.title')}</h2>
        <span className="flex-1" />
        <Btn disabled={busy || !writeAvailable} onClick={curateSkills} testId="learning-curate">{t('learning.screen.skills.curate')}</Btn>
      </div>
      {curation ? (
        <div className="mt-3 max-w-[680px] rounded-[var(--radius-control)] bg-accent/8 px-3 py-2" data-testid="learning-curation">
          <p className="text-[12px] font-medium">{t('learning.screen.skills.curated')}</p>
          <ul className="mt-1 space-y-0.5">
            {curation.map((item) => (
              <li key={item.slug} className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
                <Chip tone="muted">{t(`learning.screen.skills.action.${item.action}`)}</Chip>
                <span className="min-w-0 flex-1 truncate font-mono">{item.slug}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <h3 className="mt-4 text-[13px] font-semibold">{t('learning.screen.skills.pending')}</h3>
      {queue.length === 0 ? <p className="mt-2 text-[12px] text-text-muted">{t('learning.screen.skills.empty')}</p> : (
        <ul className="mt-2 grid max-w-[900px] gap-2 @[900px]/learning:grid-cols-2">{queue.map((candidate) => skillCard(candidate, true))}</ul>
      )}
      <h3 className="mt-5 text-[13px] font-semibold">{t('learning.screen.skills.approved')}</h3>
      {approved.length === 0 ? <p className="mt-2 text-[12px] text-text-muted">{t('learning.screen.skills.empty')}</p> : (
        <ul className="mt-2 grid max-w-[900px] gap-2 @[900px]/learning:grid-cols-2">{approved.map((candidate) => skillCard(candidate, false))}</ul>
      )}
      <h3 className="mt-5 text-[13px] font-semibold">{t('learning.screen.policies.title')}</h3>
      {policies.length === 0 ? <p className="mt-2 text-[12px] text-text-muted">{t('learning.screen.policies.empty')}</p> : (
        <ul className="mt-2 max-w-[900px] space-y-1.5" data-testid="learning-policies">
          {policies.map((policy) => (
            <li key={policy.id} className="rounded-[var(--radius-control)] bg-foreground/[0.035] px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-mono">{policy.taskClass}</span>
                <Chip tone={policy.status === 'active' ? 'accent' : 'muted'}>{policyStatusLabel(policy.status)}</Chip>
                <Chip>{t(`learning.screen.policies.delegation.${policy.delegation}`)}</Chip>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="w-[130px] shrink-0 truncate text-[11px] text-text-muted">{t('learning.screen.policies.confidence')}</span>
                <div className="min-w-0 flex-1"><Meter value={policy.confidence} label={t('learning.screen.policies.confidence')} /></div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  // ── Timeline (§29) ───────────────────────────────────────────────────────
  const timelineView = (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-5" data-testid="learning-timeline">
      <h2 className="flex items-center gap-1.5 text-[15px] font-semibold"><ListTree aria-hidden="true" className="size-4 text-accent" />{t('learning.screen.timeline.title')}</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">{TIMELINE_KINDS.map((kind) => <Chip key={kind} tone="muted">{kindLabel(kind)}</Chip>)}</div>
      {timeline.length === 0 ? <p className="mt-4 text-[12px] text-text-muted">{t('learning.screen.timeline.empty')}</p> : (
        <div className="mt-4 max-w-[760px] space-y-4">
          {groupTimeline(timeline).map((group) => (
            <section key={group.kind}>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold">
                {kindLabel(group.kind)}<span className="font-normal tabular-nums text-text-muted">{group.items.length}</span>
              </h3>
              <ul className="space-y-1.5">{group.items.map(renderTimelineEntry)}</ul>
            </section>
          ))}
        </div>
      )}
    </section>
  )

  // ── Help (§25) ───────────────────────────────────────────────────────────
  const help = (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-5" data-testid="learning-help">
      <h2 className="text-[15px] font-semibold">{t('learning.screen.help.title')}</h2>
      <p className="mt-1 max-w-[680px] text-[12px] leading-5 text-text-secondary">{t('learning.screen.help.intro')}</p>
      <div className="mt-4 max-w-[680px] space-y-4">
        <section>
          <h3 className="text-[13px] font-semibold">{t('learning.screen.help.definitionTitle')}</h3>
          <p className="mt-1 text-[12px] leading-5 text-text-secondary">{t('learning.screen.help.definition')}</p>
        </section>
        <section>
          <h3 className="text-[13px] font-semibold">{t('learning.screen.help.unitsTitle')}</h3>
          <p className="mt-1 text-[12px] leading-5 text-text-secondary">{t('learning.screen.help.units')}</p>
        </section>
        <section>
          <h3 className="text-[13px] font-semibold">{t('learning.screen.help.formulaTitle')}</h3>
          <p className="mt-1 font-mono text-[11px] leading-5 text-text-secondary">{t('learning.screen.help.confidenceFormula')}</p>
          <p className="mt-1 font-mono text-[11px] leading-5 text-text-secondary">{t('learning.screen.help.effectivenessFormula')}</p>
        </section>
        <section>
          <h3 className="text-[13px] font-semibold">{t('learning.screen.help.sourcesTitle')}</h3>
          <p className="mt-1 text-[12px] leading-5 text-text-secondary">{t('learning.screen.help.sources')}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {LEARNING_EVIDENCE_TYPES.map((type) => <Chip key={type} tone="muted">{evidenceLabel(type)}</Chip>)}
          </div>
        </section>
        <section>
          <h3 className="text-[13px] font-semibold">{t('learning.screen.help.examplesTitle')}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] leading-5 text-text-secondary">
            <li>{t('learning.screen.help.exampleLesson')}</li>
            <li>{t('learning.screen.help.exampleSkill')}</li>
          </ul>
        </section>
      </div>
    </section>
  )

  return (
    <div className="@container/learning relative flex h-full w-full min-h-0 min-w-0 bg-background font-sans text-[13px] text-foreground" data-testid="learning-screen">
      {facets}
      {unavailable ? unavailableSection : (
        <>
          {view === 'dashboard' ? dashboard : null}
          {view === 'candidates' ? (
            <>
              {list}
              {selected ? (
                <section
                  className="flex w-full min-w-0 flex-1 flex-col overflow-y-auto bg-background @[920px]/learning:w-[clamp(300px,36%,440px)] @[920px]/learning:flex-none @[920px]/learning:border-l @[920px]/learning:border-foreground/7"
                  aria-label={t('learning.screen.properties')}
                  data-testid="learning-detail-pane"
                >
                  {detail}
                </section>
              ) : null}
            </>
          ) : null}
          {view === 'skills' ? skills : null}
          {view === 'timeline' ? timelineView : null}
          {view === 'help' ? help : null}
        </>
      )}
      {confirmDialog}
    </div>
  )
}