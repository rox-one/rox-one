/**
 * SettingsSegmentedControl
 *
 * Horizontal button group for selecting between options.
 * Ideal for theme selection, font selection, etc.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { settingsUI } from './SettingsUIConstants'
import { useSettingsFieldDescription } from './SettingsFieldContext'

export interface SettingsSegmentedOption<T extends string = string> {
  /** Value for this option */
  value: T
  /** Display label */
  label: string
  /** Optional icon */
  icon?: React.ReactNode
  disabled?: boolean
}

export interface SettingsSegmentedControlProps<T extends string = string> {
  /** Currently selected value */
  value: T
  /** Change handler */
  onValueChange: (value: T) => void
  /** Available options */
  options: SettingsSegmentedOption<T>[]
  /** Size variant */
  size?: 'sm' | 'md'
  /** Additional className */
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

/**
 * SettingsSegmentedControl - Horizontal button group
 *
 * @example
 * <SettingsSegmentedControl
 *   value={theme}
 *   onValueChange={setTheme}
 *   options={[
 *     { value: 'system', label: 'System', icon: <Monitor /> },
 *     { value: 'light', label: 'Light', icon: <Sun /> },
 *     { value: 'dark', label: 'Dark', icon: <Moon /> },
 *   ]}
 * />
 */
export function SettingsSegmentedControl<T extends string = string>({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SettingsSegmentedControlProps<T>) {
  const groupName = React.useId()
  const field = useSettingsFieldDescription()
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : field.labelId)}
      aria-describedby={field.descriptionId}
      className={cn('inline-flex flex-wrap gap-0.5 rounded-md bg-surface-input p-0.5', className)}
    >
      {options.map((option) => {
        const isSelected = option.value === value

        return (
          <label
            key={option.value}
            data-slot="button"
            className={cn(
              'relative flex min-w-0 items-center gap-1.5 rounded-[5px] transition-colors duration-[var(--motion-fast)]',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus has-[:focus-visible]:ring-offset-1',
              option.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              isSelected
                ? 'bg-surface-elevated shadow-minimal'
                : 'bg-transparent hover:bg-surface-hover'
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={isSelected}
              disabled={option.disabled}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />
            {option.icon && (
              <span
                aria-hidden="true"
                className={cn(
                  'w-4 h-4',
                  isSelected ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {option.icon}
              </span>
            )}
            <span
              className={cn(
                isSelected ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {option.label}
            </span>
          </label>
        )
      })}
    </div>
  )
}

/**
 * SettingsSegmentedControlCard - Card variant with individual backgrounds
 *
 * Each option is a small card (like Amie's app icon selector)
 */
export interface SettingsSegmentedCardOption<T extends string = string> {
  value: T
  label: string
  icon?: React.ReactNode
  disabled?: boolean
}

export interface SettingsSegmentedControlCardProps<T extends string = string> {
  value: T
  onValueChange: (value: T) => void
  options: SettingsSegmentedCardOption<T>[]
  /** Number of columns */
  columns?: 2 | 3 | 4
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

export function SettingsSegmentedControlCard<T extends string = string>({
  value,
  onValueChange,
  options,
  columns = 3,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SettingsSegmentedControlCardProps<T>) {
  const groupName = React.useId()
  const field = useSettingsFieldDescription()
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : field.labelId)}
      aria-describedby={field.descriptionId}
      className={cn(
        'grid gap-2',
        columns === 2 && 'grid-cols-2',
        columns === 3 && 'grid-cols-3',
        columns === 4 && 'grid-cols-4',
        className
      )}
    >
      {options.map((option) => {
        const isSelected = option.value === value

        return (
          <label
            key={option.value}
            data-slot="button"
            className={cn(
              'relative flex min-w-0 items-center gap-2 px-3 py-2.5 rounded-md text-left shadow-minimal',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-focus',
              option.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              settingsUI.interactive,
              isSelected ? 'bg-surface-selected' : 'bg-surface-input'
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={isSelected}
              disabled={option.disabled}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />
            {/* Radio indicator */}
            <div
              aria-hidden="true"
              className={cn(
                'w-[16px] h-[16px] rounded-full border-2 shrink-0',
                'flex items-center justify-center transition-colors',
                isSelected
                  ? 'border-foreground bg-foreground'
                  : 'border-muted-foreground/40'
              )}
            >
              {isSelected && (
                <div className="w-[6px] h-[6px] rounded-full bg-background" />
              )}
            </div>

            {/* Label */}
            <span className="text-sm">{option.label}</span>

            {/* Icon on right */}
            {option.icon && (
              <span aria-hidden="true" className="ml-auto shrink-0">{option.icon}</span>
            )}
          </label>
        )
      })}
    </div>
  )
}
