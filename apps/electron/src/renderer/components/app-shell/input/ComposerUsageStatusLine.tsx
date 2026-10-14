import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipTrigger, TooltipContent } from '@rox/ui/tooltip'
import { cn } from '@/lib/utils'
import { runtimeTraceScopeKey, runtimeTraceSessionAtomFamily } from '@/atoms/runtime-trace'
import {
  projectContextBreakdown,
  projectContextPressure,
  projectTokenUsage,
  projectTurnOutline,
  runtimeProjectionEvents,
} from '@rox/core/runtime-trace/projector'
import { formatCompactTokens, type ComposerStats } from './composer-stats'

/**
 * DSH-P1 composer usage status line (native port of the DSH composer stats
 * row onto Rox's runtime-trace journal).
 *
 * One muted 11px row under the composer: turns · steps · ↑in ↓out ·
 * context% · ~$cost. Hover shows provider numbers (cache, ≈ breakdown, last
 * attempt); click dispatches a `trajectory.open` window event — a no-op-safe
 * hook until the P2 «Траектория» tab listens for it.
 *
 * Numbers are REAL provider-reported journal values only: a field no provider
 * reported renders as "—". Only the context breakdown is a labelled heuristic
 * (≈, density ported from DSH token-meter estimate.js); it never feeds totals.
 */

const DASH = '—'

export interface UsageStatusNumbers {
  turns: number
  steps: number
  /** Prompt-side total (uncached + cache traffic) over billed attempts. */
  input?: number
  output?: number
  costUsd?: number
  /** 0–100 prompt pressure vs. context window. */
  contextPercent?: number
  cacheRead?: number
  cacheWrite?: number
  breakdown?: { system: number; tools: number; messages: number }
  lastAttempt?: { model?: string; ttftMs?: number; output?: number; decodeMs?: number }
}

export function formatUsageCostBody(cost: number): string {
  return cost < 0.01 ? cost.toPrecision(1) : cost.toFixed(2)
}

export function formatUsageCost(cost: number): string {
  return `~$${formatUsageCostBody(cost)}`
}

function formatRate(output: number, decodeMs: number): string | undefined {
  if (!Number.isFinite(output) || !Number.isFinite(decodeMs) || decodeMs <= 0) return undefined
  const perSecond = output / (decodeMs / 1000)
  return `${perSecond >= 100 ? Math.round(perSecond) : perSecond.toFixed(1)} tok/s`
}

/** Pure row + tooltip content (no store access): unit-tested via static markup. */
export function UsageStatusLineView({ numbers, sessionId }: { numbers: UsageStatusNumbers; sessionId: string }) {
  const { t } = useTranslation()
  const turns = t('composer.usageStatus.turns', { count: numbers.turns })
  const steps = t('composer.usageStatus.steps', { count: numbers.steps })
  const input = numbers.input !== undefined ? formatCompactTokens(numbers.input) : DASH
  const output = numbers.output !== undefined ? formatCompactTokens(numbers.output) : DASH
  const context = numbers.contextPercent !== undefined
    ? t('composer.usageStatus.context', { percent: numbers.contextPercent })
    : t('composer.usageStatus.contextUnknown')
  const read = numbers.cacheRead !== undefined ? formatCompactTokens(numbers.cacheRead) : DASH
  const write = numbers.cacheWrite !== undefined ? formatCompactTokens(numbers.cacheWrite) : DASH
  const breakdown = numbers.breakdown
  const last = numbers.lastAttempt
  const rate = last && last.output !== undefined && last.decodeMs !== undefined
    ? formatRate(last.output, last.decodeMs)
    : undefined

  const openTrajectory = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('trajectory.open', { detail: { sessionId } }))
  }, [sessionId])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="usage-status-line"
          onClick={openTrajectory}
          aria-label={t('composer.usageStatus.openTrajectory')}
          title={t('composer.usageStatus.openTrajectory')}
          className={cn('flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 pt-1 text-[11px] leading-tight numeric text-muted-foreground')}
        >
          <span>
            {t('composer.usageStatus.line', { turns, steps, input, output, context })}
          </span>
          {numbers.costUsd !== undefined && (
            <span data-stat="cost">{t('composer.usageStatus.cost', { cost: formatUsageCostBody(numbers.costUsd) })}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <UsageStatusTooltipContent numbers={numbers} />
      </TooltipContent>
    </Tooltip>
  )
}

export function UsageStatusTooltipContent({ numbers }: { numbers: UsageStatusNumbers }) {
  const { t } = useTranslation()
  const read = numbers.cacheRead !== undefined ? formatCompactTokens(numbers.cacheRead) : DASH
  const write = numbers.cacheWrite !== undefined ? formatCompactTokens(numbers.cacheWrite) : DASH
  const last = numbers.lastAttempt
  const rate = last && last.output !== undefined && last.decodeMs !== undefined
    ? formatRate(last.output, last.decodeMs)
    : undefined
  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="usage-status-tooltip">
      <div>{t('composer.usageStatus.cache', { read, write })}</div>
      {numbers.breakdown && (
        <div>{t('composer.usageStatus.breakdown', {
          system: formatCompactTokens(numbers.breakdown.system),
          tools: formatCompactTokens(numbers.breakdown.tools),
          messages: formatCompactTokens(numbers.breakdown.messages),
        })}</div>
      )}
      {last && (
        <div>{t('composer.usageStatus.lastAttempt', {
          model: last.model ?? DASH,
          ttft: last.ttftMs !== undefined ? `${last.ttftMs} ms` : DASH,
          rate: rate ?? DASH,
        })}</div>
      )}
    </div>
  )
}

