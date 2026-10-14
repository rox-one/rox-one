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
      className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1.5 text-xs numeric text-muted-foreground', className)}
    >
      <span className="inline-flex items-center gap-1.5" data-stat="turns">
        <Activity className="size-3.5" aria-hidden />
        {t('chat.stats.turnsSteps', { turns: stats.turns, steps: stats.steps })}
      </span>
      {stats.totalTokens != null && (
        <span className="inline-flex items-center gap-1.5" data-stat="tokens">
          <Database className="size-3.5" aria-hidden />
          {t('chat.stats.tokens', { tokens: formatCompactTokens(stats.totalTokens) })}
          {stats.cacheHitPercent != null && (
            <span data-stat="cache">{t('chat.stats.cacheHit', { percent: stats.cacheHitPercent })}</span>
          )}
        </span>
      )}
      {stats.totalTokens == null && stats.cacheHitPercent != null && (
        <span data-stat="cache">{t('chat.stats.cacheHit', { percent: stats.cacheHitPercent })}</span>
      )}
      {stats.contextPercent != null && (
        <span className="inline-flex items-center gap-1.5" data-stat="context" title={t('chat.stats.contextTitle')}>
          <ContextRing percent={stats.contextPercent} />
          {stats.contextPercent}%
        </span>
      )}
    </div>
  )
}
