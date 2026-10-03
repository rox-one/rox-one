/**
 * ProjectInfoPage
 *
 * Workspace-project detail page with Sessions, Tasks, Assets, and Settings.
 * v1 scope only — no memory tab, no provider selection, no plugin marketplace.
 */

import ProjectRoadmapPage from './ProjectRoadmapPage'
import { SharedProjectDetails } from '@/components/projects/SharedProjectProjection'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { ArrowDown, ArrowUp, FolderOpen, Plus, Trash2, Upload, ImagePlus } from 'lucide-react'
import { ProjectIcon, invalidateProjectIconCache } from '@/components/projects/ProjectIcon'
import { toast } from 'sonner'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import {
  loadPersonalTaskStore,
  persistPersonalTaskStore,
  subscribePersonalTasks,
  tasksForWorkspaceProject,
} from '@/lib/personal-tasks'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import {
  Info_Page,
  Info_Section,
  Info_Table,
} from '@/components/info'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { cn } from '@/lib/utils'
import {
  isClaimableLive,
  soupProjectActResult,
  soupProjectListResult,
  soupProjectReadResult,
} from '@rox/core/rox2'
import { PROJECT_COLOR_PALETTE } from '@/utils/project-colors'
import { InlineColorPickerRow } from '@/components/ui/inline-color-picker-row'
import type { LoadedProject, OkrCycle, OkrKeyResult, OkrObjective, OkrProgress, ProjectOkrDocument, ProjectAsset } from '@rox/shared/projects/types'
import { calculateOkrCycle, createOkrCycle } from '@rox/shared/projects'
import { useTourSignals } from '@/features/product-tour/runtime/hooks'
import { deriveProjectSignals } from '@/features/product-tour/adapters/work/tasks-projects'

interface ProjectInfoPageProps {
  projectSlug: string
}

type TabKey = 'roadmap' | 'sessions' | 'tasks' | 'assets' | 'settings' | 'okr'

export default function ProjectInfoPage({ projectSlug }: ProjectInfoPageProps) {
  const workspace = useActiveWorkspace()
  return projectSlug.startsWith('project:')
    ? <SharedProjectDetails entityId={projectSlug} />
    : <LocalProjectInfoPage key={`${workspace?.id ?? ''}:${projectSlug}`} projectSlug={projectSlug} />
}

