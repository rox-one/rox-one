import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export const SESSION_VIEW_PURPOSES = [
  { id: 'plan', nameKey: 'sidebar.view.plan', purposeKey: 'sidebar.view.planPurpose' },
  { id: 'overview', nameKey: 'sidebar.view.overview', purposeKey: 'sidebar.view.overviewPurpose' },
  { id: 'process', nameKey: 'sidebar.view.process', purposeKey: 'sidebar.view.processPurpose' },
] as const

export function ViewPurposeList({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <ul className={cn('flex flex-col gap-2', className)} data-testid="view-purpose-list">
      {SESSION_VIEW_PURPOSES.map((view) => (
        <li key={view.id} data-view-purpose={view.id}>
          <p className="text-[13px] font-medium">{t(view.nameKey)}</p>
          <p className="text-[11px] text-muted-foreground">{t(view.purposeKey)}</p>
        </li>
      ))}
    </ul>
  )
}
