import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import { PremiumMenu } from '@craft-agent/ui'
import {
  COLLECTION_GROUP_BY_VALUES,
  type CollectionDisplay,
  type CollectionGroupBy,
} from '@craft-agent/shared/sessions/collection'
import { cn } from '@/lib/utils'

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
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const grouped = display.groupBy !== 'none'
  const groupTitle = `${t('collection.display.groupByLabel')}: ${t(GROUP_I18N[display.groupBy])}`

  const menuItems = COLLECTION_GROUP_BY_VALUES.map((value) => ({
    id: value,
    label: t(GROUP_I18N[value]),
  }))

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'header-icon-btn inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/3 hover:text-foreground data-[state=open]:bg-foreground/3 data-[state=open]:text-foreground',
          grouped && 'text-foreground',
          className,
        )}
        aria-label={groupTitle}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-state={open ? 'open' : 'closed'}
        title={groupTitle}
        onClick={() => setOpen((next) => !next)}
      >
        <Layers className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <PremiumMenu
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        items={menuItems}
        selectedId={display.groupBy}
        onSelect={(item) => {
          onDisplayChange({ ...display, version: 1, groupBy: item.id as CollectionGroupBy })
        }}
        variant="compact"
      />
    </>
  )
}
