import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import { COLLECTION_GROUP_BY_VALUES,
COLLECTION_ORDER_BY_VALUES,
COLLECTION_PROPERTY_VALUES,
type CollectionDisplay,
type CollectionGroupBy,
type CollectionOrderBy,
type CollectionOrderDir,
type CollectionProperty, } from '@craft-agent/shared/sessions/collection'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  CollectionMenuDisclosure,
  CollectionMenuRadioRow,
  CollectionMenuRow,
  CollectionMenuSection,
} from './collection-menu-row'
import { COLLECTION_POPOVER_SURFACE } from './collection-menu-surface'

export interface CollectionDisplayPopoverProps {
  display: CollectionDisplay
  onDisplayChange: (next: CollectionDisplay) => void
  className?: string
  iconOnly?: boolean
}

const GROUP_I18N: Record<CollectionGroupBy, string> = {
  none: 'collection.display.groupBy.none',
  status: 'collection.display.groupBy.status',
  priority: 'collection.display.groupBy.priority',
  project: 'collection.display.groupBy.project',
  dueDate: 'collection.display.groupBy.dueDate',
  label: 'collection.display.groupBy.label',
}

const ORDER_I18N: Record<CollectionOrderBy, string> = {
  rank: 'collection.display.orderBy.rank',
  priority: 'collection.display.orderBy.priority',
  dueDate: 'collection.display.orderBy.dueDate',
  lastMessageAt: 'collection.display.orderBy.lastMessageAt',
  createdAt: 'collection.display.orderBy.createdAt',
  name: 'collection.display.orderBy.name',
}

const PROPERTY_I18N: Record<CollectionProperty, string> = {
  status: 'collection.display.property.status',
  priority: 'collection.display.property.priority',
  project: 'collection.display.property.project',
  labels: 'collection.display.property.labels',
  dueDate: 'collection.display.property.dueDate',
  model: 'collection.display.property.model',
  updated: 'collection.display.property.updated',
  created: 'collection.display.property.created',
  flag: 'collection.display.property.flag',
}

export function CollectionDisplayPopover({
  display,
  onDisplayChange,
  className,
  iconOnly = false,
}: CollectionDisplayPopoverProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const patch = React.useCallback(
    (partial: Partial<CollectionDisplay>) => {
      onDisplayChange({
        ...display,
        ...partial,
        version: 1,
        visibleProperties: partial.visibleProperties
          ? [...partial.visibleProperties]
          : [...display.visibleProperties],
      })
    },
    [display, onDisplayChange],
  )

  const toggleProperty = (prop: CollectionProperty) => {
    const set = new Set(display.visibleProperties)
    if (set.has(prop)) set.delete(prop)
    else set.add(prop)
    const next = COLLECTION_PROPERTY_VALUES.filter((p) => set.has(p))
    patch({ visibleProperties: [...next] })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'header-icon-btn inline-flex h-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/3 hover:text-foreground data-[state=open]:bg-foreground/3 data-[state=open]:text-foreground',
            iconOnly ? 'w-7' : 'gap-1.5 px-2 text-xs font-medium',
            className,
          )}
          aria-label={t('collection.display.trigger')}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={t('collection.display.trigger')}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
          {!iconOnly && t('collection.display.trigger')}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        role="dialog"
        aria-label={t('collection.display.trigger')}
        className={COLLECTION_POPOVER_SURFACE}
      >
        <CollectionMenuDisclosure
          label={t('collection.display.groupByLabel')}
          valueLabel={t(GROUP_I18N[display.groupBy])}
          defaultOpen
        >
          {COLLECTION_GROUP_BY_VALUES.map((value) => (
            <CollectionMenuRadioRow
              key={value}
              selected={display.groupBy === value}
              label={t(GROUP_I18N[value])}
              onClick={() => patch({ groupBy: value })}
            />
          ))}
        </CollectionMenuDisclosure>

        <CollectionMenuDisclosure
          label={t('collection.display.orderByLabel')}
          valueLabel={t(ORDER_I18N[display.orderBy])}
        >
          {COLLECTION_ORDER_BY_VALUES.map((value) => (
            <CollectionMenuRadioRow
              key={value}
              selected={display.orderBy === value}
              label={t(ORDER_I18N[value])}
              onClick={() => patch({ orderBy: value })}
            />
          ))}
          <div className="mx-2 mt-1 flex rounded-[6px] bg-foreground/[0.04] p-0.5">
            {(['asc', 'desc'] as CollectionOrderDir[]).map((dir) => {
              const active = display.orderDir === dir
              return (
                <button
                  key={dir}
                  type="button"
                  onClick={() => patch({ orderDir: dir })}
                  className={cn(
                    'h-6 flex-1 rounded-[4px] text-[11px] font-medium transition-colors',
                    active
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-foreground/55 hover:text-foreground',
                  )}
                >
                  {t(dir === 'asc' ? 'collection.display.orderDir.asc' : 'collection.display.orderDir.desc')}
                </button>
              )
            })}
          </div>
        </CollectionMenuDisclosure>

        <div className="mx-1 my-1 h-px bg-foreground/8" />

        <ToggleRow
          label={t('collection.display.showCompleted')}
          checked={display.showCompleted}
          onCheckedChange={(checked) => patch({ showCompleted: checked })}
        />
        <ToggleRow
          label={t('collection.display.showEmptyGroups')}
          checked={display.showEmptyGroups}
          onCheckedChange={(checked) => patch({ showEmptyGroups: checked })}
        />

        <CollectionMenuSection label={t('collection.display.propertiesLabel')}>
          {COLLECTION_PROPERTY_VALUES.map((prop) => (
            <CollectionMenuRow
              key={prop}
              selected={display.visibleProperties.includes(prop)}
              label={t(PROPERTY_I18N[prop])}
              onClick={() => toggleProperty(prop)}
            />
          ))}
        </CollectionMenuSection>

        <p className="px-2 pb-1.5 pt-1 text-[11px] leading-snug text-muted-foreground">
          {t('collection.display.boardHint')}
        </p>
      </PopoverContent>
    </Popover>
  )
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[4px] px-2 py-1.5 text-[12.5px] text-foreground/80 transition-colors hover:bg-foreground/[0.04] hover:text-foreground">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}
