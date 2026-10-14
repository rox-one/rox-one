import * as React from 'react'
import { CirclePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * Full-width filled "New session" row with the shortcut hint at the right
 * (DeepSeek Harness layout). Rendered `hidden`; the Rox Graphite profile
 * (`html[data-ui-profile="graphite"] [data-sidebar-new-session]`) turns it on,
 * so other themes keep the compact + button in the Chats row.
 */
export function SidebarNewSessionButton({
  hotkey,
  onNewSession,
  className,
}: {
  hotkey?: string | null
  onNewSession: (openInNewPanel: boolean) => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div data-sidebar-new-session="" className={cn('hidden shrink-0 px-2 pb-1 pt-2', className)}>
      <button
        type="button"
        onClick={event => onNewSession(event.metaKey || event.ctrlKey)}
        aria-label={t('session.newSession')}
        className="relative flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--graphite-border-strong,var(--border-strong))] bg-[var(--graphite-fill,var(--surface-hover))] text-sm font-medium text-text-primary transition-colors hover:bg-[var(--graphite-fill-hover,var(--surface-pressed))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <CirclePlus className="size-4" aria-hidden />
        <span>{t('session.newSession')}</span>
        {hotkey && (
          <span className="absolute right-3 text-xs text-muted-foreground" aria-hidden>{hotkey}</span>
        )}
      </button>
    </div>
  )
}
