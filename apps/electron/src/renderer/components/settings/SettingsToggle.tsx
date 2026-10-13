/**
 * SettingsToggle
 *
 * Toggle switch row with label and optional description.
 * Designed for use inside SettingsCard.
 */

import * as React from 'react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsToggleProps {
  /** Toggle label (string or JSX for custom rendering) */
  label: React.ReactNode
  /** Optional description below label */
  description?: string
  /** Current checked state */
  checked: boolean
  /** Change handler */
  onCheckedChange: (checked: boolean) => void
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
  /** Whether the toggle is inside a card (affects padding) */
  inCard?: boolean
}

/**
 * SettingsToggle - Toggle switch with label and description
 *
 * @example
 * <SettingsCard>
 *   <SettingsToggle
 *     label="Desktop notifications"
 *     description="Get notified when AI finishes working"
 *     checked={enabled}
 *     onCheckedChange={setEnabled}
 *   />
 * </SettingsCard>
 */
export function SettingsToggle({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
  inCard = true,
}: SettingsToggleProps) {
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
      <label
        htmlFor={id}
        className={cn(
          'flex-1 min-w-0 select-none',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <div id={labelId} className={cn(settingsUI.label, disabled && 'text-text-disabled')}>{label}</div>
        {description && (
          <div id={descriptionId} className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</div>
        )}
      </label>
      <Switch
        id={id}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        data-layout="settings-control"
        className="shrink-0"
      />
    </div>
  )
}
