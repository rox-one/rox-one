import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import {
  COLLECTION_GROUP_BY_VALUES,
  type CollectionDisplay,
  type CollectionGroupBy,
} from '@craft-agent/shared/sessions/collection'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { CollectionMenuCheck } from './collection-menu-row'

const GROUP_I18N: Record<CollectionGroupBy, string> = {
  none: 'collection.display.groupBy.none',
  status: 'collection.display.groupBy.status',
  priority: 'collection.display.groupBy.priority',
  project: 'collection.display.groupBy.project',
  dueDate: 'collection.display.groupBy.dueDate',
  label: 'collection.display.groupBy.label',
}

export function CollectionGroupByMenu({
  display,
  onDisplayChange,
  className,
}: {
  display: CollectionDisplay
  onDisplayChange: (next: CollectionDisplay) => void
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const grouped = display.groupBy !== 'none'

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'header-icon-btn inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/3 hover:text-foreground data-[state=open]:bg-foreground/3 data-[state=open]:text-foreground',
            grouped && 'text-foreground',
            className,
          )}
          aria-label={t('collection.display.groupByLabel')}
          aria-haspopup="menu"
          aria-expanded={open}
          title={t('collection.display.groupByLabel')}
        >
          <Layers className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" minWidth="min-w-40">
        {COLLECTION_GROUP_BY_VALUES.map((value) => {
          const current = display.groupBy === value
          return (
            <StyledDropdownMenuItem
              key={value}
              aria-current={current ? 'true' : undefined}
              onSelect={() => onDisplayChange({ ...display, version: 1, groupBy: value })}
            >
              <CollectionMenuCheck selected={current} variant="radio" />
              <span className="flex-1">{t(GROUP_I18N[value])}</span>
            </StyledDropdownMenuItem>
          )
        })}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
