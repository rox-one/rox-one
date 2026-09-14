/**
 * Info_Section
 *
 * Section container with title, optional description, and content card.
 * Matches SettingsSection styling pattern.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { settingsUI } from '@/components/settings/SettingsUIConstants'

export interface Info_SectionProps {
  /** Section title */
  title: string
  /** Optional description below title */
  description?: string
  /** Optional right-aligned header actions */
  actions?: React.ReactNode
  /** Section content */
  children: React.ReactNode
  className?: string
}

export function Info_Section({
  title,
  description,
  actions,
  children,
  className,
}: Info_SectionProps) {
  return (
    <section data-layout="info-section" className={cn(settingsUI.section, className)}>
      <div className={settingsUI.sectionHeader}>
        <div className="min-w-0 space-y-0.5">
          <h3 className={settingsUI.sectionTitle}>
            {title}
          </h3>
          {description && (
            <p className={settingsUI.description}>{description}</p>
          )}
        </div>
        {actions}
      </div>
      <div className={settingsUI.card}>
        {children}
      </div>
    </section>
  )
}
