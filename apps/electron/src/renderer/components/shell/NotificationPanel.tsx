/**
 * Notification panel (top50 #9) — the popover body behind the titlebar bell.
 *
 * Split out of `NotificationCenter.tsx` (boot-closure wave, 2026-10-15): the
 * bell, its badge and the sources subscription all run from the first frame,
 * but this panel exists only once someone opens it. A closed Radix Popover
 * renders nothing, so the module — its seven icons, the Intl relative-time
 * formatter and the row markup — has no business in index.html's preloaded
 * graph. `NotificationCenter` reaches it through `React.lazy` and only while
 * `open`; `lib/idle-preload.ts` warms the same dynamic import after first paint
 * so the first open waits for nothing.
 *
 * `apps/electron/src/renderer/boot-manifest.json` guards the built graph; the
 * source-level guard lives in `__tests__/boot-closure-notification-center.test.ts`.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Bot, CheckCheck, Hand, Trash2, Wallet, X, Zap, type LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui/tooltip'
import { PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/navigate'
import type { Route } from '@/lib/navigate'
import {
  clearNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removeNotification,
  type NotificationFilter,
  type NotificationKind,
  type ShellNotification,
} from './notifications'

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  agent: Bot,
  approval: Hand,
  error: AlertTriangle,
  automation: Zap,
  balance: Wallet,
}

function relativeTime(at: number, now: number, lang: string): string {
  const diff = Math.round((at - now) / 1000)
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  if (abs < 60) return rtf.format(diff, 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86_400), 'day')
}

export interface NotificationPanelProps {
  workspaceId?: string | null
  /** Scoped list from the eager store subscription (`useNotificationList`). */
  items: ShellNotification[]
  /** Unread count in scope, from the same subscription. */
  unread: number
  filter: NotificationFilter
  onFilterChange: (filter: NotificationFilter) => void
  /** Close the popover (a row with a route navigates and closes). */
  onClose: () => void
}

export function NotificationPanel({ workspaceId, items, unread, filter, onFilterChange, onClose }: NotificationPanelProps) {
  const { t, i18n } = useTranslation()
  const shown = filter === 'unread' ? items.filter((n) => !n.read) : items
  const now = Date.now()

  const activate = (n: ShellNotification) => {
    markNotificationRead(n.id)
    if (n.route) {
      onClose()
      navigate(n.route as Route)
    }
  }

  return (
    <PopoverContent align="end" className="w-[380px] p-0" aria-label={t('shell.notifications.title')} data-testid="notification-center">
      <div className="flex items-center gap-1 border-b border-border-subtle px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-body font-semibold">{t('shell.notifications.title')}</h2>
        <div role="radiogroup" aria-label={t('shell.notifications.filter')} className="flex rounded-[var(--radius-control)] bg-surface-hover p-0.5 text-caption">
          {(['all', 'unread'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={filter === id}
              onClick={() => onFilterChange(id)}
              className={cn('rounded-xs px-2 py-0.5', filter === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {t(id === 'all' ? 'shell.notifications.all' : 'shell.notifications.unreadFilter')}
            </button>
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('shell.notifications.markAll')}
              disabled={unread === 0}
              onClick={() => markAllNotificationsRead(workspaceId)}
              className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
            >
              <CheckCheck className="icon-caption" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('shell.notifications.markAll')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('shell.notifications.clear')}
              disabled={items.length === 0}
              onClick={() => clearNotifications(workspaceId)}
              className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
            >
              <Trash2 className="icon-caption" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('shell.notifications.clear')}</TooltipContent>
        </Tooltip>
      </div>
      <ul className="max-h-[min(60vh,480px)] overflow-y-auto p-1" aria-live="polite">
        {shown.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-muted-foreground" data-notification-empty="">
            {t(filter === 'unread' ? 'shell.notifications.emptyUnread' : 'shell.notifications.empty')}
          </li>
        )}
        {shown.map((n) => {
          const Icon = KIND_ICON[n.kind]
          return (
            <li key={n.id} className="group relative">
              <button
                type="button"
                onClick={() => activate(n)}
                data-notification-id={n.id}
                data-notification-kind={n.kind}
                className={cn('flex w-full items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 pr-8 text-left hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring', !n.read && 'bg-accent/5')}
              >
                <Icon className={cn('mt-0.5 icon-toolbar shrink-0', n.kind === 'error' ? 'text-destructive' : n.kind === 'approval' || n.kind === 'balance' ? 'text-status-warning' : 'text-muted-foreground')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-body', !n.read && 'font-medium')}>{n.title}</span>
                  {n.body && <span className="line-clamp-2 block text-small text-muted-foreground">{n.body}</span>}
                  <span className="block text-caption text-text-muted">{relativeTime(n.at, now, i18n.language)}</span>
                </span>
                {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label={t('shell.notifications.unreadDot')} />}
              </button>
              <button
                type="button"
                aria-label={t('shell.notifications.dismiss')}
                onClick={() => removeNotification(n.id)}
                className="absolute right-1 top-1.5 flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground opacity-0 hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="icon-caption" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </PopoverContent>
  )
}
