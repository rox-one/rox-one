/**
 * SettingsMenuSelect
 *
 * Menu-style dropdown select with support for option descriptions.
 * Uses Radix Popover for collision detection and accessibility.
 * Includes search/filter when options exceed threshold.
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { settingsUI } from './SettingsUIConstants'
import { useSettingsFieldDescription } from './SettingsFieldContext'
import { settingsMenuNavigationIndex, settingsMenuTypeaheadIndex } from './settings-menu-navigation'

export interface SettingsMenuSelectOption {
  /** Value for this option */
  value: string
  /** Display label */
  label: string
  /** Optional description/subtitle */
  description?: string
}

export interface SettingsMenuSelectProps {
  /** Currently selected value */
  value: string
  /** Change handler */
  onValueChange: (value: string) => void
  /** Available options */
  options: SettingsMenuSelectOption[]
  /** Placeholder when nothing selected */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className for trigger */
  className?: string
  /** Width of the dropdown menu */
  menuWidth?: number
  /** Called when hovering over an option (for live preview). Pass null on leave. */
  onHover?: (value: string | null) => void
  /** Enable search filter (auto-enabled when options > 8) */
  searchable?: boolean
  /** Placeholder for search input */
  searchPlaceholder?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/**
 * SettingsMenuSelect - Menu-style dropdown with descriptions
 *
 * Uses Radix Popover for automatic collision detection and positioning.
 * Trigger styled like the model selector in FreeFormInput.
 * Includes search filter when options exceed 8 or searchable prop is true.
 */
export function SettingsMenuSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  menuWidth = 280,
  onHover,
  searchable,
  searchPlaceholder,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: SettingsMenuSelectProps) {
  const { t } = useTranslation()
  const field = useSettingsFieldDescription()
  const id = React.useId()
  const listId = `${id}-options`
  const valueId = `${id}-value`
  const labelId = ariaLabelledBy ?? (ariaLabel ? undefined : field.labelId)
  const descriptionId = ariaDescribedBy ?? field.descriptionId
  const effectivePlaceholder = placeholder ?? t('common.select')
  const effectiveSearchPlaceholder = searchPlaceholder ?? t("common.search")
  const [isOpen, setIsOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [activeValue, setActiveValue] = React.useState(value)
  const typeaheadRef = React.useRef({ query: '', timestamp: 0 })

  const selectedOption = options.find((o) => o.value === value)

  // Show search when explicitly enabled or when there are many options
  const showSearch = searchable ?? options.length > 8

  // Filter options based on search query
  const filteredOptions = React.useMemo(() => {
    if (!searchQuery.trim()) return options
    const query = searchQuery.trim().toLocaleLowerCase()
    return options.filter(
      (option) =>
        option.label.toLocaleLowerCase().includes(query) ||
        option.value.toLocaleLowerCase().includes(query) ||
        option.description?.toLocaleLowerCase().includes(query)
    )
  }, [options, searchQuery])

  const activeIndex = filteredOptions.length === 0
    ? -1
    : Math.max(0, filteredOptions.findIndex((option) => option.value === activeValue))
  const activeId = activeIndex < 0 ? undefined : `${id}-option-${activeIndex}`

  React.useEffect(() => {
    if (!isOpen || activeIndex < 0) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, activeIndex, searchQuery])

  React.useEffect(() => {
    if (!disabled || !isOpen) return
    setIsOpen(false)
    setSearchQuery('')
    onHover?.(null)
  }, [disabled, isOpen, onHover])

  const activateOption = (index: number) => {
    const option = filteredOptions[index]
    if (!option) return
    setActiveValue(option.value)
    onHover?.(option.value)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || event.keyCode === 229) return
    const isSearchInput = event.target === searchInputRef.current
    // Home/End keep their native text-editing meaning in the search field.
    const next = isSearchInput && (event.key === 'Home' || event.key === 'End')
      ? null
      : settingsMenuNavigationIndex(event.key, activeIndex, filteredOptions.length)
    if (next !== null) {
      event.preventDefault()
      event.stopPropagation()
      activateOption(next)
    } else if (event.key === 'Enter' || (!isSearchInput && event.key === ' ')) {
      event.preventDefault()
      event.stopPropagation()
      const option = filteredOptions[activeIndex]
      if (option) handleSelect(option.value)
    } else if (!showSearch && event.key.length === 1) {
      event.preventDefault()
      event.stopPropagation()
      const now = Date.now()
      const query = now - typeaheadRef.current.timestamp > 700
        ? event.key
        : typeaheadRef.current.query + event.key
      typeaheadRef.current = { query, timestamp: now }
      const match = settingsMenuTypeaheadIndex(filteredOptions.map((option) => option.label), query, activeIndex)
      if (match !== null) {
        activateOption(match)
      }
    }
  }

  const handleSelect = (optionValue: string) => {
    if (disabled) return
    onValueChange(optionValue)
    setIsOpen(false)
    setSearchQuery('')
    // Clear preview on selection since the actual value is now set
    onHover?.(null)
  }

  // Clear preview when popover closes (via click outside, escape, etc.)
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    typeaheadRef.current = { query: '', timestamp: 0 }
    if (!open) {
      onHover?.(null)
      setSearchQuery('')
    } else {
      setActiveValue(selectedOption?.value ?? options[0]?.value ?? '')
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          data-slot="button"
          aria-label={ariaLabel}
          aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}
          aria-describedby={descriptionId}
          aria-haspopup="listbox"
          aria-controls={isOpen ? listId : undefined}
          onKeyDown={(event) => {
            if (!disabled && !event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault()
              event.stopPropagation()
              handleOpenChange(true)
            }
          }}
          className={cn(
            'inline-flex min-w-0 max-w-full items-center h-8 px-3 gap-1.5 text-[13px] rounded-md',
            'bg-surface-input text-text-primary shadow-minimal',
            settingsUI.interactive,
            'disabled:cursor-not-allowed disabled:opacity-50',
            isOpen && 'bg-surface-selected',
            className
          )}
        >
          <span id={valueId} className="truncate">{selectedOption?.label || (value ? value : effectivePlaceholder)}</span>
          <ChevronDown className="size-3.5 shrink-0 text-foreground/70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="flex max-h-(--radix-popover-content-available-height) flex-col p-1.5"
        role="presentation"
        style={{ width: menuWidth }}
        onMouseLeave={() => onHover?.(null)}
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (showSearch) searchInputRef.current?.focus()
          else listRef.current?.focus()
        }}
      >
        {showSearch && (
          <div className="relative mb-1.5 shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              data-slot="input"
              ref={searchInputRef}
              type="text"
              role="combobox"
              aria-label={effectiveSearchPlaceholder}
              aria-controls={listId}
              aria-expanded={isOpen}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setActiveValue('')
                onHover?.(null)
              }}
              placeholder={effectiveSearchPlaceholder}
              className={cn(
                'w-full h-8 pl-8 pr-3 text-sm rounded-md',
                'bg-surface-input text-text-primary border border-border-strong',
                'placeholder:text-text-muted',
                'focus-visible:outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/25'
              )}
            />
          </div>
        )}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={labelId ? undefined : (ariaLabel ?? effectivePlaceholder)}
          aria-labelledby={labelId}
          aria-activedescendant={showSearch ? undefined : activeId}
          tabIndex={showSearch ? -1 : 0}
          className="min-h-0 space-y-0.5 max-h-64 overflow-auto outline-none"
        >
          {filteredOptions.length === 0 ? (
            <div role="status" className="px-2.5 py-3 text-sm text-muted-foreground text-center">
              {t('common.noResults')}
            </div>
          ) : (
            filteredOptions.map((option, index) => {
              const isSelected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  data-slot="button"
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  data-active={index === activeIndex}
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => activateOption(index)}
                  onFocus={() => activateOption(index)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-left',
                    settingsUI.interactive,
                    isSelected && 'bg-surface-selected',
                    index === activeIndex && 'ring-1 ring-inset ring-focus/70'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className={settingsUI.label}>{option.label}</div>
                    {option.description && (
                      <div className={cn(settingsUI.descriptionSmall, settingsUI.labelDescriptionGap)}>
                        {option.description}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="size-4 text-foreground shrink-0 ml-3" />
                  )}
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * SettingsMenuSelectRow - Inline row with label and menu select
 */
export interface SettingsMenuSelectRowProps {
  /** Row label */
  label: string
  /** Optional description below label */
  description?: string
  /** Currently selected value */
  value: string
  /** Change handler */
  onValueChange: (value: string) => void
  /** Available options */
  options: SettingsMenuSelectOption[]
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
  /** Whether inside a card */
  inCard?: boolean
  /** Width of the dropdown menu */
  menuWidth?: number
  /** Called when hovering over an option (for live preview). Pass null on leave. */
  onHover?: (value: string | null) => void
  /** Enable search filter (auto-enabled when options > 8) */
  searchable?: boolean
  /** Placeholder for search input */
  searchPlaceholder?: string
}

export function SettingsMenuSelectRow({
  label,
  description,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  inCard = true,
  menuWidth = 280,
  onHover,
  searchable,
  searchPlaceholder,
}: SettingsMenuSelectRowProps) {
  const id = React.useId()
  const labelId = `${id}-label`
  const descriptionId = description ? `${id}-description` : undefined
  return (
    <div
      data-layout="settings-row"
      className={cn(
        settingsUI.row,
        inCard ? settingsUI.rowPadding : settingsUI.rowPaddingStandalone,
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <div id={labelId} className={settingsUI.label}>{label}</div>
        {description && (
          <p id={descriptionId} className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>
        )}
      </div>
      <div data-layout="settings-control" className={settingsUI.control}>
        <SettingsMenuSelect
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          value={value}
          onValueChange={onValueChange}
          options={options}
          placeholder={placeholder}
          disabled={disabled}
          menuWidth={menuWidth}
          onHover={onHover}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
        />
      </div>
    </div>
  )
}
