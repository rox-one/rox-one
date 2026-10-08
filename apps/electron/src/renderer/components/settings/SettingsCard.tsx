/**
 * SettingsCard
 *
 * Container card with muted background for grouping related settings.
 * Children are separated by internal dividers.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsCardProps {
  /** Card content */
  children: React.ReactNode
  /** Additional className */
  className?: string
  /** Whether to add internal dividers between children */
  divided?: boolean
}

/**
 * SettingsCard - Container for grouping related settings
 *
 * @example
 * <SettingsCard>
 *   <SettingsToggle label="Option 1" ... />
 *   <SettingsToggle label="Option 2" ... />
 * </SettingsCard>
 */
export function SettingsCard({ children, className, divided = true }: SettingsCardProps) {
  const childArray = React.Children.toArray(children).filter(Boolean)

  return (
    <div
      className={cn(
        settingsUI.card,
        className
      )}
    >
      {divided && childArray.length > 1
        ? childArray.map((child, index) => (
            <React.Fragment key={React.isValidElement(child) ? child.key : index}>
              {index > 0 && <div className="h-px bg-border-subtle mx-[var(--settings-row-x)]" />}
              {child}
            </React.Fragment>
          ))
        : children}
    </div>
  )
}

/**
 * SettingsCardContent - Inner padding wrapper for card content
 *
 * Use when you need custom content inside a SettingsCard
 */
export function SettingsCardContent({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn(settingsUI.rowPadding, className)}>{children}</div>
}

/**
 * SettingsCardFooter - Footer section with actions
 */
export function SettingsCardFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        settingsUI.rowPadding,
        'border-t border-border-subtle bg-surface-input flex flex-wrap items-center justify-end gap-2',
        className
      )}
    >
      {children}
    </div>
  )
}
