import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookCheck, CalendarDays, Eye, FolderKanban, FolderOpen, Hourglass, Inbox, Layers, LayoutDashboard,
  ListChecks, Network, Play, Plus, Sun, Tag, Trash2, type LucideIcon,
} from 'lucide-react'
import { useScreenSidebar, type ScreenSidebarConfig } from '@/components/shell/screen-sidebar'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'
import type { SidebarTarget } from '../sidebar-section'
import { buildTasksSidebarSections, parseTasksViewKey, taskDropDestination, type TasksSidebarInput } from './tasks-sidebar-sections'

const ICONS: Record<string, LucideIcon> = {
  inbox: Inbox, sun: Sun, 'calendar-days': CalendarDays, 'list-checks': ListChecks, hourglass: Hourglass, 'book-check': BookCheck, trash: Trash2,
  'folder-kanban': FolderKanban, 'folder-open': FolderOpen, layers: Layers, tag: Tag,
  'layout-dashboard': LayoutDashboard, play: Play, eye: Eye, network: Network,
}

export interface TasksScreenSidebarInput extends TasksSidebarInput {
  /** Current view as a key: `list:today`, `project:<id>`, … */
  activeViewKey: string
  onView(view: { kind: 'list' | 'project' | 'area' | 'tag' | 'agents'; id: string }): void
  onNewTask(): void
  search: string
  onSearch(value: string): void
  /** DataTransfer types of a dragged task. */
  dropTypes: readonly string[]
  /** A task was dropped on a row: apply the move destination. */
  onDropTask(destination: string, data: DataTransfer): void
  /** New project / area form (kept from the legacy navigator footer). */
  footer: ReactNode
}

/** Publishes the Задачи second sidebar from the page's live task store. */
export function useTasksScreenSidebar(input: TasksScreenSidebarInput): void {
  const { t } = useTranslation()
  const latest = useRef(input)
  latest.current = input
  const { listCounts, overdue, looseProjects, areas, workspaceProjects, tags, agents, activeViewKey, search, footer } = input

  // The page derives these arrays fresh every render (store snapshots); key the
  // build on their content so the published config only changes on real edits.
  // Serialising only when an input reference actually changed keeps typing in
  // unrelated fields from paying O(n) per render.
  const data = { listCounts, overdue, looseProjects, areas, workspaceProjects, tags, agents }
  const sigCache = useRef<{ refs: unknown[]; sig: string } | null>(null)
  const refs = [listCounts, overdue, looseProjects, areas, workspaceProjects, tags, agents]
  if (!sigCache.current || refs.some((r, i) => r !== sigCache.current!.refs[i])) {
    const sig = JSON.stringify(data)
    sigCache.current = { refs, sig }
  }
  const signature = sigCache.current.sig
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content signature
  const sections = useMemo(() => buildTasksSidebarSections(data), [signature])
  const dropTypesKey = input.dropTypes.join('|')
  const onTarget = useCallback((target: SidebarTarget) => {
    if (target.kind !== 'view') return
    const view = parseTasksViewKey(target.viewId)
    if (view) latest.current.onView(view)
  }, [])
  const onSearch = useCallback((v: string) => latest.current.onSearch(v), [])
  const onNewTask = useCallback(() => latest.current.onNewTask(), [])

  const config = useMemo<ScreenSidebarConfig>(() => ({
    screenId: 'tasks',
    title: t('workbench.mode.tasks'),
    primaryAction: { id: 'new-task', label: t('tasks.quickEntry.title'), icon: Plus, shortcut: '⌘N', onSelect: onNewTask },
    search: { placeholder: t('screens.tasks.search'), value: search, onChange: onSearch },
    groups: toScreenSidebarGroups(sections, { t, icons: ICONS, onTarget, activeKey: `view:${activeViewKey}` }).map((g) => ({
      ...g,
      items: g.items.map((item) => {
        const destination = taskDropDestination(item.id)
        return destination
          ? { ...item, drop: { accepts: dropTypesKey.split('|'), onDrop: (dt: DataTransfer) => latest.current.onDropTask(destination, dt), announce: t('screens.tasks.dropped', { target: item.label }) } }
          : item
      }),
    })),
    footer,
  }), [t, sections, onTarget, activeViewKey, search, onSearch, onNewTask, footer, dropTypesKey])

  useScreenSidebar(config)
}
