import * as React from 'react'
import { focusedPanelIdAtom } from '@/atoms/panel-stack'
import { useTourTarget, useTourSignals } from '@/features/product-tour/runtime/hooks'
import { connectionCapabilities } from '@/features/product-tour/adapters/connections'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Zap, PackageOpen, Check, ChevronDown, ChevronRight, X, Network, FolderX, KeyRound, TriangleAlert, RefreshCw, Archive, FolderOutput, MoreHorizontal, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { skillSelection } from '@/hooks/useEntitySelection'
import { SkillMenu } from './SkillMenu'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { detectSkillRiskFlags, lineDiff, RISK_FLAG_I18N_KEY, VIOLATION_I18N_KEY, type SkillRiskFlag } from '@/lib/skill-risk'
import type { PendingSkill, PendingSkillDiff, SkillUsageMap } from '@rox/shared/memory/types'
import { activeSessionIdAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { projectsAtom } from '@/atoms/projects'
import type { BundledSkillPackStatus, LoadedSkill } from '../../../shared/types'
import { toErrorMessage } from '@/lib/errors'
import { useSkillsQuery } from '@/hooks/use-skills-query'
import { VirtualList } from '@/components/ui/virtual-list'
import { useScreenSidebar } from '@/components/shell/screen-sidebar'
import { navigate, routes } from '@/lib/navigate'
import { addNotebook, loadNotebooks, requestOpenNotebook, subscribeNotebooks, type PlaybookNotebook } from '@/pages/playbooks/notebook-store'
import { buildSkillsSidebarGroups } from './skills-sidebar'

const SendResourceToWorkspaceDialog = React.lazy(() =>
  import('./SendResourceToWorkspaceDialog').then((m) => ({ default: m.SendResourceToWorkspaceDialog })),
)

const RISK_FLAG_ICON: Record<SkillRiskFlag, typeof Network> = {
  'network': Network,
  'fs-outside': FolderX,
  'secrets': KeyRound,
  'sudo': TriangleAlert,
}

/** Placeholder height for offscreen EntityRow (py-3 + title + description). */
const SKILL_ROW_CONTAIN_SIZE = 'auto 80px'

const SKILL_ROW_STYLE: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: SKILL_ROW_CONTAIN_SIZE,
}

export interface SkillsListPanelProps {
  skills: LoadedSkill[]
  /** A skills load is pending/retrying (e.g. a slow bundled-skills sync). */
  syncing?: boolean
  onDeleteSkill: (skillSlug: string) => void
  onSkillClick: (skill: LoadedSkill) => void
  selectedSkillSlug?: string | null
  workspaceId?: string
  workingDirectory?: string
  workspaceRootPath?: string
  className?: string
}