function LocalProjectInfoPage({ projectSlug }: ProjectInfoPageProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id
  const tour = useTourSignals({ workspaceId, entityId: projectSlug })
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { onCreateSession, onOpenFile } = useAppShellContext()

  const [project, setProject] = useState<LoadedProject | null>(null)
  const projectRequestRef = useRef(0)
  const projectMountedRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const projectReadsMountedRef = projectMountedRef
  const projectReadRevisionRef = projectRequestRef
  useEffect(() => tour.capability('projects.available', loading
    ? { state: 'pending', reason: 'installing' }
    : error ? { state: 'unavailable', reason: 'api-unavailable' }
      : project ? { state: 'ready' } : { state: 'unavailable', reason: 'missing-entity' }), [tour, loading, error, project])
  useEffect(() => {
    if (loading || error || !project) return
    const observation = tour.capture()
    for (const signal of deriveProjectSignals(observation, project, true)) {
      tour.emit(observation, signal.name, signal.level, signal.origin, signal.eventToken)
    }
  }, [tour, loading, error, project])
  const [tab, setTab] = useState<TabKey>('sessions')
  const [taskStore, setTaskStore] = useState(loadPersonalTaskStore)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editWorkingDir, setEditWorkingDir] = useState('')
  const [editDetails, setEditDetails] = useState('')
  const [editColor, setEditColor] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [okrDocument, setOkrDocument] = useState<ProjectOkrDocument | null>(null)
  const [okrCycles, setOkrCycles] = useState<OkrCycle[]>([])
  const [selectedCycleId, setSelectedCycleId] = useState('')
  const [okrLoading, setOkrLoading] = useState(false)
  const [okrSaving, setOkrSaving] = useState(false)
  const [okrError, setOkrError] = useState<string | null>(null)
  const [newCycleTitle, setNewCycleTitle] = useState('')
  const [newCycleStart, setNewCycleStart] = useState('')
  const [newCycleEnd, setNewCycleEnd] = useState('')
  const [newCycleTimezone, setNewCycleTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)

  React.useLayoutEffect(() => {
    projectReadsMountedRef.current = true
    return () => {
      projectReadsMountedRef.current = false
      projectReadRevisionRef.current += 1
    }
  }, [workspaceId, projectSlug])

  const selectedCycle = useMemo(
    () => okrCycles.find((cycle) => cycle.id === selectedCycleId) ?? null,
    [okrCycles, selectedCycleId]
  )
  const selectedCycleCalculation = useMemo(() => {
    if (!selectedCycle || selectedCycle.objectives.length === 0) return null
    try {
      return calculateOkrCycle(selectedCycle)
    } catch {
      return null
    }
  }, [selectedCycle])

  const loadOkr = useCallback(async () => {
    if (!workspaceId) return
    const read = soupProjectReadResult({ source: 'native', nativeId: projectSlug })
    if (!isClaimableLive(read.result)) return
    setOkrLoading(true)
    setOkrError(null)
    try {
      const document = await window.electronAPI.getProjectOkr(workspaceId, projectSlug)
      setOkrDocument(document)
      setOkrCycles(document.cycles)
      setSelectedCycleId((current) => document.cycles.some((cycle) => cycle.id === current)
        ? current
        : document.cycles[0]?.id ?? '')
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to load project OKRs:', err)
      setOkrError(err instanceof Error ? err.message : String(err))
    } finally {
      setOkrLoading(false)
    }
  }, [workspaceId, projectSlug])

  useEffect(() => {
    void loadOkr()
  }, [loadOkr])
  const updateOkrCycle = useCallback((update: (cycle: OkrCycle) => OkrCycle) => {
    if (!selectedCycle) return
    setOkrCycles((cycles) => cycles.map((cycle) => cycle.id === selectedCycle.id ? update(cycle) : cycle))
  }, [selectedCycle])

  const handleCreateCycle = useCallback(() => {
    if (!project || !newCycleTitle.trim()) return
    try {
      const created = createOkrCycle(project.config.id, {
        title: newCycleTitle,
        startDate: newCycleStart,
        endDate: newCycleEnd,
        timezone: newCycleTimezone,
      })
      setOkrCycles((cycles) => [...cycles, created])
      setSelectedCycleId(created.id)
      setNewCycleTitle('')
      setNewCycleStart('')
      setNewCycleEnd('')
      setOkrError(null)
    } catch {
      setOkrError(t('projectOkr.invalidCycle'))
    }
  }, [project, newCycleTitle, newCycleStart, newCycleEnd, newCycleTimezone, t])

  const handleAddObjective = useCallback(() => {
    const objective: OkrObjective = {
      id: crypto.randomUUID(),
      title: t('projectOkr.newObjectiveTitle', { number: selectedCycle?.objectives.length ? selectedCycle.objectives.length + 1 : 1 }),
      weight: 1,
      keyResults: [],
    }
    updateOkrCycle((cycle) => ({ ...cycle, objectives: [...cycle.objectives, objective] }))
  }, [selectedCycle, updateOkrCycle, t])

  const handleAddKeyResult = useCallback((objectiveId: string) => {
    const keyResult: OkrKeyResult = {
      id: crypto.randomUUID(),
      title: t('projectOkr.newKeyResultTitle'),
      weight: 1,
      measurement: {
        kind: 'numeric',
        direction: 'increase',
        baseline: 0,
        target: 100,
        current: null,
        unit: t('projectOkr.defaultUnit'),
        evidence: [],
      },
    }
    updateOkrCycle((cycle) => ({
      ...cycle,
      objectives: cycle.objectives.map((objective) => objective.id === objectiveId
        ? { ...objective, keyResults: [...objective.keyResults, keyResult] }
        : objective),
    }))
  }, [updateOkrCycle, t])

  const handleSaveOkr = useCallback(async () => {
    if (!workspaceId || !okrDocument) return
    const act = soupProjectActResult({ source: 'native', action: 'write', nativeId: projectSlug })
    if (!isClaimableLive(act)) return
    setOkrSaving(true)
    setOkrError(null)
    try {
      const result = await window.electronAPI.saveProjectOkr(workspaceId, projectSlug, okrDocument.revision, { cycles: okrCycles })
      if ('conflict' in result) {
        setOkrError(t('projectOkr.conflict', { revision: result.actualRevision }))
        return
      }
      setOkrDocument(result)
      setOkrCycles(result.cycles)
      toast.success(t('projectOkr.saveSuccess'))
    } catch (err) {
      console.error('[ProjectInfoPage] OKR save failed:', err)
      setOkrError(t('projectOkr.saveFailed'))
    } finally {
      setOkrSaving(false)
    }
  }, [workspaceId, projectSlug, okrDocument, okrCycles, t])

  const moveObjective = useCallback((objectiveId: string, offset: number) => {
    updateOkrCycle((cycle) => {
      const index = cycle.objectives.findIndex((objective) => objective.id === objectiveId)
      const target = index + offset
      if (index < 0 || target < 0 || target >= cycle.objectives.length) return cycle
      const objectives = [...cycle.objectives]
      ;[objectives[index], objectives[target]] = [objectives[target]!, objectives[index]!]
      return { ...cycle, objectives }
    })
  }, [updateOkrCycle])

  const moveKeyResult = useCallback((objectiveId: string, keyResultId: string, offset: number) => {
    updateOkrCycle((cycle) => ({
      ...cycle,
      objectives: cycle.objectives.map((objective) => {
        if (objective.id !== objectiveId) return objective
        const index = objective.keyResults.findIndex((item) => item.id === keyResultId)
        const target = index + offset
        if (index < 0 || target < 0 || target >= objective.keyResults.length) return objective
        const keyResults = [...objective.keyResults]
        ;[keyResults[index], keyResults[target]] = [keyResults[target]!, keyResults[index]!]
        return { ...objective, keyResults }
      }),
    }))
  }, [updateOkrCycle])
  const removeCycle = useCallback(() => {
    if (!selectedCycle || selectedCycle.status !== 'draft') return
    setOkrCycles((cycles) => cycles.filter((cycle) => cycle.id !== selectedCycle.id))
    setSelectedCycleId(okrCycles.find((cycle) => cycle.id !== selectedCycle.id)?.id ?? '')
  }, [selectedCycle, okrCycles])


  // Load project (and re-load on broadcast)
  const loadProject = useCallback(async () => {
    const request = ++projectReadRevisionRef.current
    const isCurrent = () => projectReadsMountedRef.current && request === projectReadRevisionRef.current
    if (!isCurrent()) return
    if (!workspaceId) {
      setProject(null)
      setError(t('common.unavailable'))
      setLoading(false)
      return
    }
    const listed = soupProjectListResult({ source: 'native', nativeIds: projectSlug ? [projectSlug] : [] })
    const read = soupProjectReadResult({ source: 'native', nativeId: projectSlug })
    if (!isClaimableLive(listed.result) || !isClaimableLive(read.result)) {
      setProject(null)
      setError(t('common.unavailable'))
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.getProject(workspaceId, projectSlug)
      if (!isCurrent()) return
      if (!result) {
        setError(t('projectInfo.notFound'))
        setProject(null)
        return
      }
      const loaded = result as LoadedProject
      setProject(loaded)
      setEditName(loaded.config.name)
      setEditDescription(loaded.config.description ?? '')
      setEditWorkingDir(loaded.config.workingDirectory ?? '')
      setEditDetails(loaded.config.details ?? '')
      setEditColor(loaded.config.color ?? '')
    } catch (err) {
      if (!isCurrent()) return
      console.error('[ProjectInfoPage] Failed to load project:', err)
      setProject(null)
      setError(t('common.unavailable'))
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [workspaceId, projectSlug, t])

  useEffect(() => {
    projectMountedRef.current = true
    void loadProject()
    return () => {
      projectMountedRef.current = false
      ++projectRequestRef.current
    }
  }, [loadProject])

  useEffect(() => {
    if (!workspaceId) return
    const off = window.electronAPI.onProjectsChanged((wsId: string) => {
      if (wsId === workspaceId) {
        loadProject()
        loadOkr()
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [workspaceId, loadProject, loadOkr])

  // Load assets when entering Assets tab
  const refreshAssets = useCallback(async () => {
    if (!workspaceId) return
    try {
      const list = await window.electronAPI.listProjectAssets(workspaceId, projectSlug)
      setAssets(Array.isArray(list) ? (list as ProjectAsset[]) : [])
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to load assets:', err)
    }
  }, [workspaceId, projectSlug])

  useEffect(() => {
    if (tab === 'assets') refreshAssets()
  }, [tab, refreshAssets])

  const projectSessions = useMemo(() => {
    if (!project) return []
    const result: { id: string; name: string }[] = []
    for (const meta of sessionMetaMap.values()) {
      if ((meta as { projectId?: string }).projectId === project.config.id) {
        result.push({ id: meta.id, name: meta.name ?? meta.id })
      }
    }
    return result
  }, [project, sessionMetaMap])

  const projectTasks = useMemo(() => {
    if (!project) return []
    return tasksForWorkspaceProject(taskStore, project.config.id)
  }, [project, taskStore])

  useEffect(() => subscribePersonalTasks(() => setTaskStore(loadPersonalTaskStore())), [])

  const handleCreateProjectTask = useCallback((event: React.FormEvent) => {
    event.preventDefault()
    if (!project || !newTaskTitle.trim()) return
    const next = loadPersonalTaskStore()
    next.create({ title: newTaskTitle, list: 'inbox', projectId: project.config.id })
    persistPersonalTaskStore(next)
    setTaskStore(next)
    setNewTaskTitle('')
  }, [project, newTaskTitle])

  const handleStartSession = useCallback(async () => {
    if (!workspaceId || !project) return
    try {
      const session = await onCreateSession(workspaceId, { projectId: project.config.id })
      if (session?.id) {
        navigate(routes.view.allSessions(session.id))
      }
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to create session:', err)
      toast.error(t('projectInfo.newSessionFailed'))
    }
  }, [workspaceId, project, onCreateSession, t])

  const handlePickWorkingDirectory = useCallback(async () => {
    try {
      const picked = await window.electronAPI.openFolderDialog?.()
      if (typeof picked === 'string' && picked.trim()) {
        setEditWorkingDir(picked)
      }
    } catch (err) {
      console.error('[ProjectInfoPage] Folder picker failed:', err)
    }
  }, [])

  const handleSaveSettings = useCallback(async () => {
    if (!workspaceId || !project) return
    const act = soupProjectActResult({
      source: 'native',
      action: 'write',
      nativeId: project.config.slug,
    })
    if (!isClaimableLive(act)) return
    setSaving(true)
    try {
      await window.electronAPI.updateProject(workspaceId, project.config.slug, {
        name: editName.trim() || project.config.name,
        description: editDescription.trim() || undefined,
        workingDirectory: editWorkingDir.trim() || undefined,
        details: editDetails.trim() || undefined,
        color: editColor.trim() || undefined,
      })
      toast.success(t('projectInfo.saved'))
    } catch (err) {
      console.error('[ProjectInfoPage] Save failed:', err)
      toast.error(t('projectInfo.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [workspaceId, project, editName, editDescription, editWorkingDir, editDetails, editColor, t])

  const handleDeleteProject = useCallback(async () => {
    if (!workspaceId || !project) return
    if (!window.confirm(t('projectInfo.deleteConfirm', { name: project.config.name }))) return
    const act = soupProjectActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: project.config.slug,
    })
    if (!isClaimableLive(act)) return
    try {
      await window.electronAPI.deleteProject(workspaceId, project.config.slug)
      if (!projectMountedRef.current) return
      ++projectRequestRef.current
      setProject(null)
      setLoading(false)
      navigate(routes.view.projects())
    } catch (err) {
      if (!projectMountedRef.current) return
      console.error('[ProjectInfoPage] Delete failed:', err)
      toast.error(t('projectInfo.deleteFailed'))
    }
  }, [workspaceId, project, t])

  const handleUpload = useCallback(async (file: File) => {
    if (!workspaceId || !project) return
    try {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
      await window.electronAPI.uploadProjectAsset(workspaceId, project.config.slug, {
        filename: file.name,
        base64,
      })
      await refreshAssets()
      toast.success(t('projectInfo.assetUploaded', { name: file.name }))
    } catch (err) {
      console.error('[ProjectInfoPage] Upload failed:', err)
      toast.error(t('projectInfo.uploadFailed'))
    }
  }, [workspaceId, project, refreshAssets, t])

  const handleDeleteAsset = useCallback(async (asset: ProjectAsset) => {
    if (!workspaceId || !project) return
    if (!window.confirm(t('projectInfo.deleteAssetConfirm', { name: asset.filename }))) return
    try {
      await window.electronAPI.deleteProjectAsset(workspaceId, project.config.slug, asset.filename)
      await refreshAssets()
    } catch (err) {
      console.error('[ProjectInfoPage] Asset delete failed:', err)
      toast.error(t('projectInfo.deleteAssetFailed'))
    }
  }, [workspaceId, project, refreshAssets, t])

  const handleUploadIcon = useCallback(async (file: File) => {
    if (!workspaceId || !project) return
    const allowed = /\.(png|jpe?g|webp|gif|svg|ico)$/i
    if (!allowed.test(file.name)) {
      toast.error(t('projectInfo.iconInvalidType'))
      return
    }
    try {
      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
      const base64 = btoa(binary)
      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.png'
      const filename = `project-icon${ext.toLowerCase()}`
      if (project.config.icon && project.config.icon !== filename) {
        try {
          await window.electronAPI.deleteProjectAsset(workspaceId, project.config.slug, project.config.icon)
        } catch {
          // ignore missing old icon
        }
      }
      try {
        await window.electronAPI.deleteProjectAsset(workspaceId, project.config.slug, filename)
      } catch {
        // ignore
      }
      const asset = await window.electronAPI.uploadProjectAsset(workspaceId, project.config.slug, {
        filename,
        base64,
      })
      await window.electronAPI.updateProject(workspaceId, project.config.slug, {
        icon: asset.filename,
      })
      invalidateProjectIconCache(workspaceId, project.config.slug)
      await loadProject()
      toast.success(t('projectInfo.iconUploaded'))
    } catch (err) {
      console.error('[ProjectInfoPage] Icon upload failed:', err)
      toast.error(t('projectInfo.iconUploadFailed'))
    }
  }, [workspaceId, project, loadProject, t])

  const handleClearIcon = useCallback(async () => {
    if (!workspaceId || !project?.config.icon) return
    try {
      await window.electronAPI.deleteProjectAsset(workspaceId, project.config.slug, project.config.icon)
      await window.electronAPI.updateProject(workspaceId, project.config.slug, { icon: '' })
      invalidateProjectIconCache(workspaceId, project.config.slug)
      await loadProject()
      toast.success(t('projectInfo.iconCleared'))
    } catch (err) {
      console.error('[ProjectInfoPage] Clear icon failed:', err)
      toast.error(t('projectInfo.iconUploadFailed'))
    }
  }, [workspaceId, project, loadProject, t])

  if (!loading && error) {
    return (
      <Info_Page>
        <Info_Page.Header title={projectSlug} />
        <div role="status" aria-live="polite" data-testid="project-surface-unavailable" className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground">
          <p className="text-sm">{error}</p>
          <button type="button" data-testid="project-surface-retry" onClick={() => void loadProject()} className="rounded-md border border-border px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('common.retry')}
          </button>
        </div>
      </Info_Page>
    )
  }

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!project && !loading && !error ? t('projectInfo.notFound') : undefined}
    >
      <Info_Page.Header title={project?.config.name ?? ''} />
      {project && (
        <Info_Page.Content>
          <Info_Page.Hero
            avatar={
              <ProjectIcon
                workspaceId={workspaceId}
                projectSlug={project.config.slug}
                iconFilename={project.config.icon}
                color={project.config.color}
                className="h-6 w-6"
                iconClassName="h-6 w-6 text-foreground/60"
              />
            }
            title={project.config.name}
            tagline={project.config.description ?? t('projectInfo.taglineFallback')}
          />

          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-border/50 px-2 mb-4">
            <TabButton active={tab === 'roadmap'} onClick={() => setTab('roadmap')}>
              {t('projectRoadmap.title')}
            </TabButton>
            <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>
              {t('projectInfo.tabSessions')}
            </TabButton>
            <TabButton active={tab === 'tasks'} onClick={() => setTab('tasks')}>
              {t('projectInfo.tabTasks')}
            </TabButton>
            <TabButton active={tab === 'assets'} onClick={() => setTab('assets')}>
              {t('projectInfo.tabAssets')}
            </TabButton>
            <TabButton active={tab === 'okr'} onClick={() => setTab('okr')}>
              OKR
            </TabButton>
            <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
              {t('projectInfo.tabSettings')}
            </TabButton>
          </div>

          {tab === 'roadmap' && <ProjectRoadmapPage key={`${workspaceId}:${projectSlug}`} projectSlug={projectSlug} />}

          {/* Sessions tab */}
          {tab === 'sessions' && (
            <Info_Section
              title={t('projectInfo.tabSessions')}
              actions={
                <Button size="sm" variant="ghost" onClick={handleStartSession}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('projectInfo.newSessionButton', { name: project.config.name })}
                </Button>
              }
            >
              {projectSessions.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  {t('projectInfo.noSessions')}
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {projectSessions.map((s) => (
                    <li key={s.id} className="px-4 py-2">
                      <button
                        type="button"
                        className="text-sm text-foreground hover:underline text-left"
                        onClick={() => navigate(routes.view.allSessions(s.id))}
                      >
                        {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Info_Section>
          )}

          {tab === 'tasks' && (
            <Info_Section
              title={t('projectInfo.tabTasks')}
              actions={
                <form onSubmit={handleCreateProjectTask} className="flex items-center gap-1">
                  <input
                    value={newTaskTitle}
                    onChange={(event) => setNewTaskTitle(event.target.value)}
                    placeholder={t('tasks.quickEntryPlaceholder')}
                    aria-label={t('tasks.newTask')}
                    className="h-7 w-40 rounded-[var(--radius-card)] border border-foreground/10 bg-transparent px-2 text-xs"
                  />
                  <Button size="sm" variant="ghost" type="submit" data-testid="project-new-task">
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {t('projectInfo.newTaskButton')}
                  </Button>
                </form>
              }
            >
              <p className="px-4 pt-2 text-xs text-muted-foreground">{t('projectInfo.tasksHint')}</p>
              {projectTasks.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  {t('projectInfo.noTasks')}
                </div>
              ) : (
                <ul className="divide-y divide-border/50" data-testid="project-task-list">
                  {projectTasks.map((task) => (
                    <li key={task.id} className="px-4 py-2 text-sm">
                      <span className={cn(task.completedAt && 'line-through text-muted-foreground')}>{task.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Info_Section>
          )}
          {tab === 'okr' && (
            <Info_Section title={t('projectOkr.tab')}>
              <div className="space-y-4 px-4 py-3">
                <p className="text-sm text-muted-foreground">{t('projectOkr.guidance')}</p>
                <details className="rounded-md border border-border/60 px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('projectOkr.examplesTitle')}</summary>
                  <p className="mt-2 text-muted-foreground">{t('projectOkr.examplesBody')}</p>
                </details>
                {okrLoading && <p role="status" className="text-sm text-muted-foreground">{t('projectOkr.loading')}</p>}
                {okrError && (
                  <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
                    <p>{okrError}</p>
                    <Button size="sm" variant="outline" onClick={() => void loadOkr()}>{t('projectOkr.reload')}</Button>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(10rem,1fr)_auto_auto_minmax(10rem,auto)_auto]">
                  <Input value={newCycleTitle} onChange={(event) => setNewCycleTitle(event.target.value)} placeholder={t('projectOkr.newCycle')} aria-label={t('projectOkr.newCycle')} />
                  <Input type="date" value={newCycleStart} onChange={(event) => setNewCycleStart(event.target.value)} aria-label={t('projectOkr.cycleStart')} />
                  <Input type="date" value={newCycleEnd} onChange={(event) => setNewCycleEnd(event.target.value)} aria-label={t('projectOkr.cycleEnd')} />
                  <Input value={newCycleTimezone} onChange={(event) => setNewCycleTimezone(event.target.value)} placeholder="Europe/Moscow" aria-label={t('projectOkr.cycleTimezone')} />
                  <Button type="button" variant="outline" onClick={handleCreateCycle} disabled={!newCycleTitle.trim()}>
                    <Plus className="mr-1 h-3.5 w-3.5" />{t('projectOkr.createCycle')}
                  </Button>
                </div>
                {okrCycles.length > 0 && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-sm font-medium" htmlFor="project-okr-cycle">{t('projectOkr.cycle')}</label>
                      <select
                        id="project-okr-cycle"
                        value={selectedCycleId}
                        onChange={(event) => setSelectedCycleId(event.target.value)}
                        className="h-9 min-w-48 rounded-md border border-border bg-background px-2 text-sm"
                      >
                        {okrCycles.map((cycle) => (
                          <option key={cycle.id} value={cycle.id}>{cycle.title} · {t(`projectOkr.${cycle.status}`)}</option>
                        ))}
                      </select>
                      {selectedCycle && (
                        <>
                          <span className="text-xs text-muted-foreground">{t('projectOkr.cycleRevision', { revision: selectedCycle.revision, start: selectedCycle.startDate, end: selectedCycle.endDate })}</span>
                          <span className="text-xs text-muted-foreground">{t('projectOkr.cycleTimezone')}: {selectedCycle.timezone}</span>
                          <select
                            aria-label={t('projectOkr.cycleStatus')}
                            value={selectedCycle.status}
                            onChange={(event) => updateOkrCycle((cycle) => ({
                              ...cycle,
                              status: event.target.value as OkrCycle['status'],
                              publishedAt: event.target.value === 'published' ? new Date().toISOString() : cycle.publishedAt,
                              archivedAt: event.target.value === 'archived' ? new Date().toISOString() : undefined,
                            }))}
                            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                          >
                            <option value="draft" disabled={selectedCycle.status !== 'draft'}>{t('projectOkr.draft')}</option>
                            <option value="published" disabled={selectedCycle.status === 'archived'}>{t('projectOkr.published')}</option>
                            <option value="archived" disabled={selectedCycle.status === 'archived'}>{t('projectOkr.archived')}</option>
                          </select>
                          <Button type="button" variant="ghost" size="sm" onClick={removeCycle} disabled={selectedCycle.status !== 'draft'}>{t('projectOkr.deleteCycle')}</Button>
                        </>
                      )}
                    </div>
                    {selectedCycle && (
                      <fieldset disabled={selectedCycle.status !== 'draft'} className="space-y-4 disabled:opacity-80">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          className="min-w-48 flex-1"
                          aria-label={t('projectOkr.cycle')}
                          value={selectedCycle.title}
                          onChange={(event) => updateOkrCycle((cycle) => ({ ...cycle, title: event.target.value }))}
                        />
                        <Input
                          type="date"
                          aria-label={t('projectOkr.cycleStart')}
                          value={selectedCycle.startDate}
                          onChange={(event) => updateOkrCycle((cycle) => ({ ...cycle, startDate: event.target.value }))}
                        />
                        <Input
                          type="date"
                          aria-label={t('projectOkr.cycleEnd')}
                          value={selectedCycle.endDate}
                          onChange={(event) => updateOkrCycle((cycle) => ({ ...cycle, endDate: event.target.value }))}
                        />
                        <Input
                          aria-label={t('projectOkr.cycleTimezone')}
                          value={selectedCycle.timezone}
                          onChange={(event) => updateOkrCycle((cycle) => ({ ...cycle, timezone: event.target.value }))}
                        />
                        <Button type="button" variant="outline" size="sm" onClick={handleAddObjective}>
                          <Plus className="mr-1 h-3.5 w-3.5" />{t('projectOkr.addObjective')}
                        </Button>
                      </div>
                    {selectedCycle && selectedCycle.objectives.map((objective, objectiveIndex) => {
                      const objectiveResult = selectedCycleCalculation?.objectives.find((item) => item.id === objective.id)
                      return (
                        <section key={objective.id} className="space-y-3 rounded-lg border border-border/70 p-3" aria-labelledby={`objective-${objective.id}`}>
                          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(10rem,1fr)_6rem_minmax(8rem,0.6fr)_auto_auto_auto_auto]">
                            <Input
                              id={`objective-${objective.id}`}
                              aria-label={t('projectOkr.objective')}
                              value={objective.title}
                              onChange={(event) => updateOkrCycle((cycle) => ({
                                ...cycle,
                                objectives: cycle.objectives.map((item) => item.id === objective.id ? { ...item, title: event.target.value } : item),
                              }))}
                              placeholder={t('projectOkr.objectivePlaceholder')}
                            />
                            <Input
                              type="number" min="0" step="any" aria-label={t('projectOkr.objectiveWeight')}
                              value={objective.weight}
                              onChange={(event) => updateOkrCycle((cycle) => ({
                                ...cycle,
                                objectives: cycle.objectives.map((item) => item.id === objective.id ? { ...item, weight: Number(event.target.value) } : item),
                              }))}
                            />
                            <Input
                              aria-label={t('projectOkr.ownerObjective')} placeholder={t('projectOkr.owner')}
                              value={objective.owner ?? ''}
                              onChange={(event) => updateOkrCycle((cycle) => ({
                                ...cycle,
                                objectives: cycle.objectives.map((item) => item.id === objective.id ? { ...item, owner: event.target.value } : item),
                              }))}
                            />
                            <span className="text-xs text-muted-foreground sm:whitespace-nowrap">
                              {objectiveResult
                                ? t('projectOkr.objectiveProgress', { weight: (objectiveResult.normalizedWeight * 100).toFixed(1), progress: formatOkrProgress(objectiveResult.progress, t('projectOkr.unknownProgress')) })
                                : t('projectOkr.notCalculated')}
                            </span>
                            <Button type="button" size="icon" variant="ghost" aria-label={t('projectOkr.moveUp')} disabled={objectiveIndex === 0} onClick={() => moveObjective(objective.id, -1)}><ArrowUp className="h-4 w-4" /></Button>
                            <Button type="button" size="icon" variant="ghost" aria-label={t('projectOkr.moveDown')} disabled={objectiveIndex === selectedCycle.objectives.length - 1} onClick={() => moveObjective(objective.id, 1)}><ArrowDown className="h-4 w-4" /></Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={t('projectOkr.deleteObjective')}
                              onClick={() => updateOkrCycle((cycle) => ({
                                ...cycle,
                                objectives: cycle.objectives.filter((item) => item.id !== objective.id),
                              }))}
                            >
                              {t('projectOkr.delete')}
                            </Button>
                          </div>
                          <Textarea
                            aria-label={t('projectOkr.objectiveDescription')}
                            placeholder={t('projectOkr.objectiveDescriptionHint')}
                            rows={2}
                            value={objective.description ?? ''}
                            onChange={(event) => updateOkrCycle((cycle) => ({
                              ...cycle,
                              objectives: cycle.objectives.map((item) => item.id === objective.id ? { ...item, description: event.target.value } : item),
                            }))}
                          />
                          <div className="space-y-2">
                            {objective.keyResults.map((keyResult, keyResultIndex) => {
                              const result = objectiveResult?.keyResults.find((item) => item.id === keyResult.id)
                              const measurement = keyResult.measurement
                              return (
                                <div key={keyResult.id} className="space-y-2 rounded-md bg-foreground/[0.025] p-3">
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(10rem,1fr)_5rem_minmax(8rem,0.6fr)_auto_auto]">
                                    <Input
                                      aria-label={t('projectOkr.keyResult')}
                                      value={keyResult.title}
                                      onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => ({ ...item, title: event.target.value }))}
                                      placeholder={t('projectOkr.keyResultPlaceholder')}
                                    />
                                    <Input
                                      type="number" min="0" step="any" aria-label={t('projectOkr.keyResultWeight')}
                                      value={keyResult.weight}
                                      onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => ({ ...item, weight: Number(event.target.value) }))}
                                    />
                                    <Input
                                      aria-label={t('projectOkr.ownerKeyResult')} placeholder={t('projectOkr.owner')}
                                      value={keyResult.owner ?? ''}
                                      onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => ({ ...item, owner: event.target.value }))}
                                    />
                                    <span className="self-center text-xs text-muted-foreground">
                                      {result ? t('projectOkr.innerWeightProgress', { weight: (result.normalizedWeight * 100).toFixed(1), progress: formatOkrProgress(result.progress, t('projectOkr.unknownProgress')) }) : t('projectOkr.unknown')}
                                    </span>
                                    <select
                                      aria-label={t('projectOkr.keyResultStatus')}
                                      value={keyResult.status ?? 'unknown'}
                                      onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => ({ ...item, status: event.target.value === 'unknown' ? undefined : event.target.value }))}
                                      className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                                    >
                                      <option value="unknown">{t('projectOkr.noStatus')}</option>
                                      <option value="on-track">{t('projectOkr.onTrack')}</option>
                                      <option value="at-risk">{t('projectOkr.atRisk')}</option>
                                      <option value="completed">{t('projectOkr.completed')}</option>
                                    </select>
                                  </div>
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <label className="space-y-1 text-xs text-muted-foreground">
                                      {t('projectOkr.measurementType')}
                                      <select
                                        value={measurement.kind}
                                        onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => ({
                                          ...item,
                                          measurement: event.target.value === 'binary'
                                            ? { kind: 'binary', achieved: null, evidence: [], source: item.measurement.source }
                                            : { kind: 'numeric', direction: 'increase', baseline: 0, target: 100, current: null, unit: t('projectOkr.defaultUnit'), evidence: [], source: item.measurement.source },
                                        }))}
                                        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                                      >
                                        <option value="numeric">{t('projectOkr.numeric')}</option>
                                        <option value="binary">{t('projectOkr.binary')}</option>
                                      </select>
                                    </label>
                                    {measurement.kind === 'numeric' ? (
                                      <>
                                        <label className="space-y-1 text-xs text-muted-foreground">
                                          {t('projectOkr.direction')}
                                          <select
                                            value={measurement.direction}
                                            onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => item.measurement.kind === 'numeric'
                                              ? { ...item, measurement: { ...item.measurement, direction: event.target.value as 'increase' | 'decrease' } }
                                              : item)}
                                            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                                          >
                                            <option value="increase">{t('projectOkr.increase')}</option>
                                            <option value="decrease">{t('projectOkr.decrease')}</option>
                                          </select>
                                        </label>
                                        <Input type="number" step="any" aria-label={t('projectOkr.measurementBaseline')} placeholder={t('projectOkr.baseline')} value={measurement.baseline} onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => item.measurement.kind === 'numeric' ? { ...item, measurement: { ...item.measurement, baseline: Number(event.target.value) } } : item)} />
                                        <Input type="number" step="any" aria-label={t('projectOkr.numericTarget')} placeholder={t('projectOkr.target')} value={measurement.target} onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => item.measurement.kind === 'numeric' ? { ...item, measurement: { ...item.measurement, target: Number(event.target.value) } } : item)} />
                                        <Input type="number" step="any" aria-label={t('projectOkr.measurementCurrent')} placeholder={t('projectOkr.currentUnknown')} value={measurement.current ?? ''} onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => item.measurement.kind === 'numeric' ? { ...item, measurement: { ...item.measurement, current: event.target.value === '' ? null : Number(event.target.value) } } : item)} />
                                        <Input aria-label={t('projectOkr.unit')} placeholder={t('projectOkr.unit')} value={measurement.unit} onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => item.measurement.kind === 'numeric' ? { ...item, measurement: { ...item.measurement, unit: event.target.value } } : item)} />
                                      </>
                                    ) : (
                                      <label className="space-y-1 text-xs text-muted-foreground">
                                        {t('projectOkr.binaryState')}
                                        <select
                                          value={measurement.achieved === null ? 'unknown' : String(measurement.achieved)}
                                          onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => item.measurement.kind === 'binary'
                                            ? { ...item, measurement: { ...item.measurement, achieved: event.target.value === 'unknown' ? null : event.target.value === 'true' } }
                                            : item)}
                                          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                                        >
                                          <option value="unknown">{t('projectOkr.unknown')}</option>
                                          <option value="false">{t('projectOkr.notAchieved')}</option>
                                          <option value="true">{t('projectOkr.achieved')}</option>
                                        </select>
                                      </label>
                                    )}
                                    <Input aria-label={t('projectOkr.source')} placeholder={t('projectOkr.source')} value={measurement.source ?? ''} onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => ({ ...item, measurement: { ...item.measurement, source: event.target.value } }))} />
                                    <Input type="datetime-local" aria-label={t('projectOkr.measuredAt')} value={formatLocalDateTimeInput(measurement.measuredAt)} onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => ({ ...item, measurement: { ...item.measurement, measuredAt: event.target.value ? new Date(event.target.value).toISOString() : undefined } }))} />
                                    <label className="space-y-1 text-xs text-muted-foreground">
                                      {t('projectOkr.freshness')}
                                      <select
                                        value={measurement.freshness ?? 'unknown'}
                                        onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => ({
                                          ...item,
                                          measurement: { ...item.measurement, freshness: event.target.value as 'fresh' | 'stale' | 'unknown' },
                                        }))}
                                        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                                      >
                                        <option value="unknown">{t('projectOkr.notChecked')}</option>
                                        <option value="fresh">{t('projectOkr.fresh')}</option>
                                        <option value="stale">{t('projectOkr.stale')}</option>
                                      </select>
                                    </label>
                                    <Input
                                      type="datetime-local"
                                      aria-label={t('projectOkr.freshnessCheckedAt')}
                                      value={formatLocalDateTimeInput(measurement.freshnessCheckedAt)}
                                      onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => ({
                                        ...item,
                                        measurement: { ...item.measurement, freshnessCheckedAt: event.target.value ? new Date(event.target.value).toISOString() : undefined },
                                      }))}
                                    />
                                    <Textarea
                                      aria-label={t('projectOkr.evidence')}
                                      placeholder={t('projectOkr.evidencePlaceholder')}
                                      rows={2}
                                      value={measurement.evidence?.map((item) => item.label).join('\n') ?? ''}
                                      onChange={(event) => updateKeyResult(updateOkrCycle, objective.id, keyResult.id, (item) => ({
                                        ...item,
                                        measurement: {
                                          ...item.measurement,
                                          evidence: event.target.value.split('\n').map((label, index) => ({ id: `evidence-${index + 1}`, label: label.trim() })).filter((entry) => entry.label),
                                        },
                                      }))}
                                    />
                                  </div>
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-xs text-muted-foreground">{t('projectOkr.orderScore', { order: keyResultIndex + 1, score: result?.score == null ? t('projectOkr.unknownProgress') : `${(result.score * 100).toFixed(1)}%` })}</span>
                                    <div className="flex items-center gap-1">
                                      <Button type="button" size="icon" variant="ghost" aria-label={t('projectOkr.moveKeyResultUp')} disabled={keyResultIndex === 0} onClick={() => moveKeyResult(objective.id, keyResult.id, -1)}><ArrowUp className="h-4 w-4" /></Button>
                                      <Button type="button" size="icon" variant="ghost" aria-label={t('projectOkr.moveKeyResultDown')} disabled={keyResultIndex === objective.keyResults.length - 1} onClick={() => moveKeyResult(objective.id, keyResult.id, 1)}><ArrowDown className="h-4 w-4" /></Button>
                                      <Button type="button" size="sm" variant="ghost" onClick={() => updateOkrCycle((cycle) => ({
                                        ...cycle,
                                        objectives: cycle.objectives.map((item) => item.id === objective.id
                                          ? { ...item, keyResults: item.keyResults.filter((entry) => entry.id !== keyResult.id) }
                                          : item),
                                      }))}>{t('projectOkr.deleteKeyResult')}</Button>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                            <Button type="button" size="sm" variant="outline" onClick={() => handleAddKeyResult(objective.id)}>
                              <Plus className="mr-1 h-3.5 w-3.5" />{t('projectOkr.addKeyResult')}
                            </Button>
                          </div>
                        </section>
                      )
                    })}
                      </fieldset>
                    )}
                    {selectedCycleCalculation && (
                      <div className="rounded-md border border-border/70 p-3 text-sm" aria-live="polite">
                        <strong>{t('projectOkr.cycleProgress')}:</strong> {formatOkrProgress(selectedCycleCalculation.progress, t('projectOkr.unknownProgress'))}
                        <span className="ml-2 text-muted-foreground">
                          {t('projectOkr.knownContribution', { value: (selectedCycleCalculation.progress.knownContribution * 100).toFixed(1) })}; {t('projectOkr.coverage', { value: (selectedCycleCalculation.progress.coverage * 100).toFixed(1) })}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {!okrLoading && okrCycles.length === 0 && (
                  <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">{t('projectOkr.empty')}</p>
                )}
                <div className="flex flex-wrap justify-end gap-2 border-t border-border/50 pt-3">
                  <Button type="button" variant="outline" disabled={!okrDocument || okrSaving} onClick={() => { setOkrCycles(okrDocument?.cycles ?? []); setOkrError(null) }}>
                    {t('projectOkr.cancel')}
                  </Button>
                  <Button type="button" disabled={!okrDocument || okrSaving || okrLoading} onClick={() => void handleSaveOkr()}>
                    {okrSaving ? t('projectOkr.saving') : t('projectOkr.save')}
                  </Button>
                </div>
              </div>
            </Info_Section>
          )}

          {/* Assets tab */}
          {tab === 'assets' && (
            <Info_Section
              title={t('projectInfo.tabAssets')}
              actions={
                <label
                  className="inline-flex items-center gap-1 h-7 px-3 text-xs font-medium rounded-[var(--radius-control)] bg-foreground/[0.06] hover:bg-foreground/[0.1] transition-colors cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t('projectInfo.uploadAssets')}
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? [])
                      for (const f of files) await handleUpload(f)
                      e.target.value = ''
                    }}
                  />
                </label>
              }
            >
              {assets.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  {t('projectInfo.noAssets')}
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {assets.map((a) => (
                    <li key={a.filename} className="px-4 py-2 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{a.filename}</div>
                        <div className="text-xs text-foreground/50">
                          {(a.sizeBytes / 1024).toFixed(1)} KB · {a.mimeType}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteAsset(a)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Info_Section>
          )}

          {/* Settings tab */}
          {tab === 'settings' && (
            <Info_Section title={t('projectInfo.tabSettings')}>
              <div className="space-y-4 px-4 py-3">
                <Field label={t('projectInfo.title')}>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder={project.config.name}
                  />
                </Field>
                <Field label={t('projectInfo.description')}>
                  <Input
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder={t('projectInfo.descriptionPlaceholder')}
                  />
                </Field>
                <Field label={t('projectInfo.workingDirectory')}>
                  <div className="flex gap-2">
                    <Input
                      value={editWorkingDir}
                      onChange={(e) => setEditWorkingDir(e.target.value)}
                      placeholder={t('projectInfo.workingDirectoryPlaceholder')}
                      className="flex-1"
                    />
                    <Button size="sm" variant="outline" onClick={handlePickWorkingDirectory}>
                      <FolderOpen className="h-3.5 w-3.5 mr-1" />
                      {t('projectInfo.workingDirectoryPicker')}
                    </Button>
                  </div>
                </Field>
                <Field
                  label={t('projectInfo.icon')}
                  hint={t('projectInfo.iconHint')}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-foreground/5 ring-1 ring-border/50">
                      <ProjectIcon
                        workspaceId={workspaceId}
                        projectSlug={project.config.slug}
                        iconFilename={project.config.icon}
                        color={editColor || project.config.color}
                        className="h-5 w-5"
                        iconClassName="h-5 w-5 text-foreground/60"
                      />
                    </div>
                    <label className="inline-flex items-center gap-1 h-7 px-3 text-xs font-medium rounded-[var(--radius-control)] bg-foreground/[0.06] hover:bg-foreground/[0.1] transition-colors cursor-pointer">
                      <ImagePlus className="h-3.5 w-3.5" />
                      {t('projectInfo.iconUpload')}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,.ico"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (file) await handleUploadIcon(file)
                          e.target.value = ''
                        }}
                      />
                    </label>
                    {project.config.icon && (
                      <Button size="sm" variant="ghost" onClick={() => void handleClearIcon()}>
                        {t('projectInfo.iconClear')}
                      </Button>
                    )}
                  </div>
                </Field>
                <Field
                  label={t('projectInfo.color')}
                  hint={t('projectInfo.colorHint')}
                >
                  <InlineColorPickerRow
                    value={editColor}
                    onChange={setEditColor}
                    presets={PROJECT_COLOR_PALETTE}
                    onClear={() => setEditColor('')}
                    clearLabel={t('projectInfo.colorClear')}
                    customAriaLabel={t('projectInfo.colorCustom')}
                  />
                </Field>
                <Field
                  label={t('projectInfo.details')}
                  hint={t('projectInfo.detailsHelpText')}
                >
                  <Textarea
                    value={editDetails}
                    onChange={(e) => setEditDetails(e.target.value)}
                    rows={6}
                    placeholder={t('projectInfo.detailsPlaceholder')}
                  />
                </Field>
                <div className="flex justify-between pt-2">
                  <Button
                    variant="ghost"
                    onClick={handleDeleteProject}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {t('projectInfo.deleteProject')}
                  </Button>
                  <Button onClick={handleSaveSettings} disabled={saving}>
                    {saving ? t('common.saving') : t('common.save')}
                  </Button>
                </div>
              </div>
            </Info_Section>
          )}

          {/* Metadata read-out for quick reference */}
          <Info_Section title={t('projectInfo.metadata')}>
            <Info_Table>
              <Info_Table.Row label={t('common.slug')} value={project.config.slug} />
              <Info_Table.Row label={t('common.location')}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex-1 min-w-0 truncate font-mono text-xs">{project.folderPath}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onOpenFile(project.folderPath)}
                        className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
                        aria-label={t('projectInfo.openLocation')}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t('projectInfo.openLocation')}</TooltipContent>
                  </Tooltip>
                </div>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-sm rounded-t-md border-b-2',
        active
          ? 'border-foreground/80 text-foreground'
          : 'border-transparent text-foreground/60 hover:text-foreground/80'
      )}
    >
      {children}
    </button>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-foreground/70 mb-1">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-foreground/50">{hint}</div>}
    </label>
  )
}
function updateKeyResult(
  updateCycle: (update: (cycle: OkrCycle) => OkrCycle) => void,
  objectiveId: string,
  keyResultId: string,
  update: (keyResult: OkrKeyResult) => OkrKeyResult
): void {
  updateCycle((cycle) => ({
    ...cycle,
    objectives: cycle.objectives.map((objective) => objective.id === objectiveId
      ? {
          ...objective,
          keyResults: objective.keyResults.map((keyResult) => keyResult.id === keyResultId ? update(keyResult) : keyResult),
        }
      : objective),
  }))
}

function formatOkrProgress(progress: OkrProgress, unknownLabel: string): string {
  return progress.score === null ? unknownLabel : `${(progress.score * 100).toFixed(1)}%`
}
function formatLocalDateTimeInput(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
