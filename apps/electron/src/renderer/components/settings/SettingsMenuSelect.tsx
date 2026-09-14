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
}: SettingsMenuSelectProps) {
  const { t } = useTranslation()
  const effectivePlaceholder = placeholder ?? t('common.select')
  const effectiveSearchPlaceholder = searchPlaceholder ?? t("common.search")
  const [isOpen, setIsOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  // Show search when explicitly enabled or when there are many options
  const showSearch = searchable ?? options.length > 8

  // Filter options based on search query
  const filteredOptions = React.useMemo(() => {
    if (!searchQuery.trim()) return options
    const query = searchQuery.toLowerCase()
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(query) ||
        option.value.toLowerCase().includes(query) ||
        option.description?.toLowerCase().includes(query)
    )
  }, [options, searchQuery])

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue)
    setIsOpen(false)
    setSearchQuery('')
    // Clear preview on selection since the actual value is now set
    onHover?.(null)
  }

  // Clear preview when popover closes (via click outside, escape, etc.)
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      onHover?.(null)
      setSearchQuery('')
    } else if (showSearch) {
      // Focus search input when opening
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          data-slot="button"
          className={cn(
            'inline-flex items-center h-8 px-3 gap-1.5 text-[13px] rounded-md',
            'bg-surface-input text-text-primary shadow-minimal',
            settingsUI.interactive,
            'disabled:cursor-not-allowed disabled:opacity-50',
            isOpen && 'bg-surface-selected',
            className
          )}
        >
          <span className="truncate">{selectedOption?.label || (value ? value : effectivePlaceholder)}</span>
          <ChevronDown className="size-3.5 shrink-0 text-foreground/70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="p-1.5"
        style={{ width: menuWidth }}
        onMouseLeave={() => onHover?.(null)}
      >
        {showSearch && (
          <div className="relative mb-1.5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              data-slot="input"
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
        <div className="space-y-0.5 max-h-64 overflow-auto">
          {filteredOptions.length === 0 ? (
            <div className="px-2.5 py-3 text-sm text-muted-foreground text-center">
              {t('common.noResults')}
            </div>
          ) : (
            filteredOptions.map((option) => {
              const isSelected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  data-slot="button"
                  aria-pressed={isSelected}
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => onHover?.(option.value)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-left',
                    settingsUI.interactive,
                    isSelected && 'bg-surface-selected'
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
        <div className={settingsUI.label}>{label}</div>
        {description && (
          <p className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>
        )}
      </div>
      <div data-layout="settings-control" className={settingsUI.control}>
        <SettingsMenuSelect
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
