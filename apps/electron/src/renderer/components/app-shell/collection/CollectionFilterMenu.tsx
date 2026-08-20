import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ListFilter } from 'lucide-react'
import type { CollectionFilters, SessionPriority } from '@craft-agent/shared/sessions/collection'
import type { SessionStatus } from '@/config/session-status-config'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { CollectionFilterChips } from './CollectionFilterChips'
import { activeFilterCount } from './collection-filter-count'

export interface CollectionFilterMenuProps {
  filters: CollectionFilters
  onFiltersChange: (next: CollectionFilters) => void
  statuses?: SessionStatus[]
  priorities?: SessionPriority[]
  projects?: Array<{ id: string; name: string }>
  labels?: Array<{ id: string; name: string }>
  className?: string
}

export function CollectionFilterMenu({
  filters,
  onFiltersChange,
  statuses,
  priorities,
  projects,
  labels,
  className,
}: CollectionFilterMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const count = activeFilterCount(filters)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'header-icon-btn relative inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/3 hover:text-foreground data-[state=open]:bg-foreground/3 data-[state=open]:text-foreground',
            count > 0 && 'text-foreground',
            className,
          )}
          aria-label={count > 0 ? `${t('collection.filter.trigger')} (${count})` : t('collection.filter.trigger')}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={t('collection.filter.trigger')}
        >
          <ListFilter className="h-3.5 w-3.5" strokeWidth={2} />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-foreground px-0.5 text-[9px] font-semibold text-background">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        role="dialog"
        aria-label={t('collection.filter.trigger')}
        className="w-64 max-h-[70vh] overflow-y-auto p-1"
      >
        <CollectionFilterChips
          filters={filters}
          onFiltersChange={onFiltersChange}
          statuses={statuses}
          priorities={priorities}
          projects={projects}
          labels={labels}
          layout="stacked"
        />
      </PopoverContent>
    </Popover>
  )
}
