import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  formatDashboardCost,
  formatTokenCount,
  syncStatusLabelKey,
  type MiniDashboardSnapshot,
} from '@/platform/mini-dashboard'

interface MiniDashboardCardsProps {
  snapshot: MiniDashboardSnapshot
  className?: string
  /** `row`: one flat, borderless metrics row (Home). Default: card grid. */
  variant?: 'grid' | 'row'
}

export function MiniDashboardCards({ snapshot, className, variant = 'grid' }: MiniDashboardCardsProps) {
  const { t } = useTranslation()
  const unknown = t('dashboard.unknown')
  const tokensLabel =
    snapshot.tokens == null || snapshot.costUsd == null
      ? unknown
      : t('dashboard.tokensCostValue', {
          tokens: formatTokenCount(snapshot.tokens),
          cost: formatDashboardCost(snapshot.costUsd),
        })
  const tasksLabel = snapshot.tasks == null ? unknown : String(snapshot.tasks)

  const cards = [
    { key: 'sessions', label: t('dashboard.sessions'), value: String(snapshot.sessions) },
    { key: 'tokens', label: t('dashboard.tokensCost'), value: tokensLabel },
    { key: 'agents', label: t('dashboard.activeAgents'), value: String(snapshot.activeAgents) },
    { key: 'tasks', label: t('dashboard.tasks'), value: tasksLabel },
    { key: 'sync', label: t('dashboard.syncCloud'), value: t(syncStatusLabelKey(snapshot.sync)) },
  ] as const

  if (variant === 'row') {
    return (
      <div
        className={cn('flex flex-wrap items-baseline gap-x-6 gap-y-2', className)}
        data-mini-dashboard="row"
      >
        {cards.map((card) => (
          <div key={card.key} className="flex min-w-0 flex-col whitespace-nowrap" data-dashboard-card={card.key}>
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {card.label}
            </span>
            <span className="text-[13px] font-medium text-foreground">{card.value}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className={cn('grid grid-cols-2 gap-1.5', className)}
      data-mini-dashboard=""
    >
      {cards.map((card) => (
        <div key={card.key} className="rox-card px-2 py-1.5" data-dashboard-card={card.key}>
          <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {card.label}
          </div>
          <div className="truncate text-[13px] font-medium text-foreground">{card.value}</div>
        </div>
      ))}
    </div>
  )
}
