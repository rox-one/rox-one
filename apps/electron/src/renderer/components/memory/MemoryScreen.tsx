/**
 * Память — three-pane memory manager over the real lesson stores.
 *
 * Facets (scope · status · type · source · usage · topics · tags) → list
 * (search, sort, keyword topics, bulk select) → detail (full text, edit,
 * provenance, usage history, near-duplicates + merge, promote, pin,
 * disable). The token meter shows exactly what LessonStore.forContext would
 * inject (shared selectContextLessons), estimated at ≈4 chars per token.
 * Destructive actions (delete, merge) always go through a confirm dialog.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import type { Lesson, LessonCategory, LessonScope, PromotionCandidate } from '@rox/shared/memory/types'
import { lessonTokens, estimateTokens } from '@rox/shared/memory/context-select'
import { LESSON_LIMITS } from '@rox/shared/memory/types'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useNavigation, routes } from '@/contexts/NavigationContext'
import { getSessionTitle } from '@/utils/session'
import { cn } from '@/lib/utils'
import {
  clusterTopics,
  contextSelection,
  countBy,
  duplicateIds,
  lessonId,
  matchesFilter,
  mergePatch,
  nearDuplicates,
  sortLessons,
  tokenBudget,
  usageBucket,
  type MemoryFilter,
  type MemorySort,
  type StatusFacet,
  type UsageBucket,
} from '@/lib/memory-model'
import { MemoryListPanel } from '@/components/app-shell/MemoryListPanel'

const BUILTIN: LessonCategory[] = ['correction', 'preference', 'workflow', 'knowledge']
const SORTS: MemorySort[] = ['usage', 'recency', 'tokens', 'conflicts']
const STATUSES: StatusFacet[] = ['inContext', 'pinned', 'negative', 'disabled', 'conflicts', 'merged']
const USAGE: UsageBucket[] = ['often', 'some', 'never']
const TRIGGERS = ['explicit', 'distillation', 'branch', 'interrupted', 'error'] as const

type FacetKey = keyof Omit<MemoryFilter, 'query'>

export interface MemoryScreenProps {
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
        'flex h-7 w-full min-w-0 items-center gap-2 rounded-[6px] px-2 text-left text-[13px] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--accent)]',
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
    <div className="grid grid-cols-[112px_1fr] items-baseline gap-2 py-[3px] text-[12px]">
      <span className="text-text-muted">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'danger' | 'accent' | 'muted' }) {
  return (
    <span className={cn(
      'inline-flex h-[18px] max-w-[160px] shrink-0 items-center truncate rounded-[4px] px-1.5 text-[11px]',
      tone === 'danger' ? 'bg-destructive/12 text-destructive' : tone === 'accent' ? 'bg-accent/15 text-accent' : 'bg-foreground/[0.07] text-text-secondary',
    )}>
      {children}
    </span>
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
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] px-2.5 text-[12px] font-medium outline-none disabled:opacity-40 focus-visible:shadow-[inset_0_0_0_1.5px_var(--accent)]',
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
      <div role="alertdialog" aria-modal="true" aria-label={title} className="w-[min(520px,92vw)] rounded-[10px] bg-background p-4 shadow-xl ring-1 ring-foreground/15">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {body ? <div className="mt-2 text-[13px] text-text-secondary">{body}</div> : null}
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={onCancel}>{t('memory.cancel')}</Btn>
          <button ref={ref} type="button" onClick={onConfirm} data-testid="memory-confirm" className="inline-flex h-7 items-center rounded-[6px] bg-destructive px-2.5 text-[12px] font-medium text-white hover:brightness-110 focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--destructive)]">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MemoryScreen({ workspaceId }: MemoryScreenProps) {
  const { t, i18n } = useTranslation()
  const { navigate } = useNavigation()
  const sessionMap = useAtomValue(sessionMetaMapAtom)
  const [lessons, setLessons] = React.useState<Lesson[] | null>(null)
  const [archivedLessons, setArchivedLessons] = React.useState<Array<{ id: string; lesson: Lesson }>>([])
  const [candidates, setCandidates] = React.useState<PromotionCandidate[]>([])
  const [filter, setFilter] = React.useState<MemoryFilter>({})
  const [sort, setSort] = React.useState<MemorySort>('usage')
  const [grouped, setGrouped] = React.useState(false)
  const [filesView, setFilesView] = React.useState(false)
  const [archiveView, setArchiveView] = React.useState(false)
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [tagDraft, setTagDraft] = React.useState('')
  const [bulkTag, setBulkTag] = React.useState('')
  const [adding, setAdding] = React.useState(false)
  const [addRule, setAddRule] = React.useState('')
  const [addScope, setAddScope] = React.useState<LessonScope>('workspace')
  const [addCategory, setAddCategory] = React.useState<LessonCategory>('workflow')
  const [addNegative, setAddNegative] = React.useState(false)
  const [confirm, setConfirm] = React.useState<null | { kind: 'delete'; ids: string[] } | { kind: 'merge'; ids: string[] }>(null)
  const [mergeKeeper, setMergeKeeper] = React.useState<string | null>(null)
  const [mergeText, setMergeText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const load = React.useCallback(() => {
    window.electronAPI.listMemoryLessons('both', workspaceId).then(setLessons).catch(() => setLessons([]))
    window.electronAPI.listMemoryArchive('global', workspaceId).then((global) => {
      window.electronAPI.listMemoryArchive('workspace', workspaceId).then((workspace) => setArchivedLessons([...global, ...workspace])).catch(() => setArchivedLessons(global))
    }).catch(() => {
      window.electronAPI.listMemoryArchive('workspace', workspaceId).then(setArchivedLessons).catch(() => setArchivedLessons([]))
    })
    window.electronAPI.listPromotionCandidates().then(setCandidates).catch(() => setCandidates([]))
  }, [workspaceId])
  React.useEffect(() => {
    load()
    return window.electronAPI.onMemoryChanged(() => load())
  }, [load])

  const all = lessons ?? []
  const byId = React.useMemo(() => new Map(all.map((l) => [lessonId(l), l])), [all])
  const inContext = React.useMemo(() => contextSelection(all), [all])
  const budget = React.useMemo(() => tokenBudget(all, inContext), [all, inContext])
  const { topics, topicOf } = React.useMemo(() => clusterTopics(all), [all])
  const dupes = React.useMemo(() => duplicateIds(all), [all])
  const ctx = React.useMemo(() => ({ inContext, topicOf }), [inContext, topicOf])
  const visible = React.useMemo(() => sortLessons(all.filter((l) => matchesFilter(l, filter, ctx)), sort), [all, filter, ctx, sort])
  const selected = selectedId ? byId.get(selectedId) : undefined
  const counts = React.useMemo(() => ({
    scope: countBy(all, (l) => l.scope),
    category: countBy(all, (l) => l.category),
    tag: countBy(all, (l) => l.tags ?? []),
    trigger: countBy(all, (l) => l.source.trigger),
    usage: countBy(all, (l) => usageBucket(l)),
    status: {
      inContext: inContext.size,
      pinned: all.filter((l) => l.pinned).length,
      negative: all.filter((l) => l.negative).length,
      disabled: all.filter((l) => l.disabled).length,
      conflicts: all.filter((l) => l.conflicts?.length).length,
      merged: all.filter((l) => l.mergedFrom?.length || l.mergedInto).length,
    } as Record<StatusFacet, number>,
  }), [all, inContext])
  const customCategories = [...counts.category.keys()].filter((c) => !BUILTIN.includes(c as LessonCategory)).sort()
  const dateFmt = React.useMemo(() => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), [i18n.language])
  const fmt = (iso?: string) => (iso && Date.parse(iso) ? dateFmt.format(new Date(iso)) : '—')

  React.useEffect(() => { setEditing(false); setTagDraft('') }, [selectedId])
  React.useEffect(() => {
    if (selectedId && !byId.has(selectedId)) setSelectedId(null)
    setChecked((prev) => {
      const next = new Set([...prev].filter((id) => byId.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [byId, selectedId])

  const setFacet = (key: FacetKey, value: string | null) => {
    setFilesView(false)
    setArchiveView(false)
    setFilter((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }))
  }
  const clearFacets = () => { setFilesView(false); setArchiveView(false); setFilter((prev) => ({ query: prev.query })) }
  const activeFacets = (Object.keys(filter) as Array<keyof MemoryFilter>).filter((k) => k !== 'query' && filter[k] != null).length

  const wsFor = (lesson: Lesson) => (lesson.scope === 'global' ? null : workspaceId ?? null)
  const run = async (fn: () => Promise<unknown>, okKey?: string) => {
    setBusy(true)
    try {
      await fn()
      if (okKey) toast.success(t(okKey))
    } catch (error) {
      toast.error(t('memory.lessonUpdateFailed'), { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
      load()
    }
  }
  const restoreArchived = async (entry: { id: string; lesson: Lesson }) => {
    setBusy(true)
    try {
      const restored = await window.electronAPI.restoreMemoryArchive(wsFor(entry.lesson), entry.lesson.scope, entry.id)
      if (!restored) throw new Error('Archived lesson was not restored')
      toast.success(t('memory.screen.archiveRestore'))
    } catch {
      toast.error(t('memory.screen.archiveRestoreFailed'))
    } finally {
      setBusy(false)
      load()
    }
  }
  const patch = (lesson: Lesson, next: Partial<Omit<Lesson, 'scope'>>) => window.electronAPI.updateMemoryLesson(wsFor(lesson), lesson.scope, lesson.rule, next)
  const patchMany = (ids: readonly string[], next: (lesson: Lesson) => Partial<Omit<Lesson, 'scope'>> | null, okKey?: string) => run(async () => {
    for (const id of ids) {
      const lesson = byId.get(id)
      const change = lesson ? next(lesson) : null
      if (lesson && change) await patch(lesson, change)
    }
  }, okKey)
  const removeMany = (ids: readonly string[]) => run(async () => {
    for (const id of ids) {
      const lesson = byId.get(id)
      if (lesson) await window.electronAPI.deleteMemoryLesson(wsFor(lesson), lesson.scope, lesson.rule)
    }
    setChecked(new Set())
  }, 'memory.screen.toast.deleted')
  const promote = (ids: readonly string[]) => run(async () => {
    for (const id of ids) {
      const lesson = byId.get(id)
      if (lesson && lesson.scope === 'workspace') await window.electronAPI.promoteLesson(null, lesson.rule)
    }
  }, 'memory.promoted')

  const saveEdit = (lesson: Lesson) => {
    const rule = draft.trim()
    setEditing(false)
    if (!rule || rule === lesson.rule) return
    void run(async () => {
      await patch(lesson, { rule, editedAt: new Date().toISOString() })
      setSelectedId(lessonId({ scope: lesson.scope, rule }))
    })
  }
  const addTag = (lesson: Lesson, raw: string) => {
    const tag = raw.trim().replace(/^#/, '').toLowerCase()
    if (!tag || (lesson.tags ?? []).includes(tag)) return
    void run(() => patch(lesson, { tags: [...(lesson.tags ?? []), tag] }))
  }
  const submitAdd = () => {
    const rule = addRule.trim()
    if (!rule) return
    void run(async () => {
      const result = await window.electronAPI.addMemoryLesson(addScope === 'global' ? null : workspaceId ?? null, {
        rule, category: addCategory, scope: addScope, ...(addNegative ? { negative: true } : {}),
      })
      setAddRule('')
      setAddNegative(false)
      setAdding(false)
      setSelectedId(lessonId(result.lesson))
      if (result.conflicts.length) toast.warning(t('memory.screen.toast.conflicts', { count: result.conflicts.length }))
    }, 'memory.lessonAdded')
  }

  const openMerge = (ids: string[]) => {
    const group = ids.map((id) => byId.get(id)).filter((l): l is Lesson => Boolean(l))
    if (group.length < 2) return
    const keeper = [...group].sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))[0]!
    setMergeKeeper(lessonId(keeper))
    setMergeText(keeper.rule)
    setConfirm({ kind: 'merge', ids: group.map(lessonId) })
  }
  const doMerge = (ids: string[]) => {
    const keeper = mergeKeeper ? byId.get(mergeKeeper) : undefined
    const rule = mergeText.trim()
    if (!keeper || !rule) return
    const others = ids.filter((id) => id !== mergeKeeper).map((id) => byId.get(id)).filter((l): l is Lesson => Boolean(l))
    if (others.some((lesson) => lesson.scope !== keeper.scope || lesson.mergeHistory || lesson.mergedInto)) return
    setConfirm(null)
    void run(async () => {
      // Keep source rows disabled instead of deleting them; the keeper stores
      // their complete pre-merge records for a later restore.
      await patch(keeper, mergePatch(keeper, others, rule))
      for (const other of others) {
        await patch(other, { disabled: true, mergedInto: lessonId(keeper) })
      }
      setChecked(new Set())
      setSelectedId(lessonId({ scope: keeper.scope, rule }))
    }, 'memory.screen.toast.merged')
  }

  const restoreMerge = (lesson: Lesson) => {
    const originals = lesson.mergeHistory?.version === 1 ? lesson.mergeHistory.lessons : []
    if (originals.length === 0) return
    void run(async () => {
      const restorePatch = (original: Lesson): Partial<Omit<Lesson, 'scope'>> => {
        const { scope: originalScope, ...fields } = original
        if (originalScope !== lesson.scope) throw new Error('Merged lessons do not share a scope')
        return {
          ...fields,
          usageCount: original.usageCount,
          lastUsedAt: original.lastUsedAt,
          usedAt: original.usedAt,
          tags: original.tags,
          pinned: original.pinned,
          negative: original.negative,
          mergedFrom: original.mergedFrom,
          mergedInto: undefined,
          mergeHistory: undefined,
          editedAt: original.editedAt,
        }
      }
      for (const original of originals.slice(1)) {
        const current = byId.get(lessonId(original))
        if (!current) throw new Error(`Merged source is missing: ${original.rule}`)
        await patch(current, { ...restorePatch(original), disabled: original.disabled })
      }
      const keeperOriginal = originals[0]!
      await patch(lesson, restorePatch(keeperOriginal))
      setSelectedId(lessonId(keeperOriginal))
    }, 'memory.screen.toast.merged')
  }

  const toggleCheck = (id: string) => setChecked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const checkedIds = [...checked]
  const checkedLessons = checkedIds.map((id) => byId.get(id)).filter((l): l is Lesson => Boolean(l))
  const sameScope = checkedLessons.length > 1 && checkedLessons.every((l) => l.scope === checkedLessons[0]!.scope)

  const onListKey = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea')) return
    const index = selected ? visible.findIndex((l) => lessonId(l) === selectedId) : -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = visible[Math.min(visible.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]
      if (next) setSelectedId(lessonId(next))
    } else if (event.key === ' ' && selected) {
      event.preventDefault()
      toggleCheck(lessonId(selected))
    } else if ((event.key === 'a' || event.code === 'KeyA') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      setChecked(new Set(visible.map(lessonId)))
    } else if (event.key === 'Escape') {
      setChecked(new Set())
    } else if (event.key === 'Enter' && selected) {
      setDraft(selected.rule)
      setEditing(true)
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && /\S/.test(event.key)) {
      searchRef.current?.focus()
    }
  }
  React.useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector<HTMLElement>(`[data-lesson-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // ── Facets ───────────────────────────────────────────────────────────────
  const categoryLabel = (c: string) => (BUILTIN.includes(c as LessonCategory) ? t(`memory.category.${c}`) : c)
  const facets = (
    <nav className="flex w-[208px] shrink-0 flex-col overflow-y-auto bg-surface-rail px-2 pb-3 pt-2" aria-label={t('memory.screen.facets')} data-testid="memory-facets">
      <FacetItem label={t('memory.screen.all')} count={all.length} active={!activeFacets && !filesView && !archiveView} onClick={clearFacets} testId="memory-facet-all" />
      <FacetTitle>{t('memory.screen.scope')}</FacetTitle>
      <FacetItem label={t('memory.screen.scopeGlobal')} count={counts.scope.get('global') ?? 0} active={filter.scope === 'global'} onClick={() => setFacet('scope', 'global')} testId="memory-facet-global" />
      <FacetItem label={t('memory.screen.scopeWorkspace')} count={counts.scope.get('workspace') ?? 0} active={filter.scope === 'workspace'} onClick={() => setFacet('scope', 'workspace')} testId="memory-facet-workspace" />
      <FacetItem label={t('memory.screen.files')} active={filesView} onClick={() => { setArchiveView(false); setFilesView((v) => !v) }} testId="memory-facet-files" />
      <FacetItem label={t('memory.screen.archiveTitle')} count={archivedLessons.length} active={archiveView} onClick={() => { setFilesView(false); setArchiveView((v) => !v) }} testId="memory-facet-archive" />
      {STATUSES.map((id) => (
        <FacetItem
          key={id}
          label={t(`memory.screen.statusFacet.${id}`)}
          count={counts.status[id]}
          active={filter.status === id}
          tone={id === 'negative' || id === 'conflicts' ? 'danger' : id === 'inContext' ? 'accent' : undefined}
          onClick={() => setFacet('status', id)}
          testId={`memory-facet-status-${id}`}
        />
      ))}
      <FacetTitle>{t('memory.screen.type')}</FacetTitle>
      {[...BUILTIN, ...customCategories].filter((c) => counts.category.get(c)).map((c) => (
        <FacetItem key={c} label={categoryLabel(c)} count={counts.category.get(c)} active={filter.category === c} onClick={() => setFacet('category', c)} />
      ))}
      <FacetTitle>{t('memory.screen.source')}</FacetTitle>
      {TRIGGERS.filter((id) => counts.trigger.get(id)).map((id) => (
        <FacetItem key={id} label={t(`memory.screen.trigger.${id}`)} count={counts.trigger.get(id)} active={filter.trigger === id} onClick={() => setFacet('trigger', id)} />
      ))}
      <FacetTitle>{t('memory.screen.usage')}</FacetTitle>
      {USAGE.map((id) => (
        <FacetItem key={id} label={t(`memory.screen.usageBucket.${id}`)} count={counts.usage.get(id) ?? 0} active={filter.usage === id} onClick={() => setFacet('usage', id)} />
      ))}
      {counts.tag.size ? (
        <>
          <FacetTitle>{t('memory.screen.tags')}</FacetTitle>
          {[...counts.tag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([tag, n]) => (
            <FacetItem key={tag} label={`#${tag}`} count={n} active={filter.tag === tag} onClick={() => setFacet('tag', tag)} />
          ))}
        </>
      ) : null}
      {topics.length > 1 ? (
        <>
          <FacetTitle>{t('memory.screen.topics')}</FacetTitle>
          {topics.slice(0, 14).map((topic) => (
            <FacetItem
              key={topic.id || '_rest'}
              label={topic.id ? topic.label : t('memory.screen.topicOther')}
              count={topic.lessonIds.length}
              active={filter.topic === topic.id}
              onClick={() => setFacet('topic', topic.id)}
            />
          ))}
        </>
      ) : null}
    </nav>
  )

  // ── Token meter ──────────────────────────────────────────────────────────
  const budgetShare = budget.activeTokens ? Math.min(1, budget.injectedTokens / budget.activeTokens) : 0
  const meter = (
    <div className="flex min-w-0 items-center gap-2 px-3 pb-2 text-[12px]" data-testid="memory-token-meter" title={t('memory.screen.meterHint', { limit: LESSON_LIMITS.context })}>
      <span className="shrink-0 font-semibold">{t('memory.screen.meterTitle')}</span>
      <div className="relative h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-foreground/[0.1]" role="meter" aria-valuemin={0} aria-valuemax={budget.activeTokens} aria-valuenow={budget.injectedTokens} aria-label={t('memory.screen.meterTitle')}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.round(budgetShare * 100)}%` }} />
      </div>
      <span className="shrink-0 tabular-nums text-text-secondary">
        {t('memory.screen.meterValue', { tokens: budget.injectedTokens.toLocaleString(i18n.language), count: budget.injectedCount, total: budget.activeCount })}
      </span>
    </div>
  )

  // ── List ─────────────────────────────────────────────────────────────────
  const renderRow = (lesson: Lesson) => {
    const id = lessonId(lesson)
    const isSel = id === selectedId
    const isChecked = checked.has(id)
    return (
      <div
        key={id}
        role="option"
        aria-selected={isSel}
        data-lesson-id={id}
        data-testid="memory-row"
        onClick={() => setSelectedId(id)}
        className={cn(
          'group mx-1.5 flex cursor-default items-start gap-2 rounded-[6px] px-2 py-1.5',
          isSel ? 'bg-accent/15 shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-foreground/[0.04]',
          lesson.disabled && 'opacity-55',
        )}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => toggleCheck(id)}
          onClick={(event) => event.stopPropagation()}
          aria-label={t('memory.screen.select')}
          className={cn('mt-[3px] size-3.5 shrink-0 accent-[var(--accent)]', !isChecked && !checked.size && 'opacity-0 group-hover:opacity-100 focus:opacity-100')}
        />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] leading-[18px]">
            {lesson.negative ? <span className="mr-1 font-semibold text-destructive">{t('memory.screen.mustNot')}</span> : null}
            {lesson.rule}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-text-muted">
            {lesson.pinned ? <Chip tone="accent">{t('memory.screen.pinned')}</Chip> : null}
            {lesson.disabled ? <Chip>{t('memory.screen.disabled')}</Chip> : null}
            <Chip>{categoryLabel(lesson.category)}</Chip>
            {lesson.scope === 'global' ? <Chip tone="accent">{t('memory.screen.scopeGlobal')}</Chip> : null}
            {inContext.has(id) ? <span className="text-accent" title={t('memory.screen.inContextHint')}>● {t('memory.screen.inContext')}</span> : null}
            <span className="tabular-nums">{t('memory.usedCount', { count: lesson.usageCount ?? 0 })}</span>
            <span className="tabular-nums">≈{lessonTokens(lesson)} {t('memory.screen.tok')}</span>
            {lesson.conflicts?.length ? <span className="text-destructive">{t('memory.conflictCount', { count: lesson.conflicts.length })}</span> : null}
            {dupes.has(id) ? <span title={t('memory.screen.dupeHint')}>≈ {t('memory.screen.dupe')}</span> : null}
            {(lesson.tags ?? []).slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
          </div>
        </div>
      </div>
    )
  }

  const groups: Array<{ key: string; label: string; items: Lesson[] }> = grouped
    ? (() => {
        const map = new Map<string, Lesson[]>()
        for (const lesson of visible) {
          const key = topicOf.get(lessonId(lesson)) ?? ''
          map.set(key, [...(map.get(key) ?? []), lesson])
        }
        return topics.filter((topic) => map.has(topic.id)).map((topic) => ({
          key: topic.id || '_rest', label: topic.id ? topic.label : t('memory.screen.topicOther'), items: map.get(topic.id)!,
        }))
      })()
    : [{ key: 'all', label: '', items: visible }]

  const bulkBar = checked.size ? (
    <div className="mx-3 mb-2 flex flex-wrap items-center gap-1 rounded-[8px] bg-accent/10 px-2 py-1.5" role="toolbar" aria-label={t('memory.screen.bulk')} data-testid="memory-bulk-bar">
      <span className="mr-1 text-[12px] font-semibold">{t('memory.screen.selected', { count: checked.size })}</span>
      <Btn disabled={busy} onClick={() => void patchMany(checkedIds, (l) => (l.pinned ? null : { pinned: true }))}>{t('memory.screen.pin')}</Btn>
      <Btn disabled={busy} onClick={() => void patchMany(checkedIds, (l) => (l.pinned ? { pinned: false } : null))}>{t('memory.screen.unpin')}</Btn>
      <Btn disabled={busy} onClick={() => void patchMany(checkedIds, (l) => (l.disabled ? null : { disabled: true }))}>{t('memory.screen.disable')}</Btn>
      <Btn disabled={busy} onClick={() => void patchMany(checkedIds, (l) => (l.disabled ? { disabled: false } : null))}>{t('memory.screen.enable')}</Btn>
      <Btn disabled={busy || !checkedLessons.some((l) => l.scope === 'workspace')} onClick={() => void promote(checkedIds)}>{t('memory.screen.promote')}</Btn>
      <form className="flex items-center" onSubmit={(event) => {
        event.preventDefault()
        const tag = bulkTag.trim().replace(/^#/, '').toLowerCase()
        if (!tag) return
        setBulkTag('')
        void patchMany(checkedIds, (l) => ((l.tags ?? []).includes(tag) ? null : { tags: [...(l.tags ?? []), tag] }))
      }}>
        <input value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} placeholder={t('memory.screen.tagAdd')} aria-label={t('memory.screen.tagAdd')} className="h-7 w-[96px] rounded-[6px] bg-background/70 px-2 text-[12px] outline-none placeholder:text-text-muted" />
      </form>
      <Btn disabled={busy || !sameScope} title={sameScope ? undefined : t('memory.screen.mergeScopeHint')} onClick={() => openMerge(checkedIds)} testId="memory-bulk-merge">{t('memory.screen.merge')}</Btn>
      <Btn danger disabled={busy} onClick={() => setConfirm({ kind: 'delete', ids: checkedIds })} testId="memory-bulk-delete">{t('memory.screen.delete')}</Btn>
      <span className="flex-1" />
      <button type="button" onClick={() => setChecked(new Set())} className="h-7 rounded-[6px] px-2 text-[12px] text-text-secondary hover:text-foreground">{t('memory.screen.clearSelection')}</button>
    </div>
  ) : null

  const addForm = adding ? (
    <form className="mx-3 mb-2 flex flex-col gap-2 rounded-[8px] bg-foreground/[0.04] p-2" onSubmit={(event) => { event.preventDefault(); submitAdd() }} data-testid="memory-add-form">
      <textarea autoFocus value={addRule} onChange={(event) => setAddRule(event.target.value)} rows={2} placeholder={t('memory.rulePlaceholder')} aria-label={t('memory.addLesson')}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submitAdd() } if (event.key === 'Escape') setAdding(false) }}
        className="resize-none rounded-[6px] bg-background px-2 py-1.5 text-[13px] outline-none" />
      <div className="flex flex-wrap items-center gap-1">
        {(['workspace', 'global'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={addScope === s} onClick={() => setAddScope(s)} className={cn('h-6 rounded-[4px] px-2 text-[12px]', addScope === s ? 'bg-foreground/[0.12] font-semibold' : 'text-text-secondary hover:text-foreground')}>
            {t(s === 'global' ? 'memory.screen.scopeGlobal' : 'memory.screen.scopeWorkspace')}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-foreground/15" />
        {BUILTIN.map((c) => (
          <button key={c} type="button" aria-pressed={addCategory === c} onClick={() => setAddCategory(c)} className={cn('h-6 rounded-[4px] px-2 text-[12px]', addCategory === c ? 'bg-foreground/[0.12] font-semibold' : 'text-text-secondary hover:text-foreground')}>
            {t(`memory.category.${c}`)}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-1 text-[12px] text-text-secondary">
          <input type="checkbox" checked={addNegative} onChange={(event) => setAddNegative(event.target.checked)} className="accent-[var(--accent)]" />
          {t('memory.screen.mustNotRule')}
        </label>
        <span className="flex-1" />
        <Btn onClick={() => setAdding(false)}>{t('memory.cancel')}</Btn>
        <Btn primary disabled={!addRule.trim() || busy} onClick={submitAdd}>{t('memory.addLessonSubmit')}</Btn>
      </div>
    </form>
  ) : null

  const visibleCandidates = candidates.filter((c) => !all.some((l) => l.scope === 'global' && l.rule.trim().toLowerCase() === c.rule.trim().toLowerCase()))

  const list = (
    <section className="flex min-w-0 flex-1 flex-col bg-foreground/[0.025]" data-testid="memory-list">
      <header className="flex min-h-[44px] shrink-0 items-center gap-2 px-3 pt-2">
        <h2 className="text-[15px] font-semibold">{t('memory.screen.title')}</h2>
        <span className="truncate text-[12px] text-text-muted">{t('memory.screen.shown', { count: visible.length, total: all.length })}</span>
        <span className="flex-1" />
        <Btn primary onClick={() => setAdding((v) => !v)} testId="memory-add">+ {t('memory.screen.add')}</Btn>
      </header>
      {meter}
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 pb-2">
        <input
          ref={searchRef}
          value={filter.query ?? ''}
          onChange={(event) => setFilter((prev) => ({ ...prev, query: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.stopPropagation(); setFilter((prev) => ({ ...prev, query: '' })); listRef.current?.focus() }
            if (event.key === 'ArrowDown') { event.preventDefault(); if (visible[0]) setSelectedId(lessonId(visible[0])); listRef.current?.focus() }
          }}
          placeholder={t('memory.screen.searchPlaceholder')}
          aria-label={t('memory.screen.search')}
          data-testid="memory-search"
          className="h-7 min-w-[140px] flex-1 rounded-[6px] bg-foreground/[0.06] px-2 text-[12px] outline-none placeholder:text-text-muted"
        />
        <div className="flex items-center gap-0.5" role="group" aria-label={t('memory.screen.sort')}>
          {SORTS.map((id) => (
            <button key={id} type="button" aria-pressed={sort === id} onClick={() => setSort(id)} className={cn('h-7 rounded-[4px] px-1.5 text-[12px]', sort === id ? 'bg-foreground/[0.1] font-semibold text-foreground' : 'text-text-muted hover:text-foreground')}>
              {t(`memory.screen.sortBy.${id}`)}
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={grouped} onClick={() => setGrouped((v) => !v)} data-testid="memory-group-toggle" className={cn('h-7 rounded-[4px] px-2 text-[12px]', grouped ? 'bg-foreground/[0.1] font-semibold' : 'text-text-muted hover:text-foreground')}>
          {t('memory.screen.groupTopics')}
        </button>
      </div>
      {visibleCandidates.length ? (
        <div className="mx-3 mb-2 rounded-[8px] bg-accent/10 px-2 py-1.5 text-[12px]">
          {t('memory.screen.candidates', { count: visibleCandidates.length })}
          {visibleCandidates.slice(0, 3).map((c) => (
            <div key={c.rule} className="mt-1 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{c.rule}</span>
              <Btn onClick={() => void run(() => window.electronAPI.promoteLesson(null, c.rule), 'memory.promoted')}>{t('memory.screen.promote')}</Btn>
            </div>
          ))}
        </div>
      ) : null}
      {addForm}
      {bulkBar}
      <div ref={listRef} role="listbox" aria-multiselectable="true" aria-label={t('memory.screen.title')} tabIndex={0} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto pb-4 outline-none">
        {lessons === null ? (
          <div className="px-4 py-6 text-[13px] text-text-muted">{t('memory.screen.loading')}</div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-text-muted">{all.length ? t('memory.screen.noMatches') : t('memory.screen.empty')}</div>
        ) : groups.map((group) => (
          <div key={group.key} className="pb-1">
            {group.label ? (
              <div className="flex items-center gap-2 px-3.5 pb-1 pt-3 text-[12px] font-semibold">
                <span className="truncate">{group.label}</span>
                <span className="font-normal text-text-muted">{group.items.length}</span>
                <span className="flex-1" />
                <button type="button" className="text-[11px] font-normal text-text-muted hover:text-foreground" onClick={() => setChecked(new Set(group.items.map(lessonId)))}>{t('memory.screen.selectGroup')}</button>
              </div>
            ) : null}
            {group.items.map(renderRow)}
          </div>
        ))}
      </div>
    </section>
  )

  // ── Detail ───────────────────────────────────────────────────────────────
  const detail = selected ? (() => {
    const id = lessonId(selected)
    const sessionId = selected.source.sessionId
    const session = sessionId ? sessionMap.get(sessionId) : undefined
    const similar = nearDuplicates(selected, all)
    const history = [...(selected.usedAt ?? [])].reverse()
    const untracked = Math.max(0, (selected.usageCount ?? 0) - (selected.usedAt?.length ?? 0))
    return (
      <div className="flex min-h-0 flex-col gap-3 px-4 py-3" data-testid="memory-detail">
        <div className="flex flex-wrap items-center gap-1">
          <Btn onClick={() => void run(() => patch(selected, { pinned: !selected.pinned }))} testId="memory-pin">{selected.pinned ? t('memory.screen.unpin') : t('memory.screen.pin')}</Btn>
          <Btn onClick={() => void run(() => patch(selected, { disabled: !selected.disabled }))} testId="memory-disable">{selected.disabled ? t('memory.screen.enable') : t('memory.screen.disable')}</Btn>
          {selected.scope === 'workspace' ? <Btn onClick={() => void promote([id])} testId="memory-promote">{t('memory.screen.promote')}</Btn> : null}
          {selected.mergeHistory?.lessons.length ? <Btn disabled={busy} onClick={() => restoreMerge(selected)} testId="memory-merge-restore">{t('memory.screen.undoMerge')}</Btn> : null}
          <span className="flex-1" />
          <Btn danger onClick={() => setConfirm({ kind: 'delete', ids: [id] })} testId="memory-delete">{t('memory.screen.delete')}</Btn>
        </div>
        {selected.disabled ? <div className="rounded-[6px] bg-foreground/[0.06] px-2 py-1.5 text-[12px] text-text-secondary">{t('memory.screen.disabledBanner')}</div> : null}
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} aria-label={t('memory.editLesson')}
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); saveEdit(selected) } if (event.key === 'Escape') { event.stopPropagation(); setEditing(false) } }}
              className="resize-y rounded-[6px] bg-foreground/[0.05] px-2 py-1.5 text-[14px] leading-[20px] outline-none focus:bg-foreground/[0.07]" />
            <div className="flex gap-1">
              <Btn primary onClick={() => saveEdit(selected)}>{t('memory.save')}</Btn>
              <Btn onClick={() => setEditing(false)}>{t('memory.cancel')}</Btn>
              <span className="ml-auto self-center text-[11px] text-text-muted">≈{estimateTokens(draft)} {t('memory.screen.tok')}</span>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => { setDraft(selected.rule); setEditing(true) }} title={t('memory.editLesson')} className="whitespace-pre-wrap rounded-[6px] px-1 py-0.5 text-left text-[14px] leading-[20px] hover:bg-foreground/[0.04]" data-testid="memory-rule">
            {selected.negative ? <span className="mr-1 font-semibold text-destructive">{t('memory.screen.mustNot')}</span> : null}
            {selected.rule}
          </button>
        )}

        <div>
          <div className="pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">{t('memory.screen.properties')}</div>
          <Row label={t('memory.screen.scope')}>{t(selected.scope === 'global' ? 'memory.screen.scopeGlobal' : 'memory.screen.scopeWorkspace')}{selected.promoted ? ` · ${t('memory.screen.promotedFrom', { count: selected.promoted.workspaceIds.length })}` : ''}</Row>
          <Row label={t('memory.screen.type')}>
            <span className="flex flex-wrap gap-1">
              {BUILTIN.map((c) => (
                <button key={c} type="button" aria-pressed={selected.category === c} onClick={() => selected.category !== c && void run(() => patch(selected, { category: c }))} className={cn('h-6 rounded-[4px] px-1.5 text-[12px]', selected.category === c ? 'bg-foreground/[0.12] font-semibold' : 'text-text-secondary hover:text-foreground')}>
                  {t(`memory.category.${c}`)}
                </button>
              ))}
              {!BUILTIN.includes(selected.category) ? <Chip>{selected.category}</Chip> : null}
            </span>
          </Row>
          <Row label={t('memory.screen.kind')}>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={Boolean(selected.negative)} onChange={() => void run(() => patch(selected, { negative: !selected.negative }))} className="accent-[var(--accent)]" />
              {t('memory.screen.mustNotRule')}
            </label>
          </Row>
          <Row label={t('memory.screen.tags')}>
            <span className="flex flex-wrap items-center gap-1">
              {(selected.tags ?? []).map((tag) => (
                <button key={tag} type="button" onClick={() => void run(() => patch(selected, { tags: (selected.tags ?? []).filter((x) => x !== tag) }))} title={t('memory.screen.tagRemove')} className="inline-flex h-[20px] items-center gap-1 rounded-[4px] bg-foreground/[0.07] px-1.5 text-[11px] hover:bg-destructive/12 hover:text-destructive">
                  #{tag} ×
                </button>
              ))}
              <form onSubmit={(event) => { event.preventDefault(); addTag(selected, tagDraft); setTagDraft('') }}>
                <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder={t('memory.screen.tagAdd')} aria-label={t('memory.screen.tagAdd')} list="memory-tag-options" className="h-[20px] w-[96px] rounded-[4px] bg-foreground/[0.05] px-1.5 text-[11px] outline-none placeholder:text-text-muted" />
                <datalist id="memory-tag-options">{[...counts.tag.keys()].map((tag) => <option key={tag} value={tag} />)}</datalist>
              </form>
            </span>
          </Row>
          <Row label={t('memory.screen.tokens')}>≈{lessonTokens(selected)} {t('memory.screen.tok')} · {inContext.has(id) ? t('memory.screen.inContextNow') : selected.disabled ? t('memory.screen.notInjectedDisabled') : t('memory.screen.notInjected')}</Row>
        </div>

        <div>
          <div className="pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">{t('memory.screen.provenance')}</div>
          <Row label={t('memory.screen.created')}>{fmt(selected.ts)}</Row>
          <Row label={t('memory.screen.source')}>{t(`memory.screen.trigger.${selected.source.trigger}`)}</Row>
          {sessionId ? (
            <Row label={t('memory.screen.session')}>
              <button type="button" className="text-left text-accent underline-offset-2 hover:underline" onClick={() => { try { navigate(routes.view.allSessions(sessionId)) } catch { /* session gone */ } }} data-testid="memory-source-session">
                {session ? getSessionTitle(session) : t('memory.screen.sessionUnavailable', { id: sessionId.slice(0, 8) })}
              </button>
            </Row>
          ) : null}
          {selected.editedAt ? <Row label={t('memory.screen.edited')}>{fmt(selected.editedAt)}</Row> : null}
          {selected.mergedFrom?.length ? (
            <Row label={t('memory.screen.mergedFrom')}>
              <ul className="list-disc pl-4 text-text-secondary">{selected.mergedFrom.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </Row>
          ) : null}
        </div>

        <div>
          <div className="pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">{t('memory.screen.usageHistory')}</div>
          <Row label={t('memory.screen.used')}>{t('memory.usedCount', { count: selected.usageCount ?? 0 })}</Row>
          <Row label={t('memory.screen.lastUsed')}>{fmt(selected.lastUsedAt)}</Row>
          {history.length ? (
            <ul className="mt-1 flex flex-col gap-0.5 text-[12px] tabular-nums text-text-secondary" data-testid="memory-usage-history">
              {history.map((ts, index) => <li key={`${ts}-${index}`}>{fmt(ts)}</li>)}
            </ul>
          ) : null}
          {untracked > 0 ? <p className="mt-1 text-[11px] text-text-muted">{t('memory.screen.untracked', { count: untracked })}</p> : null}
          {selected.conflicts?.length ? (
            <div className="mt-2">
              <div className="text-[12px] font-semibold text-destructive">{t('memory.conflictCount', { count: selected.conflicts.length })}</div>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-[12px] text-text-secondary">
                {[...selected.conflicts].reverse().slice(0, 8).map((c, index) => (
                  <li key={`${c.ts}-${index}`}>
                    {fmt(c.ts)} · {t(`memory.screen.conflictReason.${c.reason}`)} ·{' '}
                    <button type="button" className="text-accent hover:underline" onClick={() => { try { navigate(routes.view.allSessions(c.sessionId)) } catch { /* gone */ } }}>{t('memory.screen.openSession')}</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div>
          <div className="pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">{t('memory.screen.similar')}</div>
          {similar.length === 0 ? (
            <p className="text-[12px] text-text-muted">{t('memory.screen.noSimilar')}</p>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="memory-similar">
              {similar.map(({ lesson, score }) => (
                <li key={lessonId(lesson)} className="flex items-start gap-2 rounded-[6px] bg-foreground/[0.03] px-2 py-1.5 text-[12px]">
                  <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => setSelectedId(lessonId(lesson))}>{lesson.rule}</button>
                  <span className="shrink-0 tabular-nums text-text-muted">{Math.round(score * 100)}%</span>
                  <Btn onClick={() => openMerge([id, lessonId(lesson)])}>{t('memory.screen.merge')}</Btn>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  })() : (
    <div className="flex flex-col gap-2 px-5 py-6 text-[12px] text-text-muted" data-testid="memory-detail-empty">
      <p className="text-[13px]">{t('memory.screen.selectHint')}</p>
      <p>{t('memory.screen.keysHint')}</p>
      <p>{t('memory.screen.meterHint', { limit: LESSON_LIMITS.context })}</p>
    </div>
  )

  const confirmDialog = confirm?.kind === 'delete' ? (
    <Confirm
      title={t('memory.screen.deleteTitle', { count: confirm.ids.length })}
      body={(
        <>
          <p>{t('memory.screen.deleteBody')}</p>
          <ul className="mt-2 max-h-[160px] list-disc overflow-y-auto pl-4">
            {confirm.ids.slice(0, 8).map((id) => <li key={id} className="truncate">{byId.get(id)?.rule}</li>)}
            {confirm.ids.length > 8 ? <li>… +{confirm.ids.length - 8}</li> : null}
          </ul>
        </>
      )}
      confirmLabel={t('memory.screen.delete')}
      onConfirm={() => { const ids = confirm.ids; setConfirm(null); void removeMany(ids) }}
      onCancel={() => setConfirm(null)}
    />
  ) : confirm?.kind === 'merge' ? (
    <Confirm
      title={t('memory.screen.mergeTitle', { count: confirm.ids.length })}
      body={t('memory.screen.mergeBody')}
      confirmLabel={t('memory.screen.merge')}
      onConfirm={() => doMerge(confirm.ids)}
      onCancel={() => setConfirm(null)}
    >
      <div className="mt-3 flex max-h-[200px] flex-col gap-1 overflow-y-auto" role="radiogroup" aria-label={t('memory.screen.mergeKeep')}>
        {confirm.ids.map((id) => {
          const lesson = byId.get(id)
          if (!lesson) return null
          return (
            <label key={id} className="flex items-start gap-2 rounded-[6px] px-1 py-1 text-[12px] hover:bg-foreground/[0.04]">
              <input type="radio" name="memory-merge-keeper" checked={mergeKeeper === id} onChange={() => { setMergeKeeper(id); setMergeText(lesson.rule) }} className="mt-0.5 accent-[var(--accent)]" />
              <span className="min-w-0 flex-1">{lesson.rule}</span>
              <span className="shrink-0 text-text-muted">{t('memory.usedCount', { count: lesson.usageCount ?? 0 })}</span>
            </label>
          )
        })}
      </div>
      <textarea value={mergeText} onChange={(event) => setMergeText(event.target.value)} rows={3} aria-label={t('memory.screen.mergeText')} className="mt-2 w-full resize-y rounded-[6px] bg-foreground/[0.05] px-2 py-1.5 text-[13px] outline-none" />
    </Confirm>
  ) : null

  return (
    <div className="flex h-full min-h-0 bg-background font-sans text-[13px] text-foreground" data-testid="memory-screen">
      {facets}
      {filesView ? (
        <section className="min-w-0 flex-1 overflow-y-auto px-2 py-2" data-testid="memory-files">
          <MemoryListPanel workspaceId={workspaceId} variant="files" />
        </section>
      ) : archiveView ? (
        <section className="min-w-0 flex-1 overflow-y-auto px-4 py-3" data-testid="memory-archive">
          <h2 className="mb-3 text-[14px] font-semibold">{t('memory.screen.archiveTitle')}</h2>
          {archivedLessons.length === 0 ? (
            <p className="text-text-muted" data-testid="memory-archive-empty">{t('memory.screen.archiveEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {archivedLessons.map((entry) => (
                <li key={entry.id} data-testid="memory-archive-row" className="flex items-start gap-3 rounded-[8px] bg-foreground/[0.04] p-3">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words">{entry.lesson.rule}</p>
                    <p className="mt-1 text-[11px] text-text-muted">{t(entry.lesson.scope === 'global' ? 'memory.screen.scopeGlobal' : 'memory.screen.scopeWorkspace')} · {fmt(entry.lesson.ts)}</p>
                  </div>
                  <Btn disabled={busy} onClick={() => void restoreArchived(entry)}>{t('memory.screen.archiveRestore')}</Btn>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {list}
          <section className="flex w-[clamp(300px,34%,440px)] shrink-0 flex-col overflow-y-auto bg-background">{detail}</section>
        </>
      )}
      {confirmDialog}
    </div>
  )
}
