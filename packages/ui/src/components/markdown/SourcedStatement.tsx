import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { SourceCitationView } from '@craft-agent/core/research'
import { cn } from '../../lib/utils'

export interface SourcedStatementProps {
  source: SourceCitationView
  children: React.ReactNode
  className?: string
  /** A surrounding anchor owns the underline and keyboard stop. */
  withinLink?: boolean
}

export function SourcedStatement({ source, children, className, withinLink = false }: SourcedStatementProps) {
  const { t } = useTranslation()
  const dateLabel = source.publishedAt
    ? t('research.citation.published', { date: source.publishedAt })
    : t('research.citation.dateUnknown')
  const reliability = t(`research.citation.reliability.${source.reliability}`)

  return (
    <span
      className={cn('rox-sourced relative inline', className)}
      data-rox-source={source.url}
      data-rox-reliability={source.reliability}
      data-rox-contradiction={source.contradiction ? 'true' : 'false'}
      data-rox-primary={source.primary ? 'true' : 'false'}
    >
      <span
        className={withinLink ? undefined : 'cursor-help underline decoration-dotted decoration-foreground/45 underline-offset-[3px]'}
        tabIndex={withinLink ? undefined : 0}
        aria-label={withinLink ? undefined : t('research.citation.hoverAria', { title: source.title })}
      >
        {children}
      </span>
      <span role="tooltip" className="rox-sourced-card">
        <span className="block text-[12px] font-medium text-foreground">{source.title}</span>
        <span className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
          <span>{reliability}</span>
          <span>{dateLabel}</span>
          {source.primary ? <span>{t('research.citation.primary')}</span> : null}
          {source.contradiction ? (
            <span className="text-info">{t('research.citation.contradiction')}</span>
          ) : null}
        </span>
      </span>
    </span>
  )
}
