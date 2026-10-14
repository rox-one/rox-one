import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { GlanceWidgetProps } from '../registry'
import { openExternalSafe } from '../open-external'

export default function BookmarksWidget({ config }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const links = Array.isArray(config.links) ? (config.links as { title: string; url: string }[]) : []
  if (links.length === 0) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  const grid = config.style === 'grid'
  return (
    <ul className={cn(grid ? 'grid gap-1' : 'flex flex-col gap-0.5')} style={grid ? { gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' } : undefined} data-glance-bookmarks="">
      {links.map((link, i) => (
        <li key={`${i}:${link.url}`} className="min-w-0">
          <a
            href={link.url}
            onClick={(e) => { e.preventDefault(); openExternalSafe(link.url) }}
            className={cn('flex min-w-0 flex-col rounded-[var(--radius-control)] px-2 py-1 hover:bg-surface-hover', grid && 'bg-surface-hover')}
            title={link.url}
          >
            <span className="truncate text-sm font-bold text-foreground">{link.title}</span>
            <span className="truncate text-xs text-muted-foreground">{hostOf(link.url)}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
