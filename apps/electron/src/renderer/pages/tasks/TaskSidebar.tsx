import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookCheck, Bot, CalendarDays, ChevronRight, ClipboardList, Eye, FolderKanban,
  FolderOpen, Hourglass, Inbox, Layers, LayoutDashboard, ListChecks, Network,
  Play, Sun, Tag, Tags, Trash2, type LucideIcon,
} from 'lucide-react'
import { projectProgress, type PersonalTask, type TaskArea, type TaskFilterId, type TaskProject } from '@rox/core/tasks/personal'
import { handleSidebarTreeKeyDown } from '@/components/app-shell/sidebar-keyboard'
import { restoreFocusToToggle, SidebarDisclosureButton } from '@/components/app-shell/SidebarDisclosure'
import { cn } from '@/lib/utils'
import { ProgressPie } from './parts'
import type { AgentViewId, TasksView } from './task-model'

type IconTone = 'accent' | 'info' | 'warning' | 'success' | 'danger' | 'muted' | 'violet'
const ICON_TONE: Record<IconTone, string> = {
  accent: 'text-accent', info: 'text-info', warning: 'text-[var(--warning,#d9a13b)]',
  success: 'text-success', danger: 'text-destructive', muted: 'text-text-muted', violet: 'text-violet-500',
}

const LISTS = [
  { id: 'inbox', icon: Inbox, tone: 'info', destination: 'list:inbox' },
  { id: 'today', icon: Sun, tone: 'warning', destination: 'when:today' },
  { id: 'upcoming', icon: CalendarDays, tone: 'accent', destination: 'when:upcoming' },
  { id: 'anytime', icon: ListChecks, tone: 'success', destination: 'when:anytime' },
  { id: 'someday', icon: Hourglass, tone: 'violet', destination: 'when:someday' },
  { id: 'logbook', icon: BookCheck, tone: 'muted', destination: 'logbook' },
  { id: 'trash', icon: Trash2, tone: 'danger', destination: 'trash' },
] as const

const AGENTS = [
  { id: 'board', icon: LayoutDashboard, tone: 'accent' },
  { id: 'running', icon: Play, tone: 'success' },
  { id: 'review', icon: Eye, tone: 'warning' },
  { id: 'conductor', icon: Network, tone: 'violet' },
] as const

function TaskSidebarItem({
  label, icon: Icon, tone, count, active, onClick, testId, progress,
}: {
  label: React.ReactNode
  icon: LucideIcon
  tone: IconTone
  count?: number | null
  active?: boolean
  onClick: () => void
  testId: string
  progress?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      className={cn(
        'flex min-h-8 w-full items-center gap-2 rounded-lg border-l-2 border-transparent px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
        active ? 'border-l-accent bg-accent/15 font-semibold text-foreground' : 'text-text-secondary hover:bg-foreground/[0.05] hover:text-foreground',
      )}
    >
      <span className={cn('grid size-5 shrink-0 place-items-center rounded-md bg-foreground/[0.05]', ICON_TONE[tone])}>
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {progress}
      {count != null && count > 0 ? <span className={cn('shrink-0 text-[11px] tabular-nums', active ? 'text-accent' : 'text-text-muted')}>{count}</span> : null}
    </button>
  )
}

/** Navigable areas use sibling navigation/disclosure controls, as Sessions does. */
function TaskSidebarGroup({
  title, icon: Icon, tone, children, navigation, expanded: controlledExpanded, onToggle,
}: {
  title: string
  icon: LucideIcon
  tone: IconTone
  children: React.ReactNode
  navigation?: React.ReactNode
  expanded?: boolean
  onToggle?: () => void
}) {
  const { t } = useTranslation()
  const [localExpanded, setLocalExpanded] = React.useState(true)
  const expanded = controlledExpanded ?? localExpanded
  const sectionId = `sidebar-section-tasks-${React.useId().replace(/:/g, '')}`
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const toggleRef = React.useRef<HTMLButtonElement>(null)
  const toggle = () => {
    if (expanded) restoreFocusToToggle(bodyRef.current, toggleRef.current)
    if (onToggle) onToggle()
    else setLocalExpanded(value => !value)
  }

  return (
    <div className="mt-2" data-task-sidebar-group={title}>
      {navigation ? (
        <div className="group/row flex items-center gap-1 pr-2">
          <div className="min-w-0 flex-1">{navigation}</div>
          <SidebarDisclosureButton ref={toggleRef} expanded={expanded} sectionId={sectionId} sectionTitle={title} onToggle={toggle} />
        </div>
      ) : (
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={sectionId}
          aria-label={t(expanded ? 'sidebar.disclosure.collapse' : 'sidebar.disclosure.expand', { section: title })}
          onClick={toggle}
          className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] font-medium text-text-secondary outline-none hover:bg-foreground/[0.05] focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon className={cn('size-4 shrink-0', ICON_TONE[tone])} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <ChevronRight className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-90')} aria-hidden />
        </button>
      )}
      <div ref={bodyRef} id={sectionId} hidden={!expanded}>
        <div className="ml-2 flex flex-col gap-0.5 border-l border-foreground/10 py-1 pl-2">{children}</div>
      </div>
    </div>
  )
}