export function SkillsListPanel({
  skills,
  syncing,
  onDeleteSkill,
  onSkillClick,
  selectedSkillSlug,
  workspaceId,
  workingDirectory,
  workspaceRootPath,
  className,
}: SkillsListPanelProps) {
  const { t } = useTranslation()
  const { reset: resetCraftSelection } = skillSelection.useSelection()
  const [search, setSearch] = React.useState('')
  const queried = useSkillsQuery({
    workspaceId,
    workingDirectory,
    query: search,
  })
  const listedSkills = queried.enabled ? queried.items : skills
  const listSyncing = queried.enabled ? queried.loading || !!syncing : !!syncing
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const { workspaces, activeWorkspaceId } = useAppShellContext()
  const hasOtherWorkspaces = workspaces.length > 1
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const tourScope = { workspaceId: workspaceId ?? activeWorkspaceId ?? undefined, panelId: focusedPanelId ?? undefined }
  const skillsTarget = useTourTarget('skills.list', tourScope)
  const tour = useTourSignals(tourScope)
  React.useEffect(() => tour.capability('skills.available', connectionCapabilities({ skills: listedSkills })['skills.available']!), [tour, listedSkills])

  // Runtime skills (~/.omp/agent/skills, {workspace}/.omp/skills) render as a
  // separate read-only group with an "Export as Rox skill" action.
  const craftSkills = listedSkills.filter((s) => s.source !== 'omp')
  const repeatedSkillNames = React.useMemo(() => {
    const seen = new Set<string>()
    const repeated = new Set<string>()
    for (const skill of listedSkills) {
      if (skill.source === 'omp') continue
      if (seen.has(skill.metadata.name)) repeated.add(skill.metadata.name)
      seen.add(skill.metadata.name)
    }
    return repeated
  }, [listedSkills])
  const ompSkills = listedSkills.filter((s) => s.source === 'omp')
  const [exportingSlug, setExportingSlug] = React.useState<string | null>(null)

  // Pending skill candidates from the self-learning distillation queue.
  const [pendingSkills, setPendingSkills] = React.useState<PendingSkill[]>([])
  const [expandedPendingSlug, setExpandedPendingSlug] = React.useState<string | null>(null)
  // S3: diff payload for the currently expanded update candidate.
  const [pendingDiff, setPendingDiff] = React.useState<{ slug: string; data: PendingSkillDiff } | null>(null)
  // S4: per-skill prompt-hit counters (null until the first successful read —
  // a failed read must not mark every skill as prunable).
  const [skillUsage, setSkillUsage] = React.useState<SkillUsageMap | null>(null)
  const [pruneConfirmOpen, setPruneConfirmOpen] = React.useState(false)
  const [pruneBusy, setPruneBusy] = React.useState(false)
  const [bundledPacks, setBundledPacks] = React.useState<BundledSkillPackStatus[] | null>(null)
  const [packsBusy, setPacksBusy] = React.useState(false)
  const effectiveWorkspaceId = workspaceId ?? activeWorkspaceId

  // T1: export target = the project the active session is bound to.
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const projects = useAtomValue(projectsAtom)
  const activeProjectId = activeSessionId ? sessionMetaMap.get(activeSessionId)?.projectId : undefined
  const activeProjectRoot = React.useMemo(() => {
    if (!activeProjectId) return undefined
    return projects.find((p) => p.config.id === activeProjectId)?.folderPath
  }, [projects, activeProjectId])

  React.useEffect(() => {
    if (!effectiveWorkspaceId) {
      setPendingSkills([])
      setSkillUsage(null)
      return
    }
    let cancelled = false
    const load = () => {
      window.electronAPI
        .listPendingSkills(effectiveWorkspaceId)
        .then((items) => { if (!cancelled) setPendingSkills(items) })
        .catch(() => { if (!cancelled) setPendingSkills([]) })
      // S4: usage counters ride the same refresh trigger as the pending queue.
      window.electronAPI
        .getSkillUsage(effectiveWorkspaceId)
        .then((map) => { if (!cancelled) setSkillUsage(map) })
        .catch(() => { if (!cancelled) setSkillUsage(null) })
    }
    load()
    // Refetch when the pending queue or the approved skills list change —
    // approving a candidate moves it into the main list and bumps skills.CHANGED.
    const offPending = window.electronAPI.onSkillsPendingChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === effectiveWorkspaceId) load()
    })
    const offSkills = window.electronAPI.onSkillsChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === effectiveWorkspaceId) load()
    })
    return () => { cancelled = true; offPending(); offSkills() }
  }, [effectiveWorkspaceId])

  // Bundled skill packs (moved from Context settings — P2.1)
  React.useEffect(() => {
    let cancelled = false
    const load = () => {
      window.electronAPI
        .listBundledSkillPacks()
        .then((packs) => { if (!cancelled) setBundledPacks(packs) })
        .catch(() => { if (!cancelled) setBundledPacks([]) })
    }
    load()
    const off = window.electronAPI.onBundledSkillsChanged(() => load())
    return () => { cancelled = true; off() }
  }, [])

  const toggleBundledPack = async (slug: string, enabled: boolean) => {
    if (!bundledPacks) return
    setPacksBusy(true)
    try {
      const currentlyDisabled = bundledPacks.filter((p) => p.disabled).map((p) => p.slug)
      const next = enabled
        ? currentlyDisabled.filter((s) => s !== slug)
        : [...new Set([...currentlyDisabled, slug])]
      await window.electronAPI.setBundledSkillsDisabled(next)
      const refreshed = await window.electronAPI.listBundledSkillPacks()
      setBundledPacks(refreshed)
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setPacksBusy(false)
    }
  }

  // Fetch the diff when an update candidate is expanded (S3). Cached per
  // slug for the lifetime of the expansion; refetched after list reloads.
  React.useEffect(() => {
    const expanded = pendingSkills.find((c) => c.slug === expandedPendingSlug)
    if (!effectiveWorkspaceId || !expanded?.updates) {
      setPendingDiff(null)
      return
    }
    let cancelled = false
    window.electronAPI
      .diffPendingSkill(effectiveWorkspaceId, expanded.slug)
      .then((data) => { if (!cancelled) setPendingDiff({ slug: expanded.slug, data }) })
      .catch(() => { if (!cancelled) setPendingDiff(null) })
    return () => { cancelled = true }
  }, [effectiveWorkspaceId, expandedPendingSlug, pendingSkills])

  const handlePendingAction = async (slug: string, action: 'approve' | 'dismiss', description?: string, force = false) => {
    if (!effectiveWorkspaceId) return
    try {
      if (action === 'approve') {
        await window.electronAPI.approvePendingSkill(effectiveWorkspaceId, slug, force)
        toast.success(t('pendingSkills.approved', { slug }))
      } else {
        await window.electronAPI.dismissPendingSkill(effectiveWorkspaceId, slug, description)
        toast.success(t('pendingSkills.dismissed', { slug }))
      }
      setExpandedPendingSlug((current) => (current === slug ? null : current))
    } catch (err) {
      toast.error(action === 'approve' ? t('pendingSkills.approveFailed') : t('pendingSkills.dismissFailed'), {
        description: toErrorMessage(err),
      })
    }
  }

  // Send to Workspace dialog state
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [sendResourceSlug, setSendResourceSlug] = React.useState<string | null>(null)
  const [sendResourceLabel, setSendResourceLabel] = React.useState('')

  const handleExportOmpSkill = async (skill: LoadedSkill) => {
    const targetWorkspaceId = workspaceId ?? activeWorkspaceId
    if (!targetWorkspaceId || exportingSlug) return
    setExportingSlug(skill.slug)
    try {
      const result = await window.electronAPI.importOmpSkill(targetWorkspaceId, skill.slug)
      toast.success(t('skillsList.roxCliExported', { name: skill.metadata.name, slug: result.slug }))
    } catch (err) {
      toast.error(t('skillsList.roxCliExportFailed'), {
        description: toErrorMessage(err),
      })
    } finally {
      setExportingSlug(null)
    }
  }

  // S4: prune candidates = workspace-scope skills the prompt never mentioned.
  // Skills are archived (never deleted) server-side; unknown usage (read
  // failure) disqualifies everything rather than the other way round.
  const pruneCandidates = React.useMemo(() => {
    if (!skillUsage) return []
    return craftSkills.filter(
      (s) => s.source === 'workspace' && (skillUsage[s.slug]?.used ?? 0) === 0,
    )
  }, [craftSkills, skillUsage])

  const handlePrune = async () => {
    if (!effectiveWorkspaceId || pruneBusy || pruneCandidates.length === 0) return
    setPruneBusy(true)
    try {
      const result = await window.electronAPI.pruneSkills(effectiveWorkspaceId, 30, pruneCandidates.map((s) => s.slug))
      setPruneConfirmOpen(false)
      toast.success(t('skills.pruned', { count: result.archived.length }))
    } catch (err) {
      toast.error(t('toast.failedToPruneSkills'), {
        description: toErrorMessage(err),
      })
    } finally {
      setPruneBusy(false)
    }
  }

  // T1: copy a workspace skill into the active project's .agents/skills.
  const handleExportToProject = async (skill: LoadedSkill) => {
    if (!effectiveWorkspaceId || !activeProjectRoot) return
    try {
      const result = await window.electronAPI.exportSkillToProject(effectiveWorkspaceId, skill.slug, activeProjectRoot)
      toast.success(t('skills.exported', { slug: result.slug }))
    } catch (err) {
      toast.error(t('toast.failedToExportSkill'), {
        description: toErrorMessage(err),
      })
    }
  }

  // Render EntityPanel empty state only when there are no skills at all —
  // a workspace with only runtime skills shouldn't show "No skills configured".
  // While a load is pending/retrying (e.g. a slow bundled-skills sync that
  // outlived the client timeout) show a syncing placeholder instead of
  // claiming the workspace has no skills.
  const emptyState = listSyncing ? (
    <div
      className="flex flex-col items-center justify-center gap-2 p-6 text-xs text-muted-foreground"
      role="status"
      data-list-role="skills-syncing"
    >
      <RefreshCw className="icon-caption animate-spin" />
      {t('common.loading')}
    </div>
  ) : ompSkills.length > 0 ? undefined : (
    <EntityListEmptyScreen
      icon={<Zap />}
      title={t('skillsList.noSkillsConfigured')}
      description={t('skillsList.emptyDescription')}
      docKey="skills"
    >
      {workspaceRootPath && (
        <EditPopover
          align="center"
          trigger={
            <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[var(--radius-control)] bg-surface-hover hover:bg-surface-pressed transition-colors">
              {t('skillsList.addSkill')}
            </button>
          }
          {...getEditConfig('add-skill', workspaceRootPath)}
        />
      )}
    </EntityListEmptyScreen>
  )

  // Second sidebar (shell API): Мои навыки / Плейбуки / Маркетплейс.
  const [playbooks, setPlaybooks] = React.useState<{ list: PlaybookNotebook[] | null; error: boolean }>({ list: null, error: false })
  const reloadPlaybooks = React.useCallback(() => {
    try { setPlaybooks({ list: loadNotebooks(), error: false }) } catch { setPlaybooks({ list: [], error: true }) }
  }, [])
  React.useEffect(() => {
    reloadPlaybooks()
    return subscribeNotebooks(reloadPlaybooks)
  }, [reloadPlaybooks])
  // «Каталог» is the bundled skill packs section of this panel; without packs
  // fall back to the marketplace settings page so the action is never a no-op.
  const catalogRef = React.useRef<HTMLDivElement>(null)
  const hasCatalog = Boolean(bundledPacks && bundledPacks.length > 0)
  const openCatalog = React.useCallback(() => {
    const section = catalogRef.current
    if (!hasCatalog || !section) { navigate(routes.view.settings('marketplace')); return }
    section.scrollIntoView({ block: 'start', behavior: 'smooth' })
    section.focus({ preventScroll: true })
  }, [hasCatalog])
  const onSkillClickRef = React.useRef(onSkillClick)
  onSkillClickRef.current = onSkillClick
  const sidebarConfig = React.useMemo(() => ({
    screenId: 'skills',
    title: t('screenSidebar.skills.title'),
    search: { placeholder: t('screenSidebar.skills.search'), value: search, onChange: setSearch },
    primaryAction: { id: 'browse', label: t('screenSidebar.skills.browse'), icon: Plus, onSelect: openCatalog },
    groups: buildSkillsSidebarGroups({
      skills: listedSkills,
      syncing: listSyncing,
      playbooks: playbooks.list,
      playbooksError: playbooks.error,
      selectedSlug: selectedSkillSlug ?? null,
      t,
      onOpenSkill: (skill) => onSkillClickRef.current(skill),
      onOpenPlaybooks: () => navigate(routes.view.playbooks()),
      onOpenPlaybook: (notebook) => { requestOpenNotebook(notebook.id); navigate(routes.view.playbooks()) },
      onCreatePlaybook: () => {
        try {
          const notebook = addNotebook(t('playbooks.home.defaultName'), 'knowledge')
          requestOpenNotebook(notebook.id)
          navigate(routes.view.playbooks())
        } catch (error) {
          toast.error(toErrorMessage(error))
        }
      },
      onRetryPlaybooks: reloadPlaybooks,
      onOpenCatalog: openCatalog,
      onOpenMarketplace: () => navigate(routes.view.settings('marketplace')),
    }),
  }), [listedSkills, listSyncing, playbooks, selectedSkillSlug, search, t, openCatalog, reloadPlaybooks])
  useScreenSidebar(sidebarConfig)

  return (
    <div ref={skillsTarget} className="flex min-h-0 flex-1 flex-col" data-product-tour-target="skills.list">
    <style>{`
      [data-list-role="skills"] [data-skill-row] {
        content-visibility: auto;
        contain-intrinsic-size: ${SKILL_ROW_CONTAIN_SIZE};
      }
    `}</style>
    {/* S4 header: prune (archive) never-used workspace skills. Hidden when
        every workspace skill saw at least one prompt hit. */}
    {effectiveWorkspaceId && pruneCandidates.length > 0 && (
      <div className="mx-2 mb-1 flex items-center justify-end gap-1.5" data-list-role="skills-prune">
        {pruneConfirmOpen ? (
          <>
            <span className="text-xs text-muted-foreground">
              {t('skills.pruneConfirm', { count: pruneCandidates.length })}
            </span>
            <button
              type="button"
              disabled={pruneBusy}
              onClick={() => void handlePrune()}
              className="inline-flex items-center h-5 px-1.5 text-xs font-medium rounded-[var(--radius-control)] bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors disabled:opacity-50"
            >
              {t('skills.pruneButton')}
            </button>
            <button
              type="button"
              disabled={pruneBusy}
              onClick={() => setPruneConfirmOpen(false)}
              className="inline-flex items-center h-5 px-1.5 text-xs font-medium rounded-[var(--radius-control)] bg-surface-hover text-muted-foreground hover:bg-surface-pressed transition-colors disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <HeaderIconButton
            icon={<Archive className="icon-toolbar" />}
            tooltip={t('skills.pruneButton')}
            aria-label={t('skills.pruneButton')}
            onClick={() => setPruneConfirmOpen(true)}
          />
        )}
      </div>
    )}
    {/* A pending reload stays visible even while the previous list is still
        rendered (e.g. a slow bundled-skills sync that outlived the timeout). */}
    {listSyncing && craftSkills.length > 0 && (
      <div
        className="mx-2 mb-1 flex items-center gap-1.5 text-caption text-muted-foreground"
        role="status"
        data-list-role="skills-syncing"
      >
        <RefreshCw className="icon-status animate-spin" />
        {t('common.loading')}
      </div>
    )}
    <EntityPanel<LoadedSkill>
      items={craftSkills}
      getId={(s) => s.slug}
      selection={skillSelection}
      selectedId={selectedSkillSlug}
      onItemClick={onSkillClick}
      className={className}
      containerProps={{ 'data-list-role': 'skills' }}
      emptyState={emptyState}
      header={(
        <div className="px-2 pb-1.5 space-y-1">
          <label className="relative block">
            <Search className="absolute left-2 top-2 icon-caption text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('skillsList.searchPlaceholder')}
              aria-label={t('skillsList.searchPlaceholder')}
              className="h-8 w-full rounded-md border border-border/60 bg-transparent pl-7 pr-2 text-xs"
            />
          </label>
          {queried.enabled && queried.total > 0 && (
            <div className="flex items-center justify-between gap-2 px-0.5 text-xs text-muted-foreground">
              <span className="numeric">{listedSkills.length}/{queried.total}</span>
              {queried.hasMore && (
                <button type="button" className="hover:text-foreground" onClick={() => queried.loadMore()}>
                  {t('common.more')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      mapItem={(skill) => ({
        icon: <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />,
        title: skill.metadata.name,
        badges: (
          <span className="flex items-center gap-1.5 min-w-0">
            {repeatedSkillNames.has(skill.metadata.name) && (
              <span className="shrink-0 max-w-48 truncate rounded-full bg-surface-hover px-1.5 py-0.5 font-mono text-xs text-muted-foreground" title={skill.slug}>
                @{skill.slug}
              </span>
            )}
            {skill.source === 'project' && (
              <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-surface-hover text-muted-foreground">
                {t('skillsList.projectBadge')}
              </span>
            )}
            <span className="truncate">{skill.metadata.description}</span>
          </span>
        ),
        trailing: (() => {
          // S4: right-side usage chip; T1: export affordance only when an
          // active project exists to receive the copy.
          const used = skillUsage?.[skill.slug]?.used ?? 0
          const lastUsedAt = skillUsage?.[skill.slug]?.lastUsedAt
          const showUsage = skill.source === 'workspace' && used > 0
          const canExportToProject = skill.source === 'workspace' && !!activeProjectRoot
          if (!showUsage && !canExportToProject) return undefined
          return (
            <>
              {showUsage && (
                <span
                  title={t('skills.usageChip', {
                    count: used,
                    date: lastUsedAt ? new Date(lastUsedAt).toLocaleDateString() : '—',
                  })}
                  className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-surface-hover text-muted-foreground numeric"
                >
                  {used}×
                </span>
              )}
              {canExportToProject && (
                <button
                  type="button"
                  title={t('skills.exportToProject')}
                  aria-label={t('skills.exportToProject')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); void handleExportToProject(skill) }}
                  className="inline-flex items-center justify-center size-5 rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
                >
                  <FolderOutput className="icon-status" />
                </button>
              )}
            </>
          )
        })(),
        menu: (
          <SkillMenu
            skillSlug={skill.slug}
            skillName={skill.metadata.name}
            onOpenInNewWindow={() => window.electronAPI.openUrl(`rox://skills/skill/${skill.slug}?window=focused`)}
            onShowInFinder={async () => {
              if (!canRevealLocally) return
              try {
                await window.electronAPI.showInFolder(skill.path)
              } catch (err) {
                const message = toErrorMessage(err)
                toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
                  description: message,
                })
              }
            }}
            canShowInFinder={canRevealLocally}
            onDelete={skill.source === 'workspace' ? () => onDeleteSkill(skill.slug) : undefined}
            canDelete={skill.source === 'workspace'}
            deleteLabel={skill.source === 'workspace' ? t('skillsList.deleteSkill') : t('skillsList.managedByProject')}
            onSendToWorkspace={hasOtherWorkspaces && skill.source === 'workspace' ? () => {
              setSendResourceSlug(skill.slug)
              setSendResourceLabel(skill.metadata.name)
              setSendDialogOpen(true)
            } : undefined}
          />
        ),
        dataAttributes: { 'data-skill-row': '' },
      })}
    />

    {/* Pending skill candidates awaiting approval */}
    {pendingSkills.length > 0 && (
      <div className="mb-2 pb-1.5 border-b border-border-subtle" data-list-role="pending-skills">
        <div className="px-2 pb-1 flex items-center gap-1.5 text-xs font-medium uppercase caps-label text-muted-foreground/70">
          {t('pendingSkills.section')}
          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-accent/15 text-accent text-xs font-semibold numeric">
            {pendingSkills.length}
          </span>
        </div>
        <ul>
          {pendingSkills.map((candidate) => {
            const expanded = expandedPendingSlug === candidate.slug
            return (
              <li key={candidate.slug} style={SKILL_ROW_STYLE} className="mx-0 px-2 py-1.5 rounded-[var(--radius-control)] hover:bg-surface-hover">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setExpandedPendingSlug(expanded ? null : candidate.slug)}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {expanded ? <ChevronDown className="icon-status shrink-0 text-muted-foreground" /> : <ChevronRight className="icon-status shrink-0 text-muted-foreground" />}
                    <span className="truncate text-sm font-medium">{candidate.slug}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground pl-4">
                    {candidate.description}
                  </span>
                </button>
                {expanded && (() => {
                  const violations = candidate.violations ?? []
                  const violationReasons = violations.map((v) => t(VIOLATION_I18N_KEY[v] ?? v))
                  const isUpdate = candidate.updates !== undefined
                  const diff = pendingDiff?.slug === candidate.slug ? pendingDiff.data : null
                  return (
                  <div className="mt-1.5 pl-4 space-y-1.5">
                    {isUpdate && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <RefreshCw className="icon-status shrink-0" />
                        {t('pendingSkills.updatesNote', { slug: candidate.updates, version: candidate.nextVersion ?? 2 })}
                      </div>
                    )}
                    {/* S1: heuristic risk flags */}
                    {(() => {
                      const flags = detectSkillRiskFlags(candidate.content)
                      return flags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {flags.map((flag) => {
                            const Icon = RISK_FLAG_ICON[flag]
                            return (
                              <span
                                key={flag}
                                className="inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium"
                              >
                                <Icon className="size-3" />
                                {t(RISK_FLAG_I18N_KEY[flag])}
                              </span>
                            )
                          })}
                        </div>
                      )
                    })()}
                    {/* S2: script-validation block reason */}
                    {violations.length > 0 && (
                      <div className="flex items-start gap-1.5 rounded-[var(--radius-card)] bg-destructive/10 px-2 py-1.5 text-xs text-destructive-foreground">
                        <TriangleAlert className="icon-status mt-0.5 shrink-0 text-destructive" />
                        <span>
                          <span className="font-medium">{t('pendingSkills.violationsBlock')}</span>{' '}
                          {violationReasons.join(', ')}
                        </span>
                      </div>
                    )}
                    {isUpdate && diff && diff.base !== null ? (
                      <div>
                        <div className="flex items-center gap-1.5 pb-1 text-xs font-medium uppercase caps-label text-muted-foreground/70">
                          {t('pendingSkills.diffTitle')}
                          <span className="normal-case tracking-normal text-muted-foreground/50">
                            {t('pendingSkills.diffCurrent')} → {t('pendingSkills.diffProposed')}
                          </span>
                        </div>
                        <pre className="max-h-56 overflow-auto rounded-[var(--radius-card)] bg-surface-hover p-2 text-xs text-text-secondary">
                          {lineDiff(diff.base, diff.candidate).map((line, idx) => (
                            <span
                              key={idx}
                              className={
                                line.type === 'add'
                                  ? 'block text-emerald-600 dark:text-emerald-400'
                                  : line.type === 'remove'
                                    ? 'block text-destructive/80 line-through'
                                    : 'block'
                              }
                            >
                              {line.type === 'add' ? '+ ' : line.type === 'remove' ? '− ' : '  '}
                              {line.text}{'\n'}
                            </span>
                          ))}
                        </pre>
                      </div>
                    ) : (
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[var(--radius-card)] bg-surface-hover p-2 text-xs text-text-secondary">
                        {candidate.content}
                      </pre>
                    )}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={violations.length > 0}
                        title={violations.length > 0
                          ? t('pendingSkills.approveDisabledReason', { reasons: violationReasons.join(', ') })
                          : undefined}
                        onClick={() => void handlePendingAction(candidate.slug, 'approve')}
                        className="inline-flex items-center gap-1 h-6 px-2 text-xs font-medium rounded-[var(--radius-control)] bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-50 disabled:hover:bg-accent/15 disabled:cursor-not-allowed"
                      >
                        <Check className="icon-status" />
                        {t('pendingSkills.approve')}
                      </button>
                      {violations.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void handlePendingAction(candidate.slug, 'approve', undefined, true)}
                          className="h-6 px-1 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground transition-colors"
                        >
                          {t('pendingSkills.approveAnyway')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handlePendingAction(candidate.slug, 'dismiss', candidate.description)}
                        className="inline-flex items-center gap-1 h-6 px-2 text-xs font-medium rounded-[var(--radius-control)] bg-surface-hover text-muted-foreground hover:bg-surface-pressed hover:text-foreground transition-colors"
                      >
                        <X className="icon-status" />
                        {t('pendingSkills.dismiss')}
                      </button>
                    </div>
                  </div>
                  )
                })()}
              </li>
            )
          })}
        </ul>
      </div>
    )}

    {/* Bundled skill packs — enable/disable presets shipped with the app */}
    {bundledPacks !== null && bundledPacks.length > 0 && (
      <div ref={catalogRef} tabIndex={-1} className="mb-2 pb-1.5 border-b border-border-subtle outline-none" data-list-role="bundled-skill-packs">
        <div className="px-2 pb-1 text-xs font-medium uppercase caps-label text-muted-foreground/70">
          {t('settings.context.bundledTitle')}
        </div>
        <p className="px-2 pb-1.5 text-xs text-muted-foreground/80">
          {t('settings.context.bundledDesc')}
        </p>
        <ul>
          {bundledPacks.map((pack) => (
            <li key={pack.slug} style={SKILL_ROW_STYLE} className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-control)] hover:bg-surface-hover">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{pack.slug}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    pack.commit ? pack.commit.slice(0, 8) : null,
                    pack.localModified ? t('settings.context.bundledLocalModified') : null,
                    `${pack.installed.length}/${pack.skills.length} ${t('settings.context.bundledSkillsCount')}`,
                  ].filter(Boolean).join(' · ')}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={!pack.disabled}
                aria-label={t(pack.disabled ? 'capabilityCatalog.enablePack' : 'capabilityCatalog.disablePack', { name: pack.slug })}
                disabled={packsBusy}
                onClick={() => void toggleBundledPack(pack.slug, pack.disabled)}
                className={`shrink-0 relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${
                  pack.disabled ? 'bg-surface-pressed' : 'bg-primary'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow transition-transform ${
                    pack.disabled ? '' : 'translate-x-4'
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    )}

    {/* Runtime skills — read-only group with export action */}
    {ompSkills.length > 0 && (
      <div className="mt-3 pt-1.5" data-list-role="runtime-skills">
        <div className="px-2 pb-1 text-xs font-medium uppercase caps-label text-muted-foreground/70">
          {t('skillsList.roxCliSection')}
        </div>
        <VirtualList
          items={ompSkills}
          getKey={(skill) => skill.slug}
          estimateRowHeight={56}
          revealKey={selectedSkillSlug}
          renderItem={(skill) => (
            <div
              key={skill.slug}
              title={skill.shadowedByCraft ? t('skillsList.roxCliShadowed') : skill.metadata.description}
              className={`group flex min-w-0 items-center gap-2 px-2 py-1.5 rounded-[var(--radius-control)] ${!skill.shadowedByCraft && selectedSkillSlug === skill.slug ? 'bg-surface-selected' : 'hover:bg-surface-hover'} ${skill.shadowedByCraft ? 'opacity-50' : ''}`}
              style={SKILL_ROW_STYLE}
            >
              <button
                type="button"
                disabled={skill.shadowedByCraft}
                aria-pressed={!skill.shadowedByCraft && selectedSkillSlug === skill.slug}
                onClick={() => { resetCraftSelection(); onSkillClick(skill) }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left rounded-[var(--radius-control)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
              >
                <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-sm">{skill.metadata.name}</span>
                    <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-surface-hover text-muted-foreground">
                      {t('skillsList.roxCliBadge')}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {skill.shadowedByCraft ? t('skillsList.roxCliShadowed') : skill.metadata.description}
                  </span>
                </span>
              </button>
              {/* Export lives in a hover «…» menu so the name keeps the row. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('common.more')}
                    title={t('common.more')}
                    disabled={exportingSlug !== null}
                    className="shrink-0 inline-flex size-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 disabled:opacity-50"
                  >
                    <MoreHorizontal className="icon-caption" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void handleExportOmpSkill(skill)}>
                    <PackageOpen className="icon-caption" />
                    {t('skillsList.roxCliExport')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        />
      </div>
    )}

    {/* Send to Workspace dialog */}
    {sendResourceSlug && sendDialogOpen && (
      <React.Suspense fallback={null}>
        <SendResourceToWorkspaceDialog
          open
          onOpenChange={setSendDialogOpen}
          resourceType="skill"
          resourceIds={[sendResourceSlug]}
          resourceLabel={sendResourceLabel}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
        />
      </React.Suspense>
    )}
    </div>
  )
}
