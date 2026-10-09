/**
 * EntityListEmptyScreen — Unified empty state for entity lists.
 *
 * Wraps the Empty primitives into a single configurable component
 * used by SessionList, SourcesListPanel, and SkillsListPanel.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from './empty'
import { getDocUrl, type DocFeature } from '@rox/shared/docs/doc-links'
import { cn } from '@/lib/utils'

export interface EntityListEmptyScreenProps {
  icon: React.ReactNode
  title: string
  description: string
  /** Auto-renders a "Learn more" button linking to this doc key */
  docKey?: DocFeature
  /** The single primary action of the empty state (e.g. "Создать источник"). */
  primaryAction?: React.ReactNode
  /** Extra action buttons rendered after "Learn more" */
  children?: React.ReactNode
  className?: string
}

export function EntityListEmptyScreen({
  icon,
  title,
  description,
  docKey,
  primaryAction,
  children,
  className = 'flex-1',
}: EntityListEmptyScreenProps) {
  const { t } = useTranslation()
  const hasActions = primaryAction || docKey || children

  return (
    <Empty className={cn('max-w-[60ch] mx-auto', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {icon}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {hasActions && (
        <EmptyContent>
          {primaryAction}
          {docKey && (
            <button
              onClick={() => window.electronAPI.openUrl(getDocUrl(docKey))}
              className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[var(--radius-control)] bg-foreground/[0.02] shadow-minimal hover:bg-foreground/[0.05] transition-colors duration-[var(--motion-fast)]"
            >
              {t("common.learnMore")}
            </button>
          )}
          {children}
        </EmptyContent>
      )}
    </Empty>
  )
}
