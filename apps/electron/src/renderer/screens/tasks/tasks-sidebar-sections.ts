import type { SidebarSection, SidebarSectionItem } from '../sidebar-section'
import { nonEmptySections } from '../sidebar-section'

export const TASK_LISTS = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook', 'trash'] as const
export type TaskListId = (typeof TASK_LISTS)[number]
export const TASK_AGENT_VIEWS = ['board', 'running', 'review', 'conductor'] as const
export type TaskAgentViewId = (typeof TASK_AGENT_VIEWS)[number]

export interface TasksSidebarProject {
  id: string
  name: string
  open: number
  done: number
  total: number
}

export interface TasksSidebarInput {
  /** Count per list; null = list shows no counter (anytime/someday/logbook). */
  listCounts: Readonly<Partial<Record<TaskListId, number | null>>>
  overdue: number
  /** Personal projects without an area, then areas each with their projects. */
  looseProjects: readonly TasksSidebarProject[]
  /** Projects whose area no longer exists — listed under «Без области». */
  orphanProjects?: readonly TasksSidebarProject[]
  /** `collapsed` hides the area's projects (persisted on the area). */
  areas: readonly { id: string; name: string; collapsed?: boolean; projects: readonly TasksSidebarProject[] }[]
  workspaceProjects: readonly TasksSidebarProject[]
  tags: readonly { tag: string; count: number }[]
  agents: Readonly<Record<TaskAgentViewId, number>>
}

export type TasksViewKey = `list:${TaskListId}` | `project:${string}` | `area:${string}` | `tag:${string}` | `agents:${TaskAgentViewId}`

const LIST_ICONS: Record<TaskListId, string> = { inbox: 'inbox', today: 'sun', upcoming: 'calendar-days', anytime: 'list-checks', someday: 'hourglass', logbook: 'book-check', trash: 'trash' }
const AGENT_ICONS: Record<TaskAgentViewId, string> = { board: 'layout-dashboard', running: 'play', review: 'eye', conductor: 'network' }

function projectItem(p: TasksSidebarProject, area?: string): SidebarSectionItem {
  return {
    id: `project:${p.id}`,
    label: p.name,
    icon: 'folder-kanban',
    count: p.open || undefined,
    ...(area || p.total > 0 ? { secondary: [area, p.total > 0 ? `${p.done}/${p.total}` : ''].filter(Boolean).join(' · ') } : {}),
    target: { kind: 'view', viewId: `project:${p.id}` },
  }
}

/**
 * Задачи second sidebar (Things-style): Фокус (fixed lists with counts) →
 * Проекты (loose personal projects, areas followed by their projects, then
 * workspace projects) → Теги → Агенты.
 */
export function buildTasksSidebarSections(input: TasksSidebarInput): SidebarSection[] {
  const focus: SidebarSectionItem[] = TASK_LISTS.map((id) => {
    const n = input.listCounts[id]
    return {
      id: `list:${id}`,
      labelKey: `tasks.projection.${id}`,
      icon: LIST_ICONS[id],
      count: n ? n : undefined,
      ...(id === 'today' && input.overdue > 0 ? { badge: 'attention' as const } : {}),
      target: { kind: 'view', viewId: `list:${id}` },
    }
  })

  const projects: SidebarSectionItem[] = [...input.looseProjects.map((p) => projectItem(p))]
  for (const area of input.areas) {
    projects.push({
      id: `area:${area.id}`,
      label: area.name,
      icon: 'layers',
      ...(area.collapsed && area.projects.length ? { secondary: `▸ ${area.projects.length}` } : {}),
      ...(area.projects.length ? { menu: [{ id: 'toggle-area', labelKey: area.collapsed ? 'screens.tasks.expandArea' : 'screens.tasks.collapseArea' }] } : {}),
      target: { kind: 'view', viewId: `area:${area.id}` },
    })
    if (!area.collapsed) for (const p of area.projects) projects.push(projectItem(p, area.name))
  }
  const seen = new Set(projects.map((p) => p.id))
  for (const p of input.workspaceProjects) if (!seen.has(`project:${p.id}`)) projects.push({ ...projectItem(p), icon: 'folder-open' })

  const tags: SidebarSectionItem[] = input.tags.map(({ tag, count }) => ({
    id: `tag:${tag}`, label: `#${tag}`, icon: 'tag', count, target: { kind: 'view', viewId: `tag:${tag}` },
  }))

  const agents: SidebarSectionItem[] = TASK_AGENT_VIEWS.map((id) => ({
    id: `agents:${id}`, labelKey: `tasks.agents.${id}`, icon: AGENT_ICONS[id], count: input.agents[id] || undefined, target: { kind: 'view', viewId: `agents:${id}` },
  }))

  return nonEmptySections([
    { id: 'focus', titleKey: 'screens.tasks.groups.focus', items: focus, collapsible: false },
    { id: 'projects', titleKey: 'screens.tasks.groups.projects', items: projects, limit: 8, collapsible: true },
    { id: 'no-area', titleKey: 'screens.tasks.groups.noArea', items: (input.orphanProjects ?? []).map((p) => projectItem(p)), limit: 8, collapsible: true },
    { id: 'tags', titleKey: 'screens.tasks.groups.tags', items: tags, limit: 8, collapsible: true },
    { id: 'agents', titleKey: 'screens.tasks.groups.agents', items: agents, collapsible: true },
  ])
}

/** Parse a view key back into the Tasks page view union. */
export function parseTasksViewKey(key: string): { kind: 'list' | 'project' | 'area' | 'tag' | 'agents'; id: string } | null {
  const i = key.indexOf(':')
  if (i <= 0) return null
  const kind = key.slice(0, i)
  const id = key.slice(i + 1)
  if (!id) return null
  if (kind === 'list' && !(TASK_LISTS as readonly string[]).includes(id)) return null
  if (kind === 'agents' && !(TASK_AGENT_VIEWS as readonly string[]).includes(id)) return null
  if (kind === 'list' || kind === 'project' || kind === 'area' || kind === 'tag' || kind === 'agents') return { kind, id }
  return null
}

const LIST_DROP: Partial<Record<string, string>> = {
  'list:inbox': 'list:inbox', 'list:today': 'when:today', 'list:upcoming': 'when:upcoming',
  'list:anytime': 'when:anytime', 'list:someday': 'when:someday', 'list:logbook': 'logbook', 'list:trash': 'trash',
}

/** Move destination a task dropped on this sidebar row goes to (null = not a drop target). */
export function taskDropDestination(itemId: string): string | null {
  if (LIST_DROP[itemId]) return LIST_DROP[itemId]!
  if (itemId.startsWith('project:') || itemId.startsWith('area:')) return itemId
  return null
}
