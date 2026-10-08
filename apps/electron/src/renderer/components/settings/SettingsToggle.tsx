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
        disabled && 'opacity-50',
        className
      )}
    >
      <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer select-none">
        <div id={labelId} className={settingsUI.label}>{label}</div>
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