export interface ComposerUsageStatusLineProps {
  sessionId: string
  workspaceId?: string
  /** Message-derived fallback (turns/steps) while the journal has no step events yet. */
  stats?: ComposerStats | null
  tokenUsage?: { inputTokens?: number; outputTokens?: number; contextWindow?: number; costUsd?: number } | null
}

function positive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** Pure numbers fold (journal first, session fallbacks): unit-tested, no store access. */
export function computeUsageStatusNumbers(
  events: Parameters<typeof projectTurnOutline>[0],
  stats?: ComposerStats | null,
  tokenUsage?: ComposerUsageStatusLineProps['tokenUsage'],
): UsageStatusNumbers {
  const outline = projectTurnOutline(events)
  const usage = projectTokenUsage(events)
  const pressure = projectContextPressure(events)
  const breakdown = projectContextBreakdown(events)

  const inputParts = [usage.totals.uncachedInput, usage.totals.cacheRead, usage.totals.cacheWrite]
  const input = inputParts.some(part => part !== undefined)
    ? inputParts.reduce<number>((sum, part) => sum + (part ?? 0), 0)
    : undefined
  const window = pressure.contextWindow ?? (positive(tokenUsage?.contextWindow) ? tokenUsage!.contextWindow! : undefined)
  const fallbackInput = positive(tokenUsage?.inputTokens) ? tokenUsage!.inputTokens! : undefined
  const fallbackOutput = positive(tokenUsage?.outputTokens) ? tokenUsage!.outputTokens! : undefined
  const fallbackCost = typeof tokenUsage?.costUsd === 'number' && Number.isFinite(tokenUsage.costUsd) && tokenUsage.costUsd > 0
    ? tokenUsage.costUsd : undefined
  const contextPercent = pressure.percent
    ?? (fallbackInput !== undefined && window ? Math.min(100, Math.round((fallbackInput / window) * 100)) : undefined)

  return {
    // Journal runs and transcript messages overlap on new turns; the max
    // covers legacy sessions (journal empty) and mixed sessions honestly.
    turns: Math.max(outline.turnCount, stats?.turns ?? 0),
    steps: Math.max(outline.stepCount, stats?.steps ?? 0),
    ...(input !== undefined ? { input } : {}),
    ...(usage.totals.output ?? fallbackOutput !== undefined ? { output: usage.totals.output ?? fallbackOutput! } : {}),
    ...(usage.totals.costUsd ?? fallbackCost !== undefined ? { costUsd: usage.totals.costUsd ?? fallbackCost! } : {}),
    ...(contextPercent !== undefined ? { contextPercent } : {}),
    ...(usage.totals.cacheRead !== undefined ? { cacheRead: usage.totals.cacheRead } : {}),
    ...(usage.totals.cacheWrite !== undefined ? { cacheWrite: usage.totals.cacheWrite } : {}),
    ...(breakdown ? { breakdown: { system: breakdown.system, tools: breakdown.tools, messages: breakdown.messages } } : {}),
    ...(usage.attempts.length
      ? {
          lastAttempt: {
            ...(usage.attempts.at(-1)?.route?.model ?? usage.attempts.at(-1)?.route?.provider
              ? { model: usage.attempts.at(-1)?.route?.model ?? usage.attempts.at(-1)?.route?.provider }
              : {}),
            ...(usage.attempts.at(-1)?.ttftMs !== undefined ? { ttftMs: usage.attempts.at(-1)?.ttftMs } : {}),
            ...(usage.attempts.at(-1)?.usage.output !== undefined ? { output: usage.attempts.at(-1)?.usage.output } : {}),
            ...(usage.attempts.at(-1)?.decodeMs !== undefined ? { decodeMs: usage.attempts.at(-1)?.decodeMs } : {}),
          },
        }
      : {}),
  }
}

/** Live container: folds journal events from the shared runtime-trace atoms (no new IPC). */
export function ComposerUsageStatusLine({ sessionId, workspaceId, stats, tokenUsage }: ComposerUsageStatusLineProps) {
  const scopeKey = React.useMemo(
    () => runtimeTraceScopeKey({ workspaceId: workspaceId ?? '', sessionId }),
    [workspaceId, sessionId],
  )
  const trace = useAtomValue(runtimeTraceSessionAtomFamily(scopeKey))

  const numbers = React.useMemo<UsageStatusNumbers>(
    () => computeUsageStatusNumbers(Object.values(trace.projections).flatMap(runtimeProjectionEvents), stats, tokenUsage),
    [trace.projections, stats, tokenUsage],
  )

  return <UsageStatusLineView numbers={numbers} sessionId={sessionId} />
}
