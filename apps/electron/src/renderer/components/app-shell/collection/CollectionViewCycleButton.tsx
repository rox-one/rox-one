import { LayoutGrid, List, Table2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { CollectionViewMode } from '../kanban/BoardListToggle'
import { nextCollectionView, prevCollectionView } from './collection-view-cycle'

const ICONS = {
  list: List,
  board: LayoutGrid,
  table: Table2,
} as const

const LABEL_KEY: Record<CollectionViewMode, string> = {
  list: 'collection.view.list',
  board: 'collection.view.board',
  table: 'collection.view.table',
}

export interface CollectionViewCycleButtonProps {
  value: CollectionViewMode
  onChange: (mode: CollectionViewMode) => void
  className?: string
}

export function CollectionViewCycleButton({ value, onChange, className }: CollectionViewCycleButtonProps) {
  const { t } = useTranslation()
  const Icon = ICONS[value]
  const next = nextCollectionView(value)
  const prev = prevCollectionView(value)

  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-foreground/[0.02] text-foreground/70 transition-colors hover:bg-foreground/[0.05] hover:text-foreground',
        className,
      )}
      aria-label={t('collection.view.cycleNext', { mode: t(LABEL_KEY[next]) })}
      title={`${t('collection.view.cycleNext', { mode: t(LABEL_KEY[next]) })} · ${t('collection.view.cyclePrev', { mode: t(LABEL_KEY[prev]) })}`}
      onClick={(event) => {
        onChange(event.shiftKey ? prevCollectionView(value) : nextCollectionView(value))
      }}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  )
}
