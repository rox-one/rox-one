/**
 * ProjectInfoPage — one-surface project roadmap.
 *
 * Everything a project needs on a single scroll: Цель, Ожидаемый результат
 * (definition of done), Вводные (drop zone), Вехи on an interactive timeline
 * with Этапы/подэтапы, Требования by kind with acceptance criteria, Задачи
 * linked to milestones (shared personal-task store), Сессии, риски и вопросы,
 * and a built-in AI that turns a raw brief into a spec proposal the user
 * accepts item by item.
 *
 * Persistence: roadmap.json (+ roadmap.md mirror) next to config.json in the
 * project folder — see packages/shared/src/projects/roadmap.ts. The right
 * inspector is hidden on this route; the useful metadata sits in the header.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useAtomValue } from 'jotai'
import {
  Bot,
  Check,
  FileDown,
  Flag,
  FolderOpen,
  ImagePlus,
  MessageSquare,
  Plus,
  Settings2,
  Trash2,
  Wand2,
  ArrowDown,
  ArrowUp,
} from 'lucide-react'
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
import { createNativeNotesSyncController } from '@/lib/native-notes-sync'
import { Info_Page, Info_Section } from '@/components/info'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import {
  isClaimableLive,
  soupProjectActResult,
  soupProjectListResult,
  soupProjectReadResult,
} from '@rox/core/rox2'
import type { PersonalTask } from '@rox/core/tasks/personal'
import { PROJECT_COLOR_PALETTE } from '@/utils/project-colors'
import { InlineColorPickerRow } from '@/components/ui/inline-color-picker-row'
import type { LoadedProject, ProjectAsset, OkrCycle, OkrKeyResult, OkrObjective, OkrProgress, ProjectOkrDocument } from '@rox/shared/projects/types'
import { calculateOkrCycle, createOkrCycle } from '@rox/shared/projects'
import { RepositorySnapshotPanel } from '@/components/code-intelligence/RepositorySnapshotPanel'
import { SharedProjectDetails } from '@/components/projects/SharedProjectProjection'
import {
  createRoadmapSaveQueue,
  isRoadmapRevision,
  emptyRoadmap,
  milestoneProgress,
  normalizeRoadmap,
  roadmapToMarkdown,
  toIsoDate,
  REQUIREMENT_KINDS,
  MILESTONE_STATUSES,
  ROADMAP_INPUT_KINDS,
  type ProjectRoadmap,
  type RoadmapMarkdownLabels,
  type RoadmapMilestone,
} from '@rox/shared/projects/roadmap'
import { applyProposalItem, type ProposalItemKey, type RoadmapProposal } from '@rox/shared/projects/roadmap-ai'
import { buildDelegationPrompt, subtasksOf } from '@/pages/tasks/task-model'
import { AutoTextarea, CheckBox, EditableItemList, EmptyLine, IconButton, InlineInput, Section, TextButton } from './project/roadmap-ui'
import { MilestoneList, RoadmapTimeline } from './project/ProjectTimeline'
import { ProjectRequirements } from './project/ProjectRequirements'
import { ProjectInputs, type PickOption } from './project/ProjectInputs'
import { ProjectAiPanel, type AiStatus, type ImproveProposal, type ImproveTarget } from './project/ProjectAiPanel'

interface ProjectInfoPageProps {
  projectSlug: string
}

const SAVE_DEBOUNCE_MS = 400
const WIDE_LAYOUT_PX = 1040
const LANGUAGE_NAMES: Record<string, string> = {
  ru: 'Russian', en: 'English', de: 'German', es: 'Spanish', fr: 'French', hu: 'Hungarian',
  ja: 'Japanese', pl: 'Polish', 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese',
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function ProjectInfoPage({ projectSlug }: ProjectInfoPageProps) {
  const workspace = useActiveWorkspace()
  return projectSlug.startsWith('project:')
    ? <SharedProjectDetails entityId={projectSlug} />
    : <LocalProjectInfoPage key={`${workspace?.id ?? ''}:${projectSlug}`} projectSlug={projectSlug} />
}

function LocalProjectInfoPage({ projectSlug }: ProjectInfoPageProps) {
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const shell = useAppShellContext()
  const { onCreateSession, onOpenFile } = shell

  const [project, setProject] = useState<LoadedProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [taskStore, setTaskStore] = useState(loadPersonalTaskStore)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskMilestone, setNewTaskMilestone] = useState<string | null>(null)
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [roadmap, setRoadmap] = useState<ProjectRoadmap>(emptyRoadmap)
  const [roadmapLoaded, setRoadmapLoaded] = useState(false)
  const [roadmapCorrupt, setRoadmapCorrupt] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)
  const [improve, setImprove] = useState<ImproveProposal | null>(null)
  const [improving, setImproving] = useState<ImproveTarget | null>(null)
  const [delegatingId, setDelegatingId] = useState<string | null>(null)
  const [notes, setNotes] = useState<PickOption[]>([])
  const [sources, setSources] = useState<PickOption[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editWorkingDir, setEditWorkingDir] = useState('')
  const [editDetails, setEditDetails] = useState('')
  const [editColor, setEditColor] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [width, setWidth] = useState(0)

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



  const containerRef = useRef<HTMLDivElement>(null)
  const roadmapRef = useRef<ProjectRoadmap>(roadmap)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const roadmapSaverRef = useRef<ReturnType<typeof createRoadmapSaveQueue> | null>(null)
  const saveAttemptRef = useRef(0)
  const loadedOnce = useRef(false)
  const exportAttemptRef = useRef<{ operationId: string; note?: import('@rox/shared/protocol/dto').NoteDocument } | null>(null)
  const exportingRef = useRef(false)

  // ── Load project (first load shows the spinner; broadcasts reload silently) ──
  const loadProject = useCallback(async () => {
    if (!workspaceId) return
    const listed = soupProjectListResult({ source: 'native', nativeIds: projectSlug ? [projectSlug] : [] })
    const read = soupProjectReadResult({ source: 'native', nativeId: projectSlug })
    if (!isClaimableLive(listed.result) || !isClaimableLive(read.result)) return
    if (!loadedOnce.current) setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.getProject(workspaceId, projectSlug)
      if (!result) {
        setError(t('projectInfo.notFound'))
        setProject(null)
        return
      }
      const loaded = result as LoadedProject
      setProject(loaded)
      setEditWorkingDir(loaded.config.workingDirectory ?? '')
      setEditDetails(loaded.config.details ?? '')
      setEditColor(loaded.config.color ?? '')
      loadedOnce.current = true
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to load project:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, projectSlug, t])

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
    loadedOnce.current = false
    setRoadmapLoaded(false)
    void loadProject()
    void refreshAssets()
  }, [loadProject, refreshAssets])

  useEffect(() => {
    if (!workspaceId) return
    const off = window.electronAPI.onProjectsChanged((wsId: string) => {
      if (wsId === workspaceId) {
        void loadProject()
        void refreshAssets()
        void loadOkr()
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [workspaceId, loadProject, refreshAssets, loadOkr])

  // ── Roadmap load / debounced save ──
  useEffect(() => {
    if (!workspaceId || !projectSlug) return
    let cancelled = false
    let saver: ReturnType<typeof createRoadmapSaveQueue> | null = null
    roadmapSaverRef.current = null
    roadmapRef.current = emptyRoadmap()
    setRoadmap(roadmapRef.current)
    setRoadmapLoaded(false)
    setRoadmapCorrupt(false)
    setSaveState('idle')
    void window.electronAPI.getProjectRoadmap(workspaceId, projectSlug).then((res) => {
      if (cancelled) return
      const next = normalizeRoadmap(res?.roadmap)
      if (!res || !isRoadmapRevision(next.revision)) throw new Error('PROJECT_ROADMAP_MISSING_READ_RECEIPT')
      saver = createRoadmapSaveQueue(next.revision, (draft) =>
        window.electronAPI.saveProjectRoadmap(workspaceId, projectSlug, draft))
      roadmapSaverRef.current = saver
      roadmapRef.current = next
      setRoadmap(next)
      setRoadmapCorrupt(res?.corrupt === true)
      setRoadmapLoaded(true)
    }).catch((err) => {
      console.error('[ProjectInfoPage] Failed to load roadmap:', err)
      if (!cancelled) {
        setSaveState('error')
        setRoadmapLoaded(true)
      }
    })
    return () => {
      cancelled = true
      if (roadmapSaverRef.current === saver) {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current)
          saveTimer.current = null
          // The captured writer keeps the old project/workspace scope.
          const act = soupProjectActResult({ source: 'native', action: 'write', nativeId: projectSlug })
          if (isClaimableLive(act)) {
            void saver?.save(roadmapRef.current).catch((err) => console.error('[ProjectInfoPage] Final roadmap save failed:', err))
          }
        }
        roadmapSaverRef.current = null
      }
    }
  }, [workspaceId, projectSlug])

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const saver = roadmapSaverRef.current
    if (!workspaceId || !saver) {
      setSaveState('error')
      return false
    }
    const act = soupProjectActResult({ source: 'native', action: 'write', nativeId: projectSlug })
    if (!isClaimableLive(act)) return false
    const draft = roadmapRef.current
    const attempt = ++saveAttemptRef.current
    setSaveState('saving')
    try {
      const saved = await saver.save(draft)
      if (roadmapSaverRef.current !== saver || saveAttemptRef.current !== attempt) return false
      setRoadmapCorrupt(false)
      if (roadmapRef.current === draft) {
        const next = normalizeRoadmap(saved)
        roadmapRef.current = next
        setRoadmap(next)
        setSaveState('saved')
        return true
      } else {
        setSaveState('saving')
        return false
      }
    } catch (err) {
      if (roadmapSaverRef.current !== saver || saveAttemptRef.current !== attempt) return false
      console.error('[ProjectInfoPage] Roadmap save failed:', err)
      setSaveState('error')
      toast.error(t('projectRoadmap.saveFailed'))
      return false
    }
  }, [workspaceId, projectSlug, t])

  const flushRef = useRef(flushSave)
  flushRef.current = flushSave

  const updateRoadmap = useCallback((mutate: (current: ProjectRoadmap) => ProjectRoadmap) => {
    const next = mutate(roadmapRef.current)
    roadmapRef.current = next
    setRoadmap(next)
    if (!roadmapSaverRef.current) {
      setSaveState('error')
      return
    }
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flushRef.current(), SAVE_DEBOUNCE_MS)
  }, [])

  // ── AI status + pickers ──
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setAiStatus(null)
    window.electronAPI.getProjectAiStatus(workspaceId)
      .then((s) => { if (!cancelled) setAiStatus(s ?? { available: false }) })
      .catch(() => { if (!cancelled) setAiStatus({ available: false, reason: 'error' }) })
    window.electronAPI.listNotes(workspaceId)
      .then((list) => {
        if (cancelled) return
        setNotes([...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60).map((n) => ({ id: n.id, title: n.title || n.relativePath })))
      })
      .catch(() => undefined)
    window.electronAPI.getSources(workspaceId)
      .then((list) => { if (!cancelled) setSources(list.map((s) => ({ id: s.config.slug, title: s.config.name || s.config.slug }))) })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  // ── Layout width (two columns when wide) ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [project])
  const wide = width >= WIDE_LAYOUT_PX

  // ── Sessions & tasks ──
  const projectSessions = useMemo(() => {
    if (!project) return []
    const result: { id: string; name: string; lastMessageAt: number; processing: boolean }[] = []
    for (const meta of sessionMetaMap.values()) {
      if ((meta as { projectId?: string }).projectId === project.config.id && !meta.hidden) {
        result.push({ id: meta.id, name: meta.name ?? meta.id, lastMessageAt: meta.lastMessageAt ?? 0, processing: meta.isProcessing === true })
      }
    }
    return result.sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  }, [project, sessionMetaMap])

  const sessionOptions = useMemo<PickOption[]>(() => {
    const all = [...sessionMetaMap.values()]
      .filter((m) => !m.hidden && !m.isArchived && (m.workspaceId ?? workspaceId) === workspaceId)
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .slice(0, 40)
    return all.map((m) => ({ id: m.id, title: m.name || t('projectRoadmap.untitledSession') }))
  }, [sessionMetaMap, workspaceId, t])

  useEffect(() => subscribePersonalTasks(() => setTaskStore(loadPersonalTaskStore())), [])

  const projectTasks = useMemo(() => {
    if (!project) return []
    return tasksForWorkspaceProject(taskStore, project.config.id).filter((task) => !task.trashedAt && !task.parentId)
  }, [project, taskStore])

  const milestoneOfTask = useMemo(() => {
    const map = new Map<string, RoadmapMilestone>()
    for (const m of roadmap.milestones) for (const id of m.taskIds) map.set(id, m)
    return map
  }, [roadmap.milestones])

  const mutateTasks = useCallback((fn: (store: ReturnType<typeof loadPersonalTaskStore>) => void) => {
    const next = loadPersonalTaskStore()
    fn(next)
    persistPersonalTaskStore(next)
    setTaskStore(next)
  }, [])

  const linkTaskToMilestone = useCallback((taskId: string, milestoneId: string | null) => {
    updateRoadmap((r) => ({
      ...r,
      milestones: r.milestones.map((m) => {
        const without = m.taskIds.filter((id) => id !== taskId)
        return { ...m, taskIds: m.id === milestoneId ? [...without, taskId] : without }
      }),
    }))
  }, [updateRoadmap])

  const createTask = useCallback((title: string, milestoneId: string | null) => {
    if (!project || !title.trim()) return
    let createdId: string | null = null
    mutateTasks((store) => {
      createdId = store.create({ title: title.trim(), list: 'inbox', projectId: project.config.id }).id
    })
    if (createdId && milestoneId) linkTaskToMilestone(createdId, milestoneId)
    return createdId
  }, [project, mutateTasks, linkTaskToMilestone])

  const handleCreateProjectTask = useCallback((event: React.FormEvent) => {
    event.preventDefault()
    if (!project || !newTaskTitle.trim()) return
    createTask(newTaskTitle, newTaskMilestone)
    setNewTaskTitle('')
  }, [project, newTaskTitle, newTaskMilestone, createTask])

  const toggleTask = useCallback((task: PersonalTask) => {
    mutateTasks((store) => {
      if (task.completedAt) store.reopen(task.id)
      else store.completeTask(task.id)
    })
  }, [mutateTasks])

  const delegateTask = useCallback(async (task: PersonalTask) => {
    if (!workspaceId || !project) return
    setDelegatingId(task.id)
    try {
      const store = loadPersonalTaskStore()
      const prompt = buildDelegationPrompt(task, subtasksOf(store.list(), task.id), t('tasks.delegate.promptHeading'))
      const checklist = (task.checklist ?? []).filter((item) => !item.done).map((item) => `- [ ] ${item.title}`)
      const fullPrompt = checklist.length ? `${prompt}\n\n${checklist.join('\n')}` : prompt
      const session = await onCreateSession(workspaceId, { sessionStatus: 'todo', projectId: project.config.id })
      await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: task.title })
      await window.electronAPI.sessionCommand(session.id, { type: 'setSessionStatus', state: 'todo' })
      mutateTasks((s) => { s.link(task.id, { kind: 'session', id: session.id }) })
      await window.electronAPI.sendMessage(session.id, fullPrompt)
      toast.success(t('projectRoadmap.delegated', { title: task.title }))
    } catch (err) {
      toast.error(t('tasks.delegate.failed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setDelegatingId(null)
    }
  }, [workspaceId, project, onCreateSession, mutateTasks, t])

  const taskStats = useCallback((m: RoadmapMilestone) => {
    let open = 0
    let done = 0
    for (const id of m.taskIds) {
      const task = taskStore.get(id)
      if (!task || task.trashedAt) continue
      if (task.completedAt) done += 1
      else open += 1
    }
    return { open, done }
  }, [taskStore])

  // ── Project config actions ──
  const handleStartSession = useCallback(async () => {
    if (!workspaceId || !project) return
    try {
      const session = await onCreateSession(workspaceId, { projectId: project.config.id })
      if (session?.id) navigate(routes.view.allSessions(session.id))
    } catch (err) {
      console.error('[ProjectInfoPage] Failed to create session:', err)
      toast.error(t('projectInfo.newSessionFailed'))
    }
  }, [workspaceId, project, onCreateSession, t])

  const patchProject = useCallback(async (patch: Partial<Omit<LoadedProject['config'], 'id' | 'slug' | 'createdAt'>>) => {
    if (!workspaceId || !project) return false
    const act = soupProjectActResult({
      source: 'native',
      action: 'write',
      nativeId: project.config.slug,
    })
    if (!isClaimableLive(act)) return false
    try {
      await window.electronAPI.updateProject(workspaceId, project.config.slug, patch)
      return true
    } catch (err) {
      console.error('[ProjectInfoPage] Save failed:', err)
      toast.error(t('projectInfo.saveFailed'))
      return false
    }
  }, [workspaceId, project, t])

  const handleSaveSettings = useCallback(async () => {
    if (!project) return
    setSaving(true)
    try {
      const saved = await patchProject({
        workingDirectory: editWorkingDir.trim() || undefined,
        details: editDetails.trim() || undefined,
        color: editColor.trim() || undefined,
      })
      if (saved) toast.success(t('projectInfo.saved'))
    } finally {
      setSaving(false)
    }
  }, [project, patchProject, editWorkingDir, editDetails, editColor, t])

  const handlePickWorkingDirectory = useCallback(async () => {
    try {
      const picked = await window.electronAPI.openFolderDialog?.()
      if (typeof picked === 'string' && picked.trim()) setEditWorkingDir(picked)
    } catch (err) {
      console.error('[ProjectInfoPage] Folder picker failed:', err)
    }
  }, [])

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
      navigate(routes.view.projects())
    } catch (err) {
      console.error('[ProjectInfoPage] Delete failed:', err)
      toast.error(t('projectInfo.deleteFailed'))
    }
  }, [workspaceId, project, t])

  const handleUploadAsset = useCallback(async (file: { filename: string; base64: string }) => {
    if (!workspaceId || !project) return
    await window.electronAPI.uploadProjectAsset(workspaceId, project.config.slug, file)
    await refreshAssets()
    toast.success(t('projectInfo.assetUploaded', { name: file.filename }))
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
    if (!/\.(png|jpe?g|webp|gif|svg|ico)$/i.test(file.name)) {
      toast.error(t('projectInfo.iconInvalidType'))
      return
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
      const base64 = btoa(binary)
      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.png'
      const filename = `project-icon${ext.toLowerCase()}`
      for (const old of new Set([project.config.icon, filename])) {
        if (!old) continue
        try {
          await window.electronAPI.deleteProjectAsset(workspaceId, project.config.slug, old)
        } catch {
          // ignore missing old icon
        }
      }
      const asset = await window.electronAPI.uploadProjectAsset(workspaceId, project.config.slug, { filename, base64 })
      await window.electronAPI.updateProject(workspaceId, project.config.slug, { icon: asset.filename })
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

  // ── AI ──
  const today = toIsoDate(new Date())
  const baseLang = i18n.language?.startsWith('zh') ? i18n.language : (i18n.language ?? 'ru').split('-')[0]!
  const runAi = useCallback(async (request: { mode: 'clarify' | 'spec' | 'improve'; text: string; answers?: { question: string; answer: string }[] }) => {
    if (!workspaceId) return { ok: false as const, error: 'no workspace' }
    const requestSaver = roadmapSaverRef.current
    if (!requestSaver) return { ok: false as const, error: 'PROJECT_ROADMAP_SAVE_REQUIRED' }
    // Wait for the queued native receipt before exposing the draft to the model.
    if (!await flushRef.current()) return { ok: false as const, error: 'PROJECT_ROADMAP_SAVE_REQUIRED' }
    if (roadmapSaverRef.current !== requestSaver) return { ok: false as const, error: 'PROJECT_ROADMAP_SCOPE_CHANGED' }
    return window.electronAPI.runProjectRoadmapAi(workspaceId, projectSlug, {
      ...request,
      roadmapRevision: roadmapRef.current.revision,
      today,
      language: LANGUAGE_NAMES[baseLang] ?? 'Russian',
    })
  }, [workspaceId, projectSlug, today, baseLang])

  const acceptProposal = useCallback(async (proposal: RoadmapProposal, keys: ProposalItemKey[], expectedRevision?: string) => {
    if (!isRoadmapRevision(expectedRevision) || expectedRevision !== roadmapRef.current.revision) throw new Error('PROJECT_ROADMAP_CONFLICT')
    updateRoadmap((r) => keys.reduce((acc, key) => applyProposalItem(acc, proposal, key, today), r))
    if (!await flushRef.current()) throw new Error('PROJECT_ROADMAP_SAVE_REQUIRED')
    return roadmapRef.current.revision!
  }, [updateRoadmap, today])

  const improveField = useCallback(async (target: ImproveTarget) => {
    const before = target === 'goal' ? roadmapRef.current.goal : roadmapRef.current.expectedResult
    if (!before.trim()) return
    const requestSaver = roadmapSaverRef.current
    setImproving(target)
    try {
      const res = await runAi({ mode: 'improve', text: before })
      if (roadmapSaverRef.current !== requestSaver) return
      if (res.ok && res.mode === 'improve') setImprove({ target, before, after: res.text, roadmapRevision: res.roadmapRevision })
      else if (!res.ok) toast.error(t('projectRoadmap.ai.errorGeneric', { error: res.error }))
    } finally {
      if (roadmapSaverRef.current === requestSaver) setImproving(null)
    }
  }, [runAi, t])

  // ── Export ──
  const markdownLabels = useMemo<RoadmapMarkdownLabels>(() => ({
    goal: t('projectRoadmap.goal'),
    expectedResult: t('projectRoadmap.expectedResult'),
    doneCriteria: t('projectRoadmap.doneCriteria'),
    milestones: t('projectRoadmap.milestones'),
    requirements: t('projectRoadmap.requirements'),
    acceptance: t('projectRoadmap.acceptance'),
    risks: t('projectRoadmap.risks'),
    openQuestions: t('projectRoadmap.openQuestions'),
    inputs: t('projectRoadmap.inputs'),
    status: Object.fromEntries(MILESTONE_STATUSES.map((s) => [s, t(`projectRoadmap.status.${s}`)])) as RoadmapMarkdownLabels['status'],
    requirementKind: Object.fromEntries(REQUIREMENT_KINDS.map((k) => [k, t(`projectRoadmap.requirementKind.${k}`)])) as RoadmapMarkdownLabels['requirementKind'],
    inputKind: Object.fromEntries(ROADMAP_INPUT_KINDS.map((k) => [k, t(`projectRoadmap.inputKind.${k}`)])) as RoadmapMarkdownLabels['inputKind'],
    generatedNote: '',
  }), [t])

  const exportToNote = useCallback(async () => {
    if (!workspaceId || !project || exportingRef.current) return
    exportingRef.current = true
    let controller: ReturnType<typeof createNativeNotesSyncController> | null = null
    try {
      if (!window.electronAPI.nativeReplica || !window.electronAPI.nativeData) throw new Error('Native Notes export is unavailable')
      if (!await flushRef.current()) throw new Error('PROJECT_ROADMAP_SAVE_REQUIRED')
      controller = createNativeNotesSyncController()
      await controller.start(workspaceId)
      const files = assets.filter((a) => a.filename !== project.config.icon).map((a) => a.filename)
      let markdown = roadmapToMarkdown(roadmapRef.current, project.config.name, markdownLabels, { files })
      if (projectTasks.length) {
        const lines = [``, `## ${t('projectRoadmap.tasks')}`, '']
        for (const task of projectTasks) {
          const m = milestoneOfTask.get(task.id)
          lines.push(`- [${task.completedAt ? 'x' : ' '}] ${task.title}${m ? ` — ${m.title}` : ''}`)
        }
        markdown = `${markdown.trimEnd()}\n${lines.join('\n')}\n`
      }
      const attempt = exportAttemptRef.current ?? { operationId: crypto.randomUUID() }
      exportAttemptRef.current = attempt
      const created = attempt.note ?? await window.electronAPI.createNote(workspaceId,
        t('projectRoadmap.noteTitle', { name: project.config.name }), `projects/${project.config.slug}`,
        { operationId: attempt.operationId, expectedRevision: null, schemaVersion: 1 })
      attempt.note = created
      if (!created.nativeId || !Number.isSafeInteger(created.nativeRevision)) throw new Error('Native Notes creation did not return canonical identity and revision')
      const queued = await controller.queueSave(created, markdown)
      const receipts = await controller.flush()
      if (!receipts.some(receipt => receipt.operationId === queued.operationId)) throw new Error('Native Notes export remains unacknowledged')
      exportAttemptRef.current = null
      toast.success(t('projectRoadmap.exported'), {
        action: { label: t('projectRoadmap.openNote'), onClick: () => navigate(routes.view.notes(created.id)) },
      })
    } catch (err) {
      toast.error(t('projectRoadmap.exportFailed'), { description: err instanceof Error ? err.message : undefined })
    } finally {
      try { await controller?.stop() } finally { exportingRef.current = false }
    }
  }, [workspaceId, project, assets, markdownLabels, projectTasks, milestoneOfTask, t])

  // ── Derived header stats ──
  const stats = useMemo(() => {
    const ms = roadmap.milestones
    let stagesDone = 0
    let stagesTotal = 0
    for (const m of ms) {
      const p = milestoneProgress(m)
      stagesDone += p.done
      stagesTotal += p.total
    }
    const dates = ms.flatMap((m) => [m.startDate, m.dueDate].filter((d): d is string => Boolean(d))).sort()
    return {
      milestonesDone: ms.filter((m) => m.status === 'done').length,
      milestonesTotal: ms.length,
      stagesDone,
      stagesTotal,
      tasksDone: projectTasks.filter((task) => task.completedAt).length,
      tasksTotal: projectTasks.length,
      start: dates[0],
      end: dates[dates.length - 1],
    }
  }, [roadmap.milestones, projectTasks])

  const locale = i18n.language || 'ru'
  const shortDate = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }), [locale])
  const relTime = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), [locale])

  const focusMilestone = (id: string) => {
    setExpandedMilestone(id)
    requestAnimationFrame(() => document.getElementById(`project-milestone-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  if (!workspaceId) {
    return <div className="h-full p-6" data-testid="project-workspace-unavailable" data-state="unavailable">
      <h1 className="text-lg font-semibold">{t('sharedProjects.heading')}</h1>
      <p role="status" className="mt-4 text-sm text-muted-foreground">{t('common.unavailable')}</p>
    </div>
  }

  if (!project || loading || error) {
    return (
      <Info_Page
        loading={loading}
        error={error ?? undefined}
        empty={!project && !loading && !error ? t('projectInfo.notFound') : undefined}
      >
        <Info_Page.Header title={project?.config.name ?? ''} />
      </Info_Page>
    )
  }

  const side = (
    <div className="flex min-w-0 flex-col gap-6">
      <ProjectAiPanel
        key={`${workspaceId}:${project.config.id}`}
        projectId={`${workspaceId}:${project.config.id}`}
        roadmap={roadmap}
        status={aiStatus}
        runAi={runAi}
        onAccept={acceptProposal}
        improve={improve}
        onImproveDone={() => setImprove(null)}
        onApplyImprove={async (p) => {
          if (!isRoadmapRevision(p.roadmapRevision) || p.roadmapRevision !== roadmapRef.current.revision) throw new Error('PROJECT_ROADMAP_CONFLICT')
          updateRoadmap((r) => (p.target === 'goal' ? { ...r, goal: p.after } : p.target === 'expectedResult' ? { ...r, expectedResult: p.after } : r))
          if (!await flushRef.current()) throw new Error('PROJECT_ROADMAP_SAVE_REQUIRED')
        }}
      />
      <RepositorySnapshotPanel
        key={`${workspaceId}:${project.config.id}:${project.config.workingDirectory ?? ''}`}
        workspaceId={workspaceId!}
        projectId={project.config.id}
        workingDirectory={project.config.workingDirectory}
      />
      <Section id="inputs" title={t('projectRoadmap.inputs')} count={assets.filter((a) => a.filename !== project.config.icon).length + roadmap.inputs.length}>
        <ProjectInputs
          inputs={roadmap.inputs}
          assets={assets}
          iconFilename={project.config.icon}
          onInputsChange={(inputs) => updateRoadmap((r) => ({ ...r, inputs }))}
          onUploadFile={handleUploadAsset}
          onDeleteAsset={(a) => void handleDeleteAsset(a)}
          onOpenFile={onOpenFile}
          sessionOptions={sessionOptions}
          noteOptions={notes}
          sourceOptions={sources}
        />
      </Section>
    </div>
  )

  const tasksByGroup: { milestone: RoadmapMilestone | null; tasks: PersonalTask[] }[] = []
  for (const m of roadmap.milestones) {
    const list = projectTasks.filter((task) => milestoneOfTask.get(task.id)?.id === m.id)
    if (list.length) tasksByGroup.push({ milestone: m, tasks: list })
  }
  const unlinked = projectTasks.filter((task) => !milestoneOfTask.has(task.id))
  if (unlinked.length) tasksByGroup.push({ milestone: null, tasks: unlinked })

  const main = (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Цель + Ожидаемый результат */}
      <div className="grid min-w-0 grid-cols-1 gap-4 @[760px]:grid-cols-2">
        <Section
          id="goal"
          title={t('projectRoadmap.goal')}
          actions={
            <IconButton label={t('projectRoadmap.ai.improveField')} disabled={!aiStatus?.available || !roadmap.goal || improving !== null} onClick={() => void improveField('goal')}>
              <Wand2 className={cn('h-3.5 w-3.5', improving === 'goal' && 'animate-pulse')} />
            </IconButton>
          }
        >
          <AutoTextarea
            value={roadmap.goal}
            minRows={2}
            testId="project-goal"
            ariaLabel={t('projectRoadmap.goal')}
            placeholder={t('projectRoadmap.goalPlaceholder')}
            onCommit={(goal) => updateRoadmap((r) => ({ ...r, goal }))}
          />
        </Section>
        <Section
          id="result"
          title={t('projectRoadmap.expectedResult')}
          actions={
            <IconButton label={t('projectRoadmap.ai.improveField')} disabled={!aiStatus?.available || !roadmap.expectedResult || improving !== null} onClick={() => void improveField('expectedResult')}>
              <Wand2 className={cn('h-3.5 w-3.5', improving === 'expectedResult' && 'animate-pulse')} />
            </IconButton>
          }
        >
          <AutoTextarea
            value={roadmap.expectedResult}
            minRows={2}
            testId="project-expected-result"
            ariaLabel={t('projectRoadmap.expectedResult')}
            placeholder={t('projectRoadmap.expectedResultPlaceholder')}
            onCommit={(expectedResult) => updateRoadmap((r) => ({ ...r, expectedResult }))}
          />
          <div className="mt-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{t('projectRoadmap.doneCriteria')}</div>
          <EditableItemList
            testId="project-done-criteria"
            items={roadmap.doneCriteria}
            addPlaceholder={t('projectRoadmap.addDoneCriterionPlaceholder')}
            onChange={(doneCriteria) => updateRoadmap((r) => ({ ...r, doneCriteria }))}
          />
        </Section>
      </div>

      {!wide ? side : null}

      <Section id="milestones" title={t('projectRoadmap.milestones')} count={roadmap.milestones.length} hint={roadmap.milestones.length ? t('projectRoadmap.milestonesHint') : undefined}>
        <div className="flex min-w-0 flex-col gap-2">
          {roadmap.milestones.length ? (
            <RoadmapTimeline
              milestones={roadmap.milestones}
              locale={locale}
              onChange={(milestones) => updateRoadmap((r) => ({ ...r, milestones }))}
              onFocusMilestone={focusMilestone}
            />
          ) : null}
          <MilestoneList
            milestones={roadmap.milestones}
            onChange={(milestones) => updateRoadmap((r) => ({ ...r, milestones }))}
            expandedId={expandedMilestone}
            onExpandedChange={setExpandedMilestone}
            taskStats={taskStats}
            onCreateTask={(title, milestoneId) => {
              createTask(title, milestoneId)
              toast.success(t('projectRoadmap.taskCreated', { title }))
            }}
          />
        </div>
      </Section>

      <Section id="requirements" title={t('projectRoadmap.requirements')} count={roadmap.requirements.length}>
        <ProjectRequirements
          requirements={roadmap.requirements}
          milestones={roadmap.milestones}
          onChange={(requirements) => updateRoadmap((r) => ({ ...r, requirements }))}
        />
      </Section>

      <Section
        id="tasks"
        title={t('projectInfo.tabTasks')}
        count={projectTasks.length}
        actions={
          <button type="button" onClick={() => navigate(routes.view.tasks())} className="h-6 rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground">
            {t('projectRoadmap.openTasks')}
          </button>
        }
      >
        <form onSubmit={handleCreateProjectTask} className="mb-1 flex min-w-0 items-center gap-1 rounded-md bg-foreground/[0.025] px-1">
          <Plus className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          <input
            value={newTaskTitle}
            onChange={(event) => setNewTaskTitle(event.target.value)}
            placeholder={t('tasks.quickEntryPlaceholder')}
            aria-label={t('tasks.newTask')}
            className="h-8 min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground/70"
          />
          {roadmap.milestones.length ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex h-6 max-w-[160px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-foreground/[0.06]">
                  <Flag className="h-3 w-3 shrink-0" />
                  <span className="truncate">{roadmap.milestones.find((m) => m.id === newTaskMilestone)?.title ?? t('projectRoadmap.noMilestone')}</span>
                </button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <StyledDropdownMenuItem onSelect={() => setNewTaskMilestone(null)}>{t('projectRoadmap.noMilestone')}</StyledDropdownMenuItem>
                <StyledDropdownMenuSeparator />
                {roadmap.milestones.map((m) => (
                  <StyledDropdownMenuItem key={m.id} onSelect={() => setNewTaskMilestone(m.id)}>{m.title}</StyledDropdownMenuItem>
                ))}
              </StyledDropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <button
            type="submit"
            data-testid="project-new-task"
            disabled={!newTaskTitle.trim()}
            className="inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            {t('projectInfo.newTaskButton')}
          </button>
        </form>
        {projectTasks.length === 0 ? (
          <EmptyLine>{t('projectRoadmap.tasksEmpty')}</EmptyLine>
        ) : (
          <div className="flex min-w-0 flex-col" data-testid="project-task-list">
            {tasksByGroup.map((group) => (
              <div key={group.milestone?.id ?? 'none'} className="min-w-0">
                <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  <Flag className="h-3 w-3" />
                  {group.milestone ? group.milestone.title : t('projectRoadmap.noMilestone')}
                </div>
                {group.tasks.map((task) => {
                  const sessionLink = task.links.find((l) => l.kind === 'session')
                  return (
                    <div key={task.id} className="group flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-foreground/[0.03]">
                      <CheckBox checked={Boolean(task.completedAt)} label={task.title} onChange={() => toggleTask(task)} />
                      <button
                        type="button"
                        onClick={() => navigate(routes.view.tasks(task.id))}
                        className={cn('min-w-0 flex-1 truncate py-1 text-left text-[13px]', task.completedAt && 'text-muted-foreground line-through')}
                      >
                        {task.title}
                      </button>
                      {roadmap.milestones.length ? (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <button type="button" title={t('projectRoadmap.linkMilestone')} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-foreground/[0.06] group-hover:opacity-100 focus:opacity-100">
                              <Flag className="h-3 w-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <StyledDropdownMenuContent align="end">
                            {roadmap.milestones.map((m) => (
                              <StyledDropdownMenuItem key={m.id} onSelect={() => linkTaskToMilestone(task.id, m.id)}>
                                {milestoneOfTask.get(task.id)?.id === m.id ? <Check className="h-3 w-3" /> : null}
                                {m.title}
                              </StyledDropdownMenuItem>
                            ))}
                            {milestoneOfTask.has(task.id) ? (
                              <>
                                <StyledDropdownMenuSeparator />
                                <StyledDropdownMenuItem onSelect={() => linkTaskToMilestone(task.id, null)}>{t('projectRoadmap.unlinkMilestone')}</StyledDropdownMenuItem>
                              </>
                            ) : null}
                          </StyledDropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                      {sessionLink ? (
                        <button type="button" onClick={() => navigate(routes.view.allSessions(sessionLink.id))} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                          <MessageSquare className="h-3 w-3" />
                          {t('projectRoadmap.taskSession')}
                        </button>
                      ) : !task.completedAt ? (
                        <button
                          type="button"
                          disabled={delegatingId !== null}
                          onClick={() => void delegateTask(task)}
                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground opacity-0 hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                          title={t('tasks.delegate.body')}
                        >
                          <Bot className="h-3 w-3" />
                          {delegatingId === task.id ? t('tasks.delegate.running') : t('tasks.delegate.title')}
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        id="sessions"
        title={t('projectInfo.tabSessions')}
        count={projectSessions.length}
        actions={
          <TextButton tone="ghost" onClick={() => void handleStartSession()}>
            <Plus className="h-3.5 w-3.5" />
            {t('projectRoadmap.newSession')}
          </TextButton>
        }
      >
        {projectSessions.length === 0 ? (
          <EmptyLine>{t('projectInfo.noSessions')}</EmptyLine>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-x-2 @[760px]:grid-cols-2">
            {projectSessions.slice(0, 12).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => navigate(routes.view.allSessions(s.id))}
                className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-foreground/[0.04]"
              >
                <MessageSquare className={cn('h-3.5 w-3.5 shrink-0', s.processing ? 'text-accent' : 'text-muted-foreground')} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
                {s.lastMessageAt ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{relTime.format(new Date(s.lastMessageAt))}</span> : null}
              </button>
            ))}
          </div>
        )}
      </Section>

      <section id="project-section-okr" data-testid="project-okr-section">
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
      </section>
      <div className="grid min-w-0 grid-cols-1 gap-4 @[760px]:grid-cols-2">
        <Section id="risks" title={t('projectRoadmap.risks')} count={roadmap.risks.length}>
          <EditableItemList
            items={roadmap.risks}
            checkable={false}
            addPlaceholder={t('projectRoadmap.addRiskPlaceholder')}
            onChange={(risks) => updateRoadmap((r) => ({ ...r, risks }))}
          />
        </Section>
        <Section id="questions" title={t('projectRoadmap.openQuestions')} count={roadmap.openQuestions.filter((q) => !q.done).length}>
          <EditableItemList
            items={roadmap.openQuestions}
            addPlaceholder={t('projectRoadmap.addQuestionPlaceholder')}
            onChange={(openQuestions) => updateRoadmap((r) => ({ ...r, openQuestions }))}
          />
        </Section>
      </div>
    </div>
  )

  return (
    <Info_Page>
      <Info_Page.Header title={project.config.name} />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden" data-testid="project-roadmap-page">
        <div ref={containerRef} className="@container mx-auto w-full min-w-0 max-w-[1240px] px-6 pb-12 pt-4">
          {/* Header — replaces the old hero, tabs, Метаданные and the right inspector */}
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-foreground/[0.05]">
              <ProjectIcon
                workspaceId={workspaceId}
                projectSlug={project.config.slug}
                iconFilename={project.config.icon}
                color={project.config.color}
                className="h-5 w-5"
                iconClassName="h-5 w-5 text-foreground/60"
              />
            </div>
            <div className="min-w-0 flex-1">
              <InlineInput
                value={project.config.name}
                ariaLabel={t('projectInfo.title')}
                className="h-8 -ml-2 text-[18px] font-semibold"
                onCommit={(name) => name && void patchProject({ name })}
              />
              <InlineInput
                value={project.config.description ?? ''}
                ariaLabel={t('projectInfo.description')}
                placeholder={t('projectInfo.descriptionPlaceholder')}
                className="-ml-2 text-muted-foreground"
                onCommit={(description) => void patchProject({ description: description || undefined })}
              />
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground" data-testid="project-meta">
                <span className="tabular-nums">{t('projectRoadmap.metaMilestones', { done: stats.milestonesDone, total: stats.milestonesTotal })}</span>
                {stats.stagesTotal ? <span className="tabular-nums">{t('projectRoadmap.metaStages', { done: stats.stagesDone, total: stats.stagesTotal })}</span> : null}
                <span className="tabular-nums">{t('projectRoadmap.metaTasks', { done: stats.tasksDone, total: stats.tasksTotal })}</span>
                {stats.start && stats.end ? (
                  <span className="tabular-nums">{shortDate.format(new Date(`${stats.start}T00:00`))} — {shortDate.format(new Date(`${stats.end}T00:00`))}</span>
                ) : null}
                <button type="button" onClick={() => onOpenFile(project.folderPath)} className="inline-flex min-w-0 max-w-[280px] items-center gap-1 hover:text-foreground" title={project.folderPath}>
                  <FolderOpen className="h-3 w-3 shrink-0" />
                  <span className="truncate">{t('projectRoadmap.metaFolder')}</span>
                </button>
                {project.config.workingDirectory ? (
                  <span className="inline-flex min-w-0 max-w-[280px] items-center gap-1" title={project.config.workingDirectory}>
                    <span className="truncate font-mono text-[11px]">{project.config.workingDirectory.replace(/^\/Users\/[^/]+/, '~')}</span>
                  </span>
                ) : null}
                <span className={cn('tabular-nums', saveState === 'error' && 'text-destructive')} data-testid="project-save-state" aria-live="polite">
                  {saveState === 'saving' ? t('projectRoadmap.saving') : saveState === 'saved' ? t('projectRoadmap.saved') : saveState === 'error' ? t('projectRoadmap.saveFailed') : ''}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <TextButton onClick={() => void handleStartSession()}>
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden @[640px]:inline">{t('projectRoadmap.newSession')}</span>
              </TextButton>
              <TextButton tone="ghost" onClick={() => void exportToNote()} testId="project-export-note" title={t('projectRoadmap.exportHint')}>
                <FileDown className="h-3.5 w-3.5" />
                <span className="hidden @[640px]:inline">{t('projectRoadmap.export')}</span>
              </TextButton>
              <IconButton label={t('projectInfo.tabSettings')} onClick={() => {
                setSettingsOpen((v) => !v)
                requestAnimationFrame(() => document.getElementById('project-section-settings')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
              }}>
                <Settings2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>

          {roadmapCorrupt ? (
            <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive" role="alert">{t('projectRoadmap.corrupt')}</div>
          ) : null}

          <nav className="mt-3 flex min-w-0 flex-wrap items-center gap-0.5" aria-label={t('projectRoadmap.sectionsNav')}>
            {(['goal', 'milestones', 'requirements', 'okr', 'tasks', 'sessions', 'inputs'] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => document.getElementById(`project-section-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                className="h-6 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              >
                {id === 'okr' ? t('projectOkr.tab') : t(`projectRoadmap.nav.${id}`)}
              </button>
            ))}
          </nav>

          {!roadmapLoaded ? null : (
            <div className={cn('mt-4 grid min-w-0 gap-8', wide ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1')}>
              {main}
              {wide ? <div className="min-w-0">{side}</div> : null}
            </div>
          )}

          {/* Settings (moved from the old tab) */}
          <section id="project-section-settings" className="mt-8 min-w-0">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              className="flex h-7 items-center gap-1.5 rounded-md px-1 text-[13px] font-semibold text-foreground/80 hover:text-foreground"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t('projectInfo.tabSettings')}
            </button>
            {settingsOpen ? (
              <div className="mt-2 grid min-w-0 max-w-[720px] grid-cols-1 gap-4 rounded-lg bg-foreground/[0.025] p-3">
                <Field label={t('projectInfo.workingDirectory')}>
                  <div className="flex min-w-0 gap-2">
                    <Input value={editWorkingDir} onChange={(e) => setEditWorkingDir(e.target.value)} placeholder={t('projectInfo.workingDirectoryPlaceholder')} className="min-w-0 flex-1" />
                    <TextButton onClick={() => void handlePickWorkingDirectory()}>
                      <FolderOpen className="h-3.5 w-3.5" />
                      {t('projectInfo.workingDirectoryPicker')}
                    </TextButton>
                  </div>
                </Field>
                <Field label={t('projectInfo.icon')} hint={t('projectInfo.iconHint')}>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-foreground/[0.05] px-2.5 text-[12px] font-medium hover:bg-foreground/[0.09]">
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
                    {project.config.icon ? <TextButton tone="ghost" onClick={() => void handleClearIcon()}>{t('projectInfo.iconClear')}</TextButton> : null}
                  </div>
                </Field>
                <Field label={t('projectInfo.color')} hint={t('projectInfo.colorHint')}>
                  <InlineColorPickerRow
                    value={editColor}
                    onChange={setEditColor}
                    presets={PROJECT_COLOR_PALETTE}
                    onClear={() => setEditColor('')}
                    clearLabel={t('projectInfo.colorClear')}
                    customAriaLabel={t('projectInfo.colorCustom')}
                  />
                </Field>
                <Field label={t('projectInfo.details')} hint={t('projectInfo.detailsHelpText')}>
                  <Textarea value={editDetails} onChange={(e) => setEditDetails(e.target.value)} rows={5} placeholder={t('projectInfo.detailsPlaceholder')} />
                </Field>
                <div className="flex items-center justify-between">
                  <TextButton tone="danger" onClick={() => void handleDeleteProject()}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('projectInfo.deleteProject')}
                  </TextButton>
                  <TextButton tone="primary" onClick={() => void handleSaveSettings()} disabled={saving}>
                    {saving ? t('common.saving') : t('common.save')}
                  </TextButton>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </Info_Page>
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
    <div className="block min-w-0">
      <div className="mb-1 text-[12px] font-medium text-foreground/70">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[12px] text-muted-foreground">{hint}</div>}
    </div>
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
