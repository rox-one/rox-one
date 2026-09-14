/**
 * Info_Page
 *
 * Compound page layout component for Info pages.
 * Handles loading, error, and empty states with consistent styling.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'
import { PanelHeader, type PanelHeaderProps } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'

export interface Info_PageProps {
  children: React.ReactNode
  /** Show loading spinner */
  loading?: boolean
  /** Show error state with message */
  error?: string
  /** Show empty state with message */
  empty?: string
  className?: string
}

export interface Info_PageHeaderProps extends Omit<PanelHeaderProps, 'className'> {
  className?: string
}

export interface Info_PageHeroProps {
  /** Avatar element */
  avatar: React.ReactNode
  /** Title displayed next to avatar */
  title?: string
  /** Tagline/description text below title */
  tagline?: string | null
  className?: string
}

export interface Info_PageContentProps {
  children: React.ReactNode
  className?: string
}

function Info_PageRoot({
  children,
  loading,
  error,
  empty,
  className,
}: Info_PageProps) {
  const { t } = useTranslation()
  // Extract header from children for consistent structure
  let header: React.ReactNode = null
  const otherChildren: React.ReactNode[] = []

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === Info_PageHeader) {
      header = child
    } else {
      otherChildren.push(child)
    }
  })

  // Loading state
  if (loading) {
    return (
      <div data-layout="info-page" className={cn('h-full min-h-0 flex flex-col bg-surface-document', className)}>
        {header}
        <div className="flex-1 flex items-center justify-center">
          <Spinner className="text-lg text-muted-foreground" />
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div data-layout="info-page" className={cn('h-full min-h-0 flex flex-col bg-surface-document', className)}>
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm font-medium">{t('common.errorLoadingContent')}</p>
          <p className="text-xs text-center max-w-md">{error}</p>
        </div>
      </div>
    )
  }

  // Empty state
  if (empty) {
    return (
      <div data-layout="info-page" className={cn('h-full min-h-0 flex flex-col bg-surface-document', className)}>
        {header}
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">{empty}</p>
        </div>
      </div>
    )
  }

  // Normal content
  return (
    <div data-layout="info-page" className={cn('h-full min-h-0 flex flex-col bg-surface-document', className)}>
      {header}
      {otherChildren}
    </div>
  )
}

function Info_PageHeader({ className, ...props }: Info_PageHeaderProps) {
  return <PanelHeader className={className} {...props} />
}

function Info_PageHero({ avatar, title, tagline, className }: Info_PageHeroProps) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <div className="h-8 w-8 shrink-0 mt-0.5 rounded-md ring-1 ring-border-subtle overflow-hidden">
        {avatar}
      </div>
      <div className="flex-1 min-w-0">
        {title && (
          <h2 className="text-[16px] font-semibold text-text-primary leading-snug">
            {title}
          </h2>
        )}
        {tagline && (
          <p className={cn('text-[13px] text-text-secondary leading-relaxed break-words', title ? 'mt-0.5' : 'mt-0')}>
            {tagline}
          </p>
        )}
      </div>
    </div>
  )
}

function Info_PageContent({ children, className }: Info_PageContentProps) {
  return (
    <div data-layout="info-content" className="relative flex-1 min-h-0">
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-[var(--page-content-max)] px-[var(--page-content-x)] py-[var(--page-content-y)]">
          <div className={cn('space-y-[var(--page-section-gap)]', className)}>{children}</div>
        </div>
      </ScrollArea>
    </div>
  )
}

export const Info_Page = Object.assign(Info_PageRoot, {
  Header: Info_PageHeader,
  Hero: Info_PageHero,
  Content: Info_PageContent,
})
