import * as React from 'react'
import { Activity, Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { formatCompactTokens, type ComposerStats } from './composer-stats'

/** Small progress ring for context usage (0–100). */
function ContextRing({ percent }: { percent: number }) {
  const r = 5
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 -rotate-90" aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)} />
    </svg>
  )
}

/** One muted line under the composer: turns · steps, tokens, cache hit, context ring. */
export function ComposerStatsLine({ stats, className }: { stats: ComposerStats; className?: string }) {
  const { t } = useTranslation()
  if (stats.turns === 0) return null
  return (
    <div
      data-testid="composer-stats"
      role="group"
      aria-label={t('chat.stats.label')}
      className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1.5 text-xs numeric text-muted-foreground', className)}
    >
      <span className="inline-flex items-center gap-1.5" data-stat="turns">
        <Activity className="icon-caption" aria-hidden />
        {t('chat.stats.turns', { count: stats.turns })} {t('chat.stats.steps', { count: stats.steps })}
      </span>
      {stats.sessionTokens != null && (
        <span className="inline-flex items-center gap-1.5" data-stat="tokens">
          <Database className="icon-caption" aria-hidden />
          {t('chat.stats.sessionTokens', { tokens: formatCompactTokens(stats.sessionTokens) })}
          {stats.cacheHitPercent != null && (
            <span data-stat="cache">{t('chat.stats.cacheHit', { percent: stats.cacheHitPercent })}</span>
          )}
        </span>
      )}
      {stats.sessionTokens == null && stats.cacheHitPercent != null && (
        <span data-stat="cache">{t('chat.stats.cacheHit', { percent: stats.cacheHitPercent })}</span>
      )}
      {stats.contextPercent != null && (
        <span className="inline-flex items-center gap-1.5" data-stat="context" title={t('chat.stats.contextTitle')} aria-label={t('chat.stats.contextAria', { percent: stats.contextPercent })}>
          <ContextRing percent={stats.contextPercent} />
          <span aria-hidden>{stats.contextPercent}%</span>
        </span>
      )}
    </div>
  )
}
