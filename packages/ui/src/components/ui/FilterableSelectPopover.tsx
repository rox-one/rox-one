import * as React from 'react'
import { PremiumMenu, type PremiumMenuItemState } from './PremiumMenu'

export type FilterableSelectRenderState = PremiumMenuItemState

export interface FilterableSelectPopoverProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: React.RefObject<HTMLElement | null>
  items: T[]
  getKey: (item: T) => string
  getLabel: (item: T) => string
  isSelected: (item: T) => boolean
  onToggle: (item: T) => void
  renderItem?: (item: T, state: FilterableSelectRenderState, index: number) => React.ReactNode
  filterPlaceholder?: string
  emptyState?: React.ReactNode
  noResultsState?: React.ReactNode
  closeOnSelect?: boolean
  minWidth?: number
  maxWidth?: number
}

/**
 * Thin wrapper over {@link PremiumMenu} for existing skill/source pickers.
 * Keeps the historical API (onToggle, default closeOnSelect=false, opens above).
 */
export function FilterableSelectPopover<T>({
  open,
  onOpenChange,
  anchorRef,
  items,
  getKey,
  getLabel,
  isSelected,
  onToggle,
  renderItem,
  filterPlaceholder,
  emptyState,
  noResultsState,
  closeOnSelect = false,
  minWidth = 200,
  maxWidth = 320,
}: FilterableSelectPopoverProps<T>) {
  return (
    <PremiumMenu
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      items={items}
      getKey={getKey}
      getLabel={getLabel}
      isSelected={isSelected}
      onSelect={onToggle}
      renderItem={renderItem}
      searchable
      filterPlaceholder={filterPlaceholder}
      emptyState={emptyState}
      noResultsState={noResultsState}
      closeOnSelect={closeOnSelect}
      variant="regular"
      preferredSide="top"
      minWidth={minWidth}
      maxWidth={maxWidth}
    />
  )
}
