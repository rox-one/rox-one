/**
 * One titled group of the second sidebar (shell-layout). Renders the group
 * title (collapsible, persisted), its actions, rows with icon / badge /
 * secondary text / "⋯" menu, "Show more", and real loading / empty / error
 * states. In `icons` mode only row icons are shown, with tooltips.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, MoreHorizontal, Circle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { splitVisible, type SidebarAction, type SidebarGroup, type SidebarItem } from './screen-sidebar'

export type SidebarMode = 'expanded' | 'icons' | 'hidden'

type CollapsedMap = Record<string, boolean>

export function readCollapsedGroups(): CollapsedMap {
  const value = storage.get<CollapsedMap>(storage.KEYS.shellSidebarGroups, {})
  return value && typeof value === 'object' ? value : {}
}

/** Persisted collapse state for `${screenId}:${groupId}`. */
export function useGroupCollapsed(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = React.useState(() => readCollapsedGroups()[key] === true)
  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      const map = readCollapsedGroups()
      if (next) map[key] = true
      else delete map[key]
      storage.set(storage.KEYS.shellSidebarGroups, map)
      return next
    })
  }, [key])
  return [collapsed, toggle]
}

function ActionIconButton({ action }: { action: SidebarAction }) {
  const Icon = action.icon ?? Circle
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={action.label}
          disabled={action.disabled}
          data-tour={action.dataTour}
          onClick={(event) => { event.stopPropagation(); action.onSelect() }}
          className="inline-flex size-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <Icon className="icon-caption" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{action.shortcut ? `${action.label} ${action.shortcut}` : action.label}</TooltipContent>
    </Tooltip>
  )
}

export function SidebarActions({ actions, max = 3 }: { actions?: SidebarAction[]; max?: number }) {
  const { t } = useTranslation()
  if (!actions?.length) return null
  const shown = actions.slice(0, max)
  const rest = actions.slice(max)
  return (
    <div className="flex items-center gap-0.5">
      {shown.map((action) => <ActionIconButton key={action.id} action={action} />)}
      {rest.length > 0 && <ActionsMenu actions={rest} label={t('shell.sidebar.moreActions')} />}
    </div>
  )
}

