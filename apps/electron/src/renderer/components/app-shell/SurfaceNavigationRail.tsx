import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Brain, CalendarDays, FolderKanban, Inbox, ListTodo, MessageSquare, NotebookPen, Rss, Settings, Sparkles, Workflow, type LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { cn } from '@/lib/utils'
import {
  PRIMARY_SURFACE_IDS,
  SURFACE_RAIL_CONTROL_IDS,
  WORKSPACE_TOOL_IDS,
  resolveRailFocusTarget,
  type PrimarySurfaceId,
  type SurfaceRailControlId,
  type WorkspaceToolId,
} from './surface-navigation-model'

export type { PrimarySurfaceId, SurfaceRailControlId, WorkspaceToolId } from './surface-navigation-model'

export interface SurfaceNavigationRailProps {
  selectedSurface: PrimarySurfaceId | null
  onSelectSurface: (surface: PrimarySurfaceId) => void
  selectedTools: ReadonlySet<WorkspaceToolId> | readonly WorkspaceToolId[]
  onToggleTool: (tool: WorkspaceToolId) => void
  onSettings: () => void
  settingsSelected?: boolean
  compact?: boolean
  className?: string
}

const SURFACE_ICONS: Record<PrimarySurfaceId, LucideIcon> = {
  inbox: Inbox, feed: Rss, plan: CalendarDays, projects: FolderKanban,
  pages: NotebookPen, dialogues: MessageSquare, agents: Bot,
}
const TOOL_ICONS: Record<WorkspaceToolId, LucideIcon> = {
  tasks: ListTodo, automations: Workflow, memory: Brain, agent: Sparkles,
}

/** Surfaces change the main workspace. Tools add a panel while that surface stays open. */
export function SurfaceNavigationRail({
  selectedSurface, onSelectSurface, selectedTools, onToggleTool, onSettings,
  settingsSelected = false, compact = false, className,
}: SurfaceNavigationRailProps) {
  const { t } = useTranslation()
  const controls = useRef(new Map<SurfaceRailControlId, HTMLButtonElement>())
  const openedTools = new Set<WorkspaceToolId>(selectedTools)

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    const currentButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-rail-control]')
    const current = currentButton?.dataset.railControl as SurfaceRailControlId | undefined
    const visible = SURFACE_RAIL_CONTROL_IDS.filter(id => {
      const element = controls.current.get(id)
      return element && !element.disabled && !element.closest('[hidden], [inert]')
    })
    const target = resolveRailFocusTarget(visible, current ?? null, event.key)
    if (!target) return
    event.preventDefault()
    controls.current.get(target)?.focus()
  }

  const control = (id: SurfaceRailControlId, Icon: LucideIcon, label: string, active: boolean, onClick: () => void, tool = false) => (
    <Tooltip key={id}>
      <TooltipTrigger asChild>
        <button
          ref={element => { if (element) controls.current.set(id, element); else controls.current.delete(id) }}
          type="button"
          data-rail-control={id}
          data-testid={`surface-rail-${id}`}
          aria-label={label}
          aria-current={!tool && active ? 'page' : undefined}
          aria-pressed={tool ? active : undefined}
          aria-expanded={tool ? active : undefined}
          onClick={onClick}
          className={cn(
            'titlebar-no-drag relative mx-auto flex size-10 shrink-0 items-center justify-center rounded-lg outline-none transition-colors duration-150 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            active ? 'bg-accent/15 text-accent' : 'text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground',
          )}
        >
          {active && <span aria-hidden className="absolute -left-1 h-5 w-0.5 rounded-r bg-accent" />}
          <Icon className="size-[19px]" strokeWidth={1.75} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="max-w-64 font-sans">
        <span className="font-medium">{label}</span>
        {tool && <span className="mt-1 block text-xs text-muted-foreground">{t(`navigation.toolHelp.${id}`)}</span>}
      </TooltipContent>
    </Tooltip>
  )

  return (
    <nav
      aria-label={t('navigation.rail')}
      data-surface-navigation-rail
      data-compact={compact || undefined}
      onKeyDown={onKeyDown}
      className={cn('chrome-rail flex h-full min-h-0 shrink-0 flex-col border-r border-border/50 bg-[var(--surface-primary,var(--background))] px-1 py-2 font-sans', className)}
    >
      <div role="group" aria-label={t('navigation.surfaceGroup')} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pb-2">
        {PRIMARY_SURFACE_IDS.map(surface => control(surface, SURFACE_ICONS[surface], t(`navigation.surfaces.${surface}`), selectedSurface === surface && !settingsSelected, () => onSelectSurface(surface)))}
      </div>
      <div role="group" aria-label={t('navigation.toolGroup')} className="flex shrink-0 flex-col gap-1 border-t border-border/50 pt-2">
        {WORKSPACE_TOOL_IDS.map(tool => control(tool, TOOL_ICONS[tool], t(`navigation.tools.${tool}`), openedTools.has(tool), () => onToggleTool(tool), true))}
        <div className="mt-1 border-t border-border/50 pt-1">
          {control('settings', Settings, t('navigation.settings'), settingsSelected, onSettings)}
        </div>
      </div>
    </nav>
  )
}
