import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ListFilter } from 'lucide-react'
import type { CollectionFilters, SessionPriority } from '@craft-agent/shared/sessions/collection'
import type { SessionStatus } from '@/config/session-status-config'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { CollectionFilterChips } from './CollectionFilterChips'
import { activeFilterCount } from './collection-filter-count'
import { COLLECTION_POPOVER_SURFACE } from './collection-menu-surface'
import {
  CollectionMenuRadioRow,
  CollectionMenuRow,
  CollectionMenuSection,
} from './collection-menu-row'
import {
  applySlice,
  BUILTIN_SLICES,
  createSavedSlice,
  loadSavedSlices,
  matchingSliceId,
  persistSavedSlices,
  type CollectionSlice,
} from './collection-slices'

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
  const [saved, setSaved] = React.useState<CollectionSlice[]>(() => loadSavedSlices())
  const [saving, setSaving] = React.useState(false)
  const [name, setName] = React.useState('')
  const count = activeFilterCount(filters)
  const activeSlice = matchingSliceId(filters, saved)

  const changeFilters = (next: CollectionFilters) => {
    onFiltersChange(next)
    if (activeFilterCount(next) === 0) {
      setSaving(false)
      setName('')
      setOpen(false)
    }
  }

  const commitSave = () => {
    const trimmed = name.trim()
    if (!trimmed || count === 0) return
    const next = [...saved, createSavedSlice(trimmed, filters)]
    persistSavedSlices(next)
    setSaved(next)
    setName('')
    setSaving(false)
  }

  const removeSaved = (id: string) => {
    const next = saved.filter((slice) => slice.id !== id)
    persistSavedSlices(next)
    setSaved(next)
  }

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
        className={COLLECTION_POPOVER_SURFACE}
      >
        <CollectionMenuSection label={t('collection.slice.saved')}>
          {BUILTIN_SLICES.map((slice) => (
            <CollectionMenuRadioRow
              key={slice.id}
              selected={activeSlice === slice.id}
              label={t(slice.nameKey!)}
              onClick={() => changeFilters(applySlice(filters, slice))}
            />
          ))}
          {saved.map((slice) => (
            <CollectionMenuRow
              key={slice.id}
              selected={activeSlice === slice.id}
              label={slice.name ?? slice.id}
              onClick={() => changeFilters(applySlice(filters, slice))}
              trailing={
                <span
                  role="button"
                  tabIndex={0}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation()
                    removeSaved(slice.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      removeSaved(slice.id)
                    }
                  }}
                >
                  {t('collection.filter.clear')}
                </span>
              }
            />
          ))}
          {count > 0 && !saving && (
            <button
              type="button"
              className="mx-1 mt-0.5 h-7 rounded-[5px] px-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.055] hover:text-foreground"
              onClick={() => setSaving(true)}
            >
              {t('collection.slice.save')}
            </button>
          )}
          {saving && (
            <form
              className="mx-1 mt-0.5 flex gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                commitSave()
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('collection.slice.savePlaceholder')}
                className="h-7 min-w-0 flex-1 rounded-[5px] border border-border/50 bg-foreground/[0.03] px-2 text-[12px] outline-none placeholder:text-muted-foreground/70 focus:border-foreground/25"
              />
              <button
                type="submit"
                className="h-7 rounded-[5px] px-2 text-[11px] font-medium hover:bg-foreground/[0.055]"
              >
                {t('collection.slice.save')}
              </button>
            </form>
          )}
        </CollectionMenuSection>
        <div className="mx-1 my-1 h-px bg-foreground/8" />
        <CollectionFilterChips
          filters={filters}
          onFiltersChange={changeFilters}
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
