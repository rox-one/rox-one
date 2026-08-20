import * as React from 'react'
import { ChevronDown, LayoutGrid, List, Table2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import type { CollectionViewMode } from '../kanban/BoardListToggle'
import {
  COLLECTION_VIEW_ORDER,
  rememberCollectionView,
  resolveCycleTarget,
} from './collection-view-cycle'

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
  const [menuOpen, setMenuOpen] = React.useState(false)
  const Icon = ICONS[value]
  const next = resolveCycleTarget(value, 'next')
  const prev = resolveCycleTarget(value, 'prev')

  const applyMode = (mode: CollectionViewMode) => {
    if (mode !== value) rememberCollectionView(value)
    onChange(mode)
  }

  const buttonClass = cn(
    'inline-flex h-7 items-center justify-center border border-border/60 bg-foreground/[0.02] text-foreground/70 transition-colors hover:bg-foreground/[0.05] hover:text-foreground',
  )

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
      <div
        className={cn('inline-flex items-stretch', className)}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuOpen(true)
        }}
      >
        <button
          type="button"
          className={cn(buttonClass, 'w-7 rounded-l-md border-r-0')}
          aria-label={t('collection.view.cycleNext', { mode: t(LABEL_KEY[next]) })}
          title={`${t('collection.view.cycleNext', { mode: t(LABEL_KEY[next]) })} · ${t('collection.view.cyclePrev', { mode: t(LABEL_KEY[prev]) })}`}
          onClick={(event) => {
            applyMode(resolveCycleTarget(value, event.shiftKey ? 'prev' : 'next'))
          }}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(buttonClass, 'w-5 rounded-r-md')}
            aria-label={`${t('collection.view.list')} / ${t('collection.view.board')} / ${t('collection.view.table')}`}
          >
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
      </div>
      <StyledDropdownMenuContent align="end" minWidth="min-w-36">
        {COLLECTION_VIEW_ORDER.map((mode) => {
          const ItemIcon = ICONS[mode]
          return (
            <StyledDropdownMenuItem
              key={mode}
              onSelect={() => {
                applyMode(mode)
              }}
            >
              <ItemIcon className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="flex-1">{t(LABEL_KEY[mode])}</span>
            </StyledDropdownMenuItem>
          )
        })}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
