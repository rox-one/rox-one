/**
 * SettingsRadioGroup & SettingsRadioCard
 *
 * Full-width radio card selection pattern (Amie-style).
 * Each option is a separate card with radio indicator on the left.
 */

import * as React from 'react'
import { motion, AnimatePresence, useIsPresent, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { settingsUI } from './SettingsUIConstants'
import { useSettingsFieldDescription } from './SettingsFieldContext'

// ============================================
// Context
// ============================================

interface RadioGroupContextValue {
  name: string
  value: string
  onValueChange: (value: string) => void
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null)

function useRadioGroupContext() {
  return React.useContext(RadioGroupContext)
}

// ============================================
// SettingsRadioGroup
// ============================================

export interface SettingsRadioGroupProps<T extends string = string> {
  /** Currently selected value */
  value: T
  /** Change handler */
  onValueChange: (value: T) => void
  /** Radio cards */
  children: React.ReactNode
  /** Additional className */
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

/**
 * SettingsRadioGroup - Container for radio card options
 *
 * @example
 * <SettingsRadioGroup value={model} onValueChange={setModel}>
 *   <SettingsRadioCard value="opus" label="Opus 4.8" description="Most capable" />
 *   <SettingsRadioCard value="sonnet" label="Sonnet 4.6" description="Balanced" />
 * </SettingsRadioGroup>
 */
export function SettingsRadioGroup<T extends string = string>({
  value,
  onValueChange,
  children,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SettingsRadioGroupProps<T>) {
  const childArray = React.Children.toArray(children).filter(Boolean)
  const name = React.useId()
  const field = useSettingsFieldDescription()

  return (
    <RadioGroupContext.Provider
      value={{
        name,
        value,
        onValueChange: onValueChange as (value: string) => void,
      }}
    >
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : field.labelId)}
        aria-describedby={field.descriptionId}
        className={cn(
          settingsUI.card,
          className
        )}
      >
        {childArray.map((child, index) => (
          <React.Fragment key={React.isValidElement(child) ? child.key : index}>
            {index > 0 && <div className="h-px bg-border-subtle mx-[var(--settings-row-x)]" />}
            {child}
          </React.Fragment>
        ))}
      </div>
    </RadioGroupContext.Provider>
  )
}

// ============================================
// SettingsRadioCard
// ============================================

export interface SettingsRadioCardProps {
  /** Value for this option */
  value: string
  /** Option label */
  label: string
  /** Optional description below label */
  description?: string
  /** Optional icon on the right */
  icon?: React.ReactNode
  /** Optional badge (e.g., "Active", "Beta") */
  badge?: React.ReactNode
  /** Disabled state */
  disabled?: boolean
  /** Content to show when this option is selected */
  expandedContent?: React.ReactNode
  /** Additional className */
  className?: string
  /** Standalone mode: whether this option is selected (use instead of RadioGroup) */
  selected?: boolean
  /** Standalone mode: click handler (use instead of RadioGroup) */
  onClick?: () => void
  /** When true, disables card styling (use when inside a SettingsCard) */
  inCard?: boolean
}

/**
 * SettingsRadioCard - Full-width radio option card
 *
 * @example
 * <SettingsRadioCard
 *   value="api_key"
 *   label="API Key"
 *   description="Pay-as-you-go with your Anthropic key"
 *   expandedContent={<ApiKeyInput />}
 * />
 */
export function SettingsRadioCard({
  value,
  label,
  description,
  icon,
  badge,
  disabled,
  expandedContent,
  className,
  selected,
  onClick,
  inCard,
}: SettingsRadioCardProps) {
  const context = useRadioGroupContext()
  // Support both context-based and standalone usage
  const isSelected = context ? context.value === value : (selected ?? false)
  const id = React.useId()

  // Apply card styling only in standalone mode and not inside a SettingsCard
  const needsCardStyling = !context && !inCard

  return (
    <div
      className={cn(
        'overflow-hidden transition-colors',
        needsCardStyling && settingsUI.card,
        !disabled && settingsUI.interactive,
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <label
        className={cn(
          settingsUI.rowPadding,
          'relative min-h-[44px] w-full text-left flex items-start gap-3',
          'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-focus',
          !disabled && 'cursor-pointer'
        )}
      >
        <input
          id={id}
          type="radio"
          name={context?.name ?? id}
          value={value}
          checked={isSelected}
          disabled={disabled}
          onChange={() => context?.onValueChange(value)}
          onClick={context ? undefined : onClick}
          aria-labelledby={`${id}-label`}
          aria-describedby={description ? `${id}-description` : undefined}
          className="sr-only"
        />
        {/* Radio circle */}
        <div
          aria-hidden="true"
          className={cn(
            'w-4 h-4 rounded-full border-[1.5px] mt-[3px] shrink-0',
            'grid place-items-center transition-colors',
            isSelected
              ? 'border-foreground bg-foreground'
              : 'border-muted-foreground/40'
          )}
        >
          {isSelected && (
            <div className="w-2 h-2 rounded-full bg-background" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span id={`${id}-label`} className={settingsUI.label}>{label}</span>
            {badge}
          </div>
          {description && (
            <div id={`${id}-description`} className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>
              {description}
            </div>
          )}
        </div>

        {/* Right icon */}
        {icon && <div aria-hidden="true" className="shrink-0 ml-2">{icon}</div>}
      </label>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {isSelected && expandedContent && (
          <ExpandedRadioContent>{expandedContent}</ExpandedRadioContent>
        )}
      </AnimatePresence>
    </div>
  )
}

function ExpandedRadioContent({ children }: { children: React.ReactNode }) {
  const isPresent = useIsPresent()
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
      aria-hidden={!isPresent || undefined}
      {...(!isPresent ? { inert: '' } : {})}
      className="overflow-hidden"
    >
      <div className="px-[var(--settings-row-x)] pb-[var(--settings-row-y)] pt-0">
        <div className="pl-[30px]">{children}</div>
      </div>
    </motion.div>
  )
}

// ============================================
// SettingsRadioOption (Simpler inline variant)
// ============================================

export interface SettingsRadioOptionProps {
  /** Value for this option */
  value: string
  /** Option label */
  label: string
  /** Optional description (inline, after separator) */
  description?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
}

/**
 * SettingsRadioOption - Simple inline radio option (no card background)
 *
 * Use inside a SettingsCard for grouped options without individual backgrounds.
 */
export function SettingsRadioOption({
  value,
  label,
  description,
  disabled,
  className,
}: SettingsRadioOptionProps) {
  const context = useRadioGroupContext()
  if (!context) {
    throw new Error('SettingsRadioOption must be used within SettingsRadioGroup')
  }
  const { value: selectedValue, onValueChange } = context
  const isSelected = selectedValue === value
  const id = React.useId()

  return (
    <label
      className={cn(
        settingsUI.rowPadding,
        'relative min-h-[44px] w-full text-left flex items-center gap-3',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-focus',
        settingsUI.interactive,
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && 'cursor-pointer',
        className
      )}
    >
      <input
        id={id}
        type="radio"
        name={context.name}
        value={value}
        checked={isSelected}
        disabled={disabled}
        onChange={() => onValueChange(value)}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        className="sr-only"
      />
      {/* Radio circle */}
      <div
        aria-hidden="true"
        className={cn(
          'w-4 h-4 rounded-full border-[1.5px] shrink-0',
          'grid place-items-center transition-colors',
          isSelected
            ? 'border-foreground bg-foreground'
            : 'border-muted-foreground/40'
        )}
      >
        {isSelected && (
          <div className="w-2 h-2 rounded-full bg-background" />
        )}
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0 flex items-center">
        <span id={`${id}-label`} className="text-sm">{label}</span>
        {description && (
          <span id={`${id}-description`} className="text-sm text-muted-foreground ml-1.5">
            · {description}
          </span>
        )}
      </div>
    </label>
  )
}
