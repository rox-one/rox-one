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
import { Info_Page } from '@/components/info'
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
} from '@craft-agent/core/rox2'
import type { PersonalTask } from '@craft-agent/core/tasks/personal'
import { PROJECT_COLOR_PALETTE } from '@/utils/project-colors'
import { InlineColorPickerRow } from '@/components/ui/inline-color-picker-row'
import type { LoadedProject, ProjectAsset } from '@craft-agent/shared/projects/types'
import {
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
} from '@craft-agent/shared/projects/roadmap'
import { applyProposalItem, type ProposalItemKey, type RoadmapProposal } from '@craft-agent/shared/projects/roadmap-ai'
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

  const containerRef = useRef<HTMLDivElement>(null)
  const roadmapRef = useRef<ProjectRoadmap>(roadmap)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedOnce = useRef(false)

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
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [workspaceId, loadProject, refreshAssets])

  // ── Roadmap load / debounced save ──
  useEffect(() => {
    if (!workspaceId || !projectSlug) return
    let cancelled = false
    void window.electronAPI.getProjectRoadmap(workspaceId, projectSlug).then((res) => {
      if (cancelled) return
      const next = normalizeRoadmap(res?.roadmap)
      roadmapRef.current = next
      setRoadmap(next)
      setRoadmapCorrupt(res?.corrupt === true)
      setRoadmapLoaded(true)
    }).catch((err) => {
      console.error('[ProjectInfoPage] Failed to load roadmap:', err)
      if (!cancelled) setRoadmapLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId, projectSlug])

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (!workspaceId) return
    const act = soupProjectActResult({ source: 'native', action: 'write', nativeId: projectSlug })
    if (!isClaimableLive(act)) return
    setSaveState('saving')
    try {
      await window.electronAPI.saveProjectRoadmap(workspaceId, projectSlug, roadmapRef.current)
      setRoadmapCorrupt(false)
      setSaveState('saved')
    } catch (err) {
      console.error('[ProjectInfoPage] Roadmap save failed:', err)
      setSaveState('error')
      toast.error(t('projectRoadmap.saveFailed'), { description: err instanceof Error ? err.message : undefined })
    }
  }, [workspaceId, projectSlug, t])

  const flushRef = useRef(flushSave)
  flushRef.current = flushSave
  useEffect(() => () => {
    if (saveTimer.current) void flushRef.current()
  }, [])

  const updateRoadmap = useCallback((mutate: (current: ProjectRoadmap) => ProjectRoadmap) => {
    const next = mutate(roadmapRef.current)
    roadmapRef.current = next
    setRoadmap(next)
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
    if (!workspaceId || !project) return
    const act = soupProjectActResult({
      source: 'native',
      action: 'write',
      nativeId: project.config.slug,
    })
    if (!isClaimableLive(act)) return
    try {
      await window.electronAPI.updateProject(workspaceId, project.config.slug, patch)
    } catch (err) {
      console.error('[ProjectInfoPage] Save failed:', err)
      toast.error(t('projectInfo.saveFailed'))
    }
  }, [workspaceId, project, t])

  const handleSaveSettings = useCallback(async () => {
    if (!project) return
    setSaving(true)
    try {
      await patchProject({
        workingDirectory: editWorkingDir.trim() || undefined,
        details: editDetails.trim() || undefined,
        color: editColor.trim() || undefined,
      })
      toast.success(t('projectInfo.saved'))
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
    // Flush pending edits so the server-side prompt sees the current roadmap.
    if (saveTimer.current) await flushRef.current()
    return window.electronAPI.runProjectRoadmapAi(workspaceId, projectSlug, {
      ...request,
      today,
      language: LANGUAGE_NAMES[baseLang] ?? 'Russian',
    })
  }, [workspaceId, projectSlug, today, baseLang])

  const acceptProposal = useCallback((proposal: RoadmapProposal, keys: ProposalItemKey[]) => {
    updateRoadmap((r) => keys.reduce((acc, key) => applyProposalItem(acc, proposal, key, today), r))
  }, [updateRoadmap, today])

  const improveField = useCallback(async (target: ImproveTarget) => {
    const before = target === 'goal' ? roadmapRef.current.goal : roadmapRef.current.expectedResult
    if (!before.trim()) return
    setImproving(target)
    try {
      const res = await runAi({ mode: 'improve', text: before })
      if (res.ok && res.mode === 'improve') setImprove({ target, before, after: res.text })
      else if (!res.ok) toast.error(t('projectRoadmap.ai.errorGeneric', { error: res.error }))
    } finally {
      setImproving(null)
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
    if (!workspaceId || !project) return
    try {
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
      const created = await window.electronAPI.createNote(workspaceId, t('projectRoadmap.noteTitle', { name: project.config.name }), `projects/${project.config.slug}`)
      await window.electronAPI.saveNote(workspaceId, created.id, markdown)
      toast.success(t('projectRoadmap.exported'), {
        action: { label: t('projectRoadmap.openNote'), onClick: () => navigate(routes.view.notes(created.id)) },
      })
    } catch (err) {
      toast.error(t('projectRoadmap.exportFailed'), { description: err instanceof Error ? err.message : undefined })
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
        projectId={project.config.id}
        roadmap={roadmap}
        status={aiStatus}
        runAi={runAi}
        onAccept={acceptProposal}
        improve={improve}
        onImproveDone={() => setImprove(null)}
        onApplyImprove={(p) => updateRoadmap((r) => (p.target === 'goal' ? { ...r, goal: p.after } : p.target === 'expectedResult' ? { ...r, expectedResult: p.after } : r))}
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
        title={t('projectRoadmap.tasks')}
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
          <TextButton type="submit" tone="ghost" testId="project-new-task" disabled={!newTaskTitle.trim()}>
            {t('projectInfo.newTaskButton')}
          </TextButton>
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
            {(['goal', 'milestones', 'requirements', 'tasks', 'sessions', 'inputs'] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => document.getElementById(`project-section-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                className="h-6 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              >
                {t(`projectRoadmap.nav.${id}`)}
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
