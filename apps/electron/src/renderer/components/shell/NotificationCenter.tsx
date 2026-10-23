/**
 * Titlebar bell (top50 #9).
 *
 * The bell, its unread badge and the notification sources subscription are
 * eager on purpose: the subscription keeps collecting while the panel is
 * closed. The panel itself is not — it sits behind `React.lazy` and is mounted
 * only while `open`, so its popover body, row markup and seven icons stay out
 * of index.html's preloaded graph (a closed Radix Popover renders nothing).
 * See `docs/perf/boot-closure-wave-2026-10-15.md`; `lib/idle-preload.ts` warms
 * the same chunk after first paint so the first open waits for nothing.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui/tooltip'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useNotificationList, type NotificationFilter } from './notifications'
import { useNotificationSources } from './notification-sources'
import { loadNotificationPanel } from './notification-panel-loader'

const NotificationPanel = React.lazy(() =>
  loadNotificationPanel().then((m) => ({ default: m.NotificationPanel })),
)

export function NotificationCenter({ workspaceId, className }: { workspaceId?: string | null; className?: string }) {
  const { t } = useTranslation()
  // Eager: the feeds keep running while the panel below is unmounted.
  useNotificationSources(workspaceId)
  const { items, unread } = useNotificationList(workspaceId)
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState<NotificationFilter>('all')
  const label = unread > 0 ? `${t('shell.notifications.title')} · ${t('shell.notifications.unread', { count: unread })}` : t('shell.notifications.title')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              aria-haspopup="dialog"
              data-notification-bell=""
              data-unread={unread || undefined}
              className={cn('titlebar-no-drag relative flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-text-secondary hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring', className)}
            >
              <Bell className="icon-toolbar" aria-hidden />
              {unread > 0 && (
                <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-destructive px-1 text-mark font-semibold leading-none text-white numeric">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('shell.notifications.title')}</TooltipContent>
      </Tooltip>
      {open && (
        <React.Suspense fallback={null}>
          <NotificationPanel
            workspaceId={workspaceId}
            items={items}
            unread={unread}
            filter={filter}
            onFilterChange={setFilter}
            onClose={() => setOpen(false)}
          />
        </React.Suspense>
      )}
    </Popover>
  )
}
