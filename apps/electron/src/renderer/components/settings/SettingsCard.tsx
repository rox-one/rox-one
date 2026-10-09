/**
 * SettingsCard
 *
 * Container card with muted background for grouping related settings.
 * Children are separated by internal dividers.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
 * SettingsCardFooter - Footer section with actions.
 *
 * `saved` shows a transient "Сохранено" chip. The owning page toggles it for
 * `--motion-slow` (240 ms); the chip fades (no slide) and resolves to an
 * instant state under reduced motion via `--motion-slow: 0ms`.
 */
export function SettingsCardFooter({
  children,
  className,
  saved,
}: {
  children: React.ReactNode
  className?: string
  saved?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        settingsUI.rowPadding,
        'border-t border-border-subtle bg-surface-input flex flex-wrap items-center justify-end gap-2',
        className
      )}
    >
      {saved && (
        <span
          data-state="saved"
          role="status"
          className="mr-auto inline-flex items-center rounded-full bg-surface-hover px-2 py-0.5 text-small text-text-secondary transition-opacity duration-[var(--motion-slow)]"
        >
          {t('settings.saved')}
        </span>
      )}
      {children}
    </div>
  )
}
