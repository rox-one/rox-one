/**
 * SettingsInput
 *
 * Text input with label for settings pages.
 * Supports password type with show/hide toggle.
 */

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { settingsUI } from './SettingsUIConstants'
import { settingsDescriptionIds, useSettingsFieldDescription } from './SettingsFieldContext'

export interface SettingsInputProps {
  /** Input label */
  label?: string
  /** Optional description below label */
  description?: string
  /** Current value */
  value: string
  /** Change handler */
  onChange: (value: string) => void
  /** Placeholder text */
  placeholder?: string
  /** Input type */
  type?: 'text' | 'password' | 'email' | 'url'
  /** Disabled state */
  disabled?: boolean
  /** Error message */
  error?: string
  /** Action button next to input */
  action?: React.ReactNode
  /** Additional className */
  className?: string
  /** Whether inside a card */
  inCard?: boolean
  /** onBlur handler */
  onBlur?: () => void
  /** onKeyDown handler */
  onKeyDown?: (e: React.KeyboardEvent) => void
}

/**
 * SettingsInput - Text input with label
 *
 * @example
 * <SettingsInput
 *   label="Name"
 *   value={name}
 *   onChange={setName}
 *   placeholder="Enter your name..."
 * />
 */
export function SettingsInput({
  label,
  description,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  error,
  action,
  className,
  inCard = false,
  onBlur,
  onKeyDown,
}: SettingsInputProps) {
  const { t } = useTranslation()
  const field = useSettingsFieldDescription()
  const id = React.useId()
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined
  const [showPassword, setShowPassword] = React.useState(false)
  const isPassword = type === 'password'
  const inputType = isPassword && showPassword ? 'text' : type

  return (
    <div
      className={cn(
        'space-y-2',
        inCard && settingsUI.rowPadding,
        className
      )}
    >
      {(label || description) && (
        <div className={settingsUI.labelGroup}>
          {label && <Label htmlFor={id} className={settingsUI.label}>
            {label}
          </Label>}
          {description && (
            <p id={descriptionId} className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <div className={cn(
          settingsUI.fieldFrame,
          'flex-1',
          error && 'ring-1 ring-destructive'
        )}>
          <Input
            id={id}
            type={inputType}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            aria-labelledby={label ? undefined : field.labelId}
            aria-describedby={settingsDescriptionIds(descriptionId ?? field.descriptionId, errorId)}
            aria-invalid={error ? true : undefined}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            className={cn(
              'shadow-none',
              isPassword && 'pr-12'
            )}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              disabled={disabled}
              aria-label={t(showPassword ? 'settings.fields.hideValue' : 'settings.fields.showValue')}
              aria-controls={id}
              className="rox-control absolute right-1 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          )}
        </div>
        {action}
      </div>
      {error && <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

/**
 * SettingsInputRow - Inline input with label on left
 *
 * For settings where the input should be on the right side
 */
export interface SettingsInputRowProps {
  /** Row label */
  label: string
  /** Optional description below label */
  description?: string
  /** Current value */
  value: string
  /** Change handler */
  onChange: (value: string) => void
  /** Placeholder text */
  placeholder?: string
  /** Input type */
  type?: 'text' | 'password' | 'email' | 'url'
  /** Disabled state */
  disabled?: boolean
  /** Error message */
  error?: string
  /** Additional className */
  className?: string
  /** Whether inside a card */
  inCard?: boolean
}

export function SettingsInputRow({
  label,
  description,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  error,
  className,
  inCard = true,
}: SettingsInputRowProps) {
  const id = React.useId()
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined

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
        <Label htmlFor={id} className={settingsUI.label}>
          {label}
        </Label>
        {description && (
          <p id={descriptionId} className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>
        )}
        {error && <p id={errorId} role="alert" className={cn('text-sm text-destructive', settingsUI.labelDescriptionGap)}>{error}</p>}
      </div>
      <div data-layout="settings-control" className={cn(
        settingsUI.fieldFrame,
        'shrink-0',
        error && 'ring-1 ring-destructive'
      )}>
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={settingsDescriptionIds(descriptionId, errorId)}
          aria-invalid={error ? true : undefined}
          className="w-[200px] shadow-none"
        />
      </div>
    </div>
  )
}

/**
 * SettingsSecretInput - Password input with show/hide and optional validation
 *
 * Specialized for API keys, tokens, etc.
 */
export interface SettingsSecretInputProps {
  /** Input label */
  label?: string
  /** Optional description */
  description?: string
  /** Current value */
  value: string
  /** Change handler */
  onChange: (value: string) => void
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Error message */
  error?: string
  /** Additional className */
  className?: string
  /** Whether inside a card */
  inCard?: boolean
  /** onBlur handler */
  onBlur?: () => void
}

export function SettingsSecretInput({
  label,
  description,
  value,
  onChange,
  placeholder,
  disabled,
  error,
  className,
  inCard = false,
  onBlur,
}: SettingsSecretInputProps) {
  const { t } = useTranslation()
  const field = useSettingsFieldDescription()
  const id = React.useId()
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined
  const resolvedPlaceholder = placeholder ?? t('common.enterValue')
  const [showValue, setShowValue] = React.useState(false)

  return (
    <div
      className={cn(
        'space-y-2',
        inCard && settingsUI.rowPadding,
        className
      )}
    >
      {(label || description) && (
        <div className={settingsUI.labelGroup}>
          {label && <Label htmlFor={id} className={settingsUI.label}>
            {label}
          </Label>}
          {description && (
            <p id={descriptionId} className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>
          )}
        </div>
      )}
      <div className={cn(
        settingsUI.fieldFrame,
        error && 'ring-1 ring-destructive'
      )}>
        <Input
          id={id}
          type={showValue ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          aria-labelledby={label ? undefined : field.labelId}
          aria-describedby={settingsDescriptionIds(descriptionId ?? field.descriptionId, errorId)}
          aria-invalid={error ? true : undefined}
          onBlur={onBlur}
          className="pr-12 shadow-none"
        />
        <button
          type="button"
          onClick={() => setShowValue(!showValue)}
          disabled={disabled}
          aria-label={t(showValue ? 'settings.fields.hideValue' : 'settings.fields.showValue')}
          aria-controls={id}
          className="rox-control absolute right-1 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
        >
          {showValue ? (
            <EyeOff className="size-4" />
          ) : (
            <Eye className="size-4" />
          )}
        </button>
      </div>
      {error && <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
