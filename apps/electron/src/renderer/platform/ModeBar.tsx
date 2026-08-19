/**
 * Mode Bar — static application modes (ADR-0001). Destinations live here
 * when top-chrome v2 is on; the activity rail then holds global actions.
 *
 * Modes with `rootRoute: null` render disabled with a tooltip. They are not
 * empty pages.
 */
import {
  BookOpen,
  Calendar,
  Home,
  Inbox,
  ListTodo,
  MessageSquare,
  MoreHorizontal,
  Rss,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isModeNavigable, listPinnedModes } from '@craft-agent/core/platform'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import type { Route } from '../../shared/routes'
import { getModeRegistry } from './mode-registry-bootstrap'
import { CORE_MODES } from './modes-seed'

const MODE_ICONS: Record<string, LucideIcon> = {
  BookOpen,
  Calendar,
  Home,
  Inbox,
  ListTodo,
  MessageSquare,
  Rss,
}

const seedById = new Map(CORE_MODES.map((mode) => [mode.contribution.id, mode]))

function ModeItem({
  id,
  icon,
  title,
  disabled,
  tooltip,
  active,
  onSelect,
}: {
  id: string
  icon: string
  title: string
  disabled: boolean
  tooltip: string
  active: boolean
  onSelect: () => void
}) {
  const Icon = MODE_ICONS[icon] ?? Inbox
  const button = (
    <button
      type="button"
      data-mode={id}
      aria-label={title}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onSelect}
      className={cn(
        'titlebar-no-drag flex h-[26px] items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors',
        disabled
          ? 'cursor-not-allowed text-muted-foreground/40'
          : active
            ? 'bg-accent/10 text-accent'
            : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[9rem] truncate">{title}</span>
    </button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function ModeBar() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const { pinned, overflow } = listPinnedModes(getModeRegistry().list())

  return (
    <nav aria-label={t('workbench.modes')} className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {pinned.map((mode) => {
        const seed = seedById.get(mode.id)
        const title = t(mode.titleKey)
        const disabled = !isModeNavigable(mode)
        const active = seed?.isActive(navState) ?? false
        return (
          <ModeItem
            key={mode.id}
            id={mode.id}
            icon={mode.icon}
            title={title}
            disabled={disabled}
            tooltip={disabled ? t('workbench.mode.unavailable') : title}
            active={active}
            onSelect={() => {
              if (mode.rootRoute) void navigate(mode.rootRoute as Route)
            }}
          />
        )
      })}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('workbench.mode.more')}
              className="titlebar-no-drag flex h-[26px] w-[26px] items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="start" minWidth="min-w-44">
            {overflow.map((mode) => {
              const disabled = !isModeNavigable(mode)
              return (
                <StyledDropdownMenuItem
                  key={mode.id}
                  disabled={disabled}
                  title={disabled ? t('workbench.mode.unavailable') : undefined}
                  onSelect={() => {
                    if (mode.rootRoute) void navigate(mode.rootRoute as Route)
                  }}
                >
                  {t(mode.titleKey)}
                </StyledDropdownMenuItem>
              )
            })}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  )
}