export interface TaskSidebarProps {
  view: TasksView
  onSelect: (view: TasksView) => void
  listCount: (id: TaskFilterId) => number
  overdueCount: number
  trashCount: number
  tasks: readonly PersonalTask[]
  areas: readonly TaskArea[]
  personalProjects: readonly TaskProject[]
  workspaceProjects: readonly { id: string; name: string }[]
  tags: readonly { tag: string; count: number }[]
  agents: Record<AgentViewId, number>
  dropProps: (destination: string) => React.HTMLAttributes<HTMLDivElement>
  onToggleArea: (area: TaskArea) => void
  footer: React.ReactNode
}

export function TaskSidebar({
  view, onSelect, listCount, overdueCount, trashCount, tasks, areas, personalProjects,
  workspaceProjects, tags, agents, dropProps, onToggleArea, footer,
}: TaskSidebarProps) {
  const { t } = useTranslation()
  const projectItem = (project: { id: string; name: string }) => {
    const progress = projectProgress(tasks, project.id)
    return (
      <div key={project.id} {...dropProps(`project:${project.id}`)}>
        <TaskSidebarItem
          label={project.name} icon={FolderKanban} tone="info" count={progress.open}
          active={view.kind === 'project' && view.id === project.id}
          onClick={() => onSelect({ kind: 'project', id: project.id })}
          testId={`tasks-nav-project-${project.id}`}
          progress={<ProgressPie done={progress.done} total={progress.total} size={12} label={t('tasks.project.progress', { done: progress.done, total: progress.total })} />}
        />
      </div>
    )
  }

  return (
    <div data-task-sidebar="true" onKeyDown={handleSidebarTreeKeyDown} className="flex min-h-0 flex-1 flex-col">
      <h1 className="px-2 pb-2 text-[15px] font-semibold">{t('workbench.mode.tasks')}</h1>
      <TaskSidebarGroup title={t('tasks.nav.statuses')} icon={ClipboardList} tone="accent">
        {LISTS.map(({ id, icon, tone, destination }) => (
          <div key={id} {...dropProps(destination)}>
            <TaskSidebarItem
              label={<span className="inline-flex items-center gap-1.5">
                {t(`tasks.projection.${id}`)}
                {id === 'today' && overdueCount ? <span className="text-[11px] font-semibold text-destructive">{t('tasks.nav.overdue', { count: overdueCount })}</span> : null}
              </span>}
              icon={icon} tone={tone}
              count={id === 'trash' ? trashCount : id === 'inbox' || id === 'today' || id === 'upcoming' ? listCount(id) : null}
              active={view.kind === 'list' && view.id === id}
              onClick={() => onSelect({ kind: 'list', id })}
              testId={`tasks-nav-${id}`}
            />
          </div>
        ))}
      </TaskSidebarGroup>

      {areas.length || personalProjects.length ? (
        <TaskSidebarGroup title={t('tasks.nav.projects')} icon={FolderKanban} tone="info">
          {personalProjects.filter(project => !project.areaId).map(projectItem)}
          {areas.map(area => {
            const projects = personalProjects.filter(project => project.areaId === area.id)
            const navigation = (
              <div {...dropProps(`area:${area.id}`)}>
                <TaskSidebarItem label={area.name} icon={Layers} tone="warning"
                  active={view.kind === 'area' && view.id === area.id}
                  onClick={() => onSelect({ kind: 'area', id: area.id })}
                  testId={`tasks-nav-area-${area.id}`} />
              </div>
            )
            return projects.length ? (
              <TaskSidebarGroup key={area.id} title={area.name} icon={Layers} tone="warning"
                navigation={navigation} expanded={!area.collapsed} onToggle={() => onToggleArea(area)}>
                {projects.map(projectItem)}
              </TaskSidebarGroup>
            ) : <React.Fragment key={area.id}>{navigation}</React.Fragment>
          })}
        </TaskSidebarGroup>
      ) : null}

      <TaskSidebarGroup title={t('tasks.nav.workspaceProjects')} icon={FolderOpen} tone="success">
        <span className="sr-only">{t('tasks.filterProject')}</span>
        {workspaceProjects.length ? workspaceProjects.map(projectItem) : <div className="px-2 text-[12px] text-text-muted">{t('tasks.nav.noProjects')}</div>}
      </TaskSidebarGroup>

      {tags.length ? (
        <TaskSidebarGroup title={t('tasks.tags')} icon={Tags} tone="violet">
          {tags.slice(0, 12).map(({ tag, count }) => (
            <TaskSidebarItem key={tag} label={`#${tag}`} icon={Tag} tone="violet" count={count}
              active={view.kind === 'tag' && view.id === tag} onClick={() => onSelect({ kind: 'tag', id: tag })}
              testId={`tasks-nav-tag-${tag}`} />
          ))}
        </TaskSidebarGroup>
      ) : null}

      <TaskSidebarGroup title={t('tasks.nav.agents')} icon={Bot} tone="accent">
        {AGENTS.map(({ id, icon, tone }) => (
          <TaskSidebarItem key={id} label={t(`tasks.agents.${id}`)} icon={icon} tone={tone} count={agents[id]}
            active={view.kind === 'agents' && view.id === id} onClick={() => onSelect({ kind: 'agents', id })}
            testId={`tasks-nav-agents-${id}`} />
        ))}
      </TaskSidebarGroup>
      {footer}
    </div>
  )
}