function ActionsMenu({ actions, label, className }: { actions: SidebarAction[]; label: string; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
          className={cn('inline-flex size-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring', className)}
        >
          <MoreHorizontal className="icon-caption" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            disabled={action.disabled}
            onSelect={() => action.onSelect()}
            className={action.destructive ? 'text-destructive' : undefined}
          >
            {action.icon && <action.icon className="icon-caption" aria-hidden />}
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ItemGlyph({ item }: { item: SidebarItem }) {
  if (item.avatarUrl) return <img src={item.avatarUrl} alt="" className="icon-caption shrink-0 rounded-full object-cover" />
  const Icon = item.icon
  return Icon ? <Icon className="icon-caption shrink-0" aria-hidden /> : <span className="icon-caption shrink-0" aria-hidden />
}

function SidebarRow({ item, mode }: { item: SidebarItem; mode: Exclude<SidebarMode, 'hidden'> }) {
  const { t } = useTranslation()
  const base = cn(
    'relative flex w-full items-center gap-2 rounded-[var(--radius-control)] text-left text-body outline-none focus-visible:ring-1 focus-visible:ring-ring',
    item.active ? 'bg-[var(--state-selected)] text-foreground font-medium' : 'text-text-secondary hover:bg-[var(--state-hover)] hover:text-foreground',
  )
  if (mode === 'icons') {
    return (
      <li className="group/row">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={item.label}
              aria-current={item.active ? 'page' : undefined}
              data-tour={item.dataTour}
              data-sidebar-item={item.id}
              onClick={item.onSelect}
              className={cn(base, 'h-8 justify-center px-0')}
            >
              <ItemGlyph item={item} />
              {item.badge !== undefined && item.badge !== 0 && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" aria-hidden />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      </li>
    )
  }
  return (
    <li className="group/row relative">
      <button
        type="button"
        aria-current={item.active ? 'page' : undefined}
        data-tour={item.dataTour}
        data-sidebar-item={item.id}
        onClick={item.onSelect}
        className={cn(base, 'h-7 px-2', item.menu?.length && 'pr-8')}
      >
        <ItemGlyph item={item} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.secondary && <span className="shrink-0 text-caption text-muted-foreground group-hover/row:invisible">{item.secondary}</span>}
        {item.badge !== undefined && item.badge !== 0 && (
          <span className="shrink-0 rounded-full bg-accent/15 px-1.5 text-caption font-medium text-accent numeric" aria-label={t('shell.sidebar.badge', { value: String(item.badge) })}>
            {item.badge}
          </span>
        )}
      </button>
      {item.menu?.length ? (
        <ActionsMenu
          actions={item.menu}
          label={t('shell.sidebar.itemActions', { name: item.label })}
          className="absolute right-1 top-0.5 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
        />
      ) : null}
    </li>
  )
}

export interface SidebarSectionProps {
  screenId: string
  group: SidebarGroup
  mode: Exclude<SidebarMode, 'hidden'>
}

export const SidebarSection = React.memo(function SidebarSection({ screenId, group, mode }: SidebarSectionProps) {
  const { t } = useTranslation()
  const collapsible = group.collapsible ?? Boolean(group.title)
  const [collapsedRaw, toggleCollapsed] = useGroupCollapsed(`${screenId}:${group.id}`)
  const collapsed = collapsible && collapsedRaw
  const [showAll, setShowAll] = React.useState(false)
  const state = group.state ?? { kind: 'ready' as const }
  const headingId = `shell-group-${screenId}-${group.id}`

  // A ready group with no items renders nothing (no empty chrome).
  if (state.kind === 'ready' && group.items.length === 0) return null

  if (mode === 'icons') {
    if (state.kind !== 'ready') return null
    return (
      <section aria-label={group.title} data-sidebar-group={group.id} className="border-t border-border-subtle pt-1 first:border-t-0 first:pt-0">
        <ul className="flex flex-col gap-0.5">
          {group.items.map((item) => <SidebarRow key={item.id} item={item} mode="icons" />)}
        </ul>
      </section>
    )
  }

  const { visible, hiddenCount } = splitVisible(group.items, group.initialVisible, showAll)
  return (
    <section aria-labelledby={group.title ? headingId : undefined} data-sidebar-group={group.id} className="py-1">
      {group.title && (
        <div className="group/head flex h-7 items-center gap-1 pl-2 pr-1">
          <h3 id={headingId} className="min-w-0 flex-1">
            {collapsible ? (
              <button
                type="button"
                aria-expanded={!collapsed}
                onClick={toggleCollapsed}
                className="flex w-full items-center gap-1 truncate rounded-[var(--radius-control)] text-left text-caption font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className="truncate">{group.title}</span>
                <ChevronRight className={cn('icon-caption shrink-0 transition-transform motion-reduce:transition-none', !collapsed && 'rotate-90')} aria-hidden />
              </button>
            ) : (
              <span className="truncate text-caption font-semibold text-muted-foreground">{group.title}</span>
            )}
          </h3>
          <SidebarActions actions={group.actions} max={2} />
        </div>
      )}
      {!collapsed && (
        state.kind === 'loading' ? (
          <p role="status" className="flex items-center gap-2 px-2 py-1 text-caption text-muted-foreground" data-sidebar-group-state="loading">
            <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden />
            {t('shell.sidebar.loading')}
          </p>
        ) : state.kind === 'error' ? (
          <div role="alert" className="flex items-center gap-2 px-2 py-1 text-caption text-destructive" data-sidebar-group-state="error">
            <span className="min-w-0 flex-1 truncate">{state.label}</span>
            <button type="button" onClick={state.onRetry} className="shrink-0 rounded-[var(--radius-control)] px-1.5 text-foreground underline-offset-2 hover:underline focus-visible:ring-1 focus-visible:ring-ring">
              {t('shell.sidebar.retry')}
            </button>
          </div>
        ) : state.kind === 'empty' ? (
          <div className="flex items-center gap-2 px-2 py-1 text-caption text-muted-foreground" data-sidebar-group-state="empty">
            <span className="min-w-0 flex-1 truncate">{state.label}</span>
            {state.action && (
              <button type="button" onClick={state.action.onSelect} className="shrink-0 rounded-[var(--radius-control)] px-1.5 text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring">
                {state.action.label}
              </button>
            )}
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-0.5">
              {visible.map((item) => <SidebarRow key={item.id} item={item} mode="expanded" />)}
            </ul>
            {(hiddenCount > 0 || (showAll && splitVisible(group.items, group.initialVisible, false).hiddenCount > 0)) && (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="ml-2 mt-0.5 rounded-[var(--radius-control)] px-1.5 py-0.5 text-caption text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                data-sidebar-show-more=""
              >
                {showAll ? t('shell.sidebar.showLess') : t('shell.sidebar.showMore', { count: hiddenCount })}
              </button>
            )}
          </>
        )
      )}
    </section>
  )
})
