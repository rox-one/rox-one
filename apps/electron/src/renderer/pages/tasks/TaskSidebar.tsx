import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive, CalendarBlank, CaretRight, Clipboard, Eye, Folder, Hourglass, Kanban, ListChecks,
  Play, Robot, SquaresFour, Stack, Sun, Tag, Trash, Tray, TreeStructure,
} from '@phosphor-icons/react'
import type { PhosphorIcon } from '@/platform/phosphor-glyphs'
import { NAV_CHILDREN_CLASS, NAV_ROW_ACTIVE_CLASS, NAV_ROW_CLASS, NAV_ROW_IDLE_CLASS } from '@/components/mode-screen/ModeScreen'
import { projectProgress, type PersonalTask, type TaskArea, type TaskFilterId, type TaskProject } from '@rox/core/tasks/personal'
import { handleSidebarTreeKeyDown } from '@/components/app-shell/sidebar-keyboard'
import { restoreFocusToToggle, SidebarDisclosureButton } from '@/components/app-shell/SidebarDisclosure'
import { cn } from '@/lib/utils'
import { ProgressPie } from './parts'
import type { AgentViewId, TasksView } from './task-model'

type IconTone = 'accent' | 'info' | 'warning' | 'success' | 'danger' | 'muted' | 'violet'
/** Cursor-like chrome: every glyph is muted grey; the tone only survives as data-tone. */
const ICON_TONE: Record<IconTone, string> = {
  accent: 'text-text-muted', info: 'text-text-muted', warning: 'text-text-muted',
  success: 'text-text-muted', danger: 'text-text-muted', muted: 'text-text-muted', violet: 'text-text-muted',
}

const LISTS = [
  { id: 'inbox', icon: Tray, tone: 'info', destination: 'list:inbox' },
  { id: 'today', icon: Sun, tone: 'warning', destination: 'when:today' },
  { id: 'upcoming', icon: CalendarBlank, tone: 'accent', destination: 'when:upcoming' },
  { id: 'anytime', icon: ListChecks, tone: 'success', destination: 'when:anytime' },
  { id: 'someday', icon: Hourglass, tone: 'violet', destination: 'when:someday' },
  { id: 'logbook', icon: Archive, tone: 'muted', destination: 'logbook' },
  { id: 'trash', icon: Trash, tone: 'danger', destination: 'trash' },
] as const

const AGENTS = [
  { id: 'board', icon: SquaresFour, tone: 'accent' },
  { id: 'running', icon: Play, tone: 'success' },
  { id: 'review', icon: Eye, tone: 'warning' },
  { id: 'conductor', icon: TreeStructure, tone: 'violet' },
] as const

function TaskSidebarItem({
  label, icon: Icon, tone, count, active, onClick, testId, progress,
}: {
  label: React.ReactNode
  icon: PhosphorIcon
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
        NAV_ROW_CLASS,
        active ? NAV_ROW_ACTIVE_CLASS : NAV_ROW_IDLE_CLASS,
      )}
    >
      <Icon data-tone={tone} className={cn('icon-inline', active ? 'text-foreground' : ICON_TONE[tone])} aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={typeof label === 'string' ? label : undefined}>{label}</span>
      {progress}
      {count != null && count > 0 ? <span className="shrink-0 text-caption numeric text-text-muted">{count}</span> : null}
    </button>
  )
}

/** Navigable areas use sibling navigation/disclosure controls, as Sessions does. */
function TaskSidebarGroup({
  title, icon: Icon, tone, children, navigation, expanded: controlledExpanded, onToggle,
}: {
  title: string
  icon: PhosphorIcon
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
    <div className="mt-2 first:mt-0" data-task-sidebar-group={title}>
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
          className={cn(NAV_ROW_CLASS, 'text-text-secondary hover:bg-[var(--state-hover)] hover:text-foreground')}
        >
          <Icon className={cn('icon-inline', ICON_TONE[tone])} aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
          <CaretRight className={cn('icon-status shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-90')} aria-hidden />
        </button>
      )}
      <div ref={bodyRef} id={sectionId} hidden={!expanded}>
        <div className={cn(NAV_CHILDREN_CLASS, 'pt-px')}>{children}</div>
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
          label={project.name} icon={Kanban} tone="info" count={progress.open}
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
      <h1 className="sr-only">{t('workbench.mode.tasks')}</h1>
      <TaskSidebarGroup title={t('tasks.nav.statuses')} icon={Clipboard} tone="accent">
        {LISTS.map(({ id, icon, tone, destination }) => (
          <div key={id} {...dropProps(destination)}>
            <TaskSidebarItem
              label={<span className="inline-flex items-center gap-1.5">
                {t(`tasks.projection.${id}`)}
                {id === 'today' && overdueCount ? <span className="text-caption font-medium text-destructive">{t('tasks.nav.overdue', { count: overdueCount })}</span> : null}
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
        <TaskSidebarGroup title={t('tasks.nav.projects')} icon={Kanban} tone="info">
          {personalProjects.filter(project => !project.areaId).map(projectItem)}
          {areas.map(area => {
            const projects = personalProjects.filter(project => project.areaId === area.id)
            const navigation = (
              <div {...dropProps(`area:${area.id}`)}>
                <TaskSidebarItem label={area.name} icon={Stack} tone="warning"
                  active={view.kind === 'area' && view.id === area.id}
                  onClick={() => onSelect({ kind: 'area', id: area.id })}
                  testId={`tasks-nav-area-${area.id}`} />
              </div>
            )
            return projects.length ? (
              <TaskSidebarGroup key={area.id} title={area.name} icon={Stack} tone="warning"
                navigation={navigation} expanded={!area.collapsed} onToggle={() => onToggleArea(area)}>
                {projects.map(projectItem)}
              </TaskSidebarGroup>
            ) : <React.Fragment key={area.id}>{navigation}</React.Fragment>
          })}
        </TaskSidebarGroup>
      ) : null}

      <TaskSidebarGroup title={t('tasks.nav.workspaceProjects')} icon={Folder} tone="success">
        <span className="sr-only">{t('tasks.filterProject')}</span>
        {workspaceProjects.length ? workspaceProjects.map(projectItem) : <div className="px-2 text-body text-text-muted">{t('tasks.nav.noProjects')}</div>}
      </TaskSidebarGroup>

      {tags.length ? (
        <TaskSidebarGroup title={t('tasks.tags')} icon={Tag} tone="violet">
          {tags.slice(0, 12).map(({ tag, count }) => (
            <TaskSidebarItem key={tag} label={`#${tag}`} icon={Tag} tone="violet" count={count}
              active={view.kind === 'tag' && view.id === tag} onClick={() => onSelect({ kind: 'tag', id: tag })}
              testId={`tasks-nav-tag-${tag}`} />
          ))}
        </TaskSidebarGroup>
      ) : null}

      <TaskSidebarGroup title={t('tasks.nav.agents')} icon={Robot} tone="accent">
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
