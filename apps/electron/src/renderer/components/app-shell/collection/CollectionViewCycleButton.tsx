import * as React from 'react'
import { ChevronDown, LayoutGrid, List, Table2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { useHotkeyLabel } from '@/actions/useHotkeyLabel'
import { cn } from '@/lib/utils'
import type { CollectionViewMode } from '../kanban/BoardListToggle'
import {
  COLLECTION_VIEW_ORDER,
  rememberCollectionView,
  resolveCycleTarget,
} from './collection-view-cycle'
import { CollectionMenuCheck } from './collection-menu-row'

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
  const nextHotkey = useHotkeyLabel('collection.viewNext')
  const prevHotkey = useHotkeyLabel('collection.viewPrev')
  const listHotkey = useHotkeyLabel('collection.viewList')
  const boardHotkey = useHotkeyLabel('collection.viewBoard')
  const tableHotkey = useHotkeyLabel('collection.viewTable')
  const modeHotkeys: Record<CollectionViewMode, string | null> = {
    list: listHotkey,
    board: boardHotkey,
    table: tableHotkey,
  }

  const applyMode = React.useCallback((mode: CollectionViewMode) => {
    if (mode !== value) rememberCollectionView(value)
    onChange(mode)
  }, [onChange, value])

  const nextLabel = t('collection.view.cycleNext', { mode: t(LABEL_KEY[next]) })
  const prevLabel = t('collection.view.cyclePrev', { mode: t(LABEL_KEY[prev]) })
  const title = [
    nextHotkey ? `${nextLabel} (${nextHotkey})` : nextLabel,
    prevHotkey ? `${prevLabel} (${prevHotkey})` : prevLabel,
  ].join(' · ')

  const buttonClass =
    'inline-flex h-7 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/3 hover:text-foreground data-[state=open]:bg-foreground/3 data-[state=open]:text-foreground'

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
      <div
        className={cn('inline-flex items-stretch rounded-[4px]', className)}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuOpen(true)
        }}
      >
        <button
          type="button"
          className={cn(buttonClass, 'w-7 rounded-l-[4px]')}
          aria-label={nextLabel}
          aria-keyshortcuts="Alt+V Alt+Shift+V"
          title={title}
          onClick={(event) => {
            applyMode(resolveCycleTarget(value, event.shiftKey ? 'prev' : 'next'))
          }}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(buttonClass, 'w-4 rounded-r-[4px]')}
            aria-label={`${t('collection.view.list')} / ${t('collection.view.board')} / ${t('collection.view.table')}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
      </div>
      <StyledDropdownMenuContent align="end" minWidth="min-w-44">
        {COLLECTION_VIEW_ORDER.map((mode) => {
          const ItemIcon = ICONS[mode]
          const current = mode === value
          const hotkey = modeHotkeys[mode]
          return (
            <StyledDropdownMenuItem
              key={mode}
              aria-current={current ? 'true' : undefined}
              onSelect={() => {
                applyMode(mode)
              }}
            >
              <CollectionMenuCheck selected={current} />
              <ItemIcon className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="flex-1">{t(LABEL_KEY[mode])}</span>
              {hotkey ? <DropdownMenuShortcut className="pl-3">{hotkey}</DropdownMenuShortcut> : null}
            </StyledDropdownMenuItem>
          )
        })}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
