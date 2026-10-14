import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@rox/ui/tooltip'
import { cn } from '@/lib/utils'
import { runtimeTraceScopeKey, runtimeTraceSessionAtomFamily } from '@/atoms/runtime-trace'
import type { RuntimeEvent } from '@rox/core/runtime-trace/types'
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

export interface UsageStatusSessionFallback {
  inputTokens?: number
  outputTokens?: number
  contextWindow?: number
  costUsd?: number
}

export function formatUsageCostBody(cost: number): string {
  return cost < 0.01 ? cost.toPrecision(1) : cost.toFixed(2)
}

function formatRate(output: number, decodeMs: number): string | undefined {
  if (!Number.isFinite(output) || !Number.isFinite(decodeMs) || decodeMs <= 0) return undefined
  const perSecond = output / (decodeMs / 1000)
  return `${perSecond >= 100 ? Math.round(perSecond) : perSecond.toFixed(1)} tok/s`
}

/**
 * Pure fold: journal attempts first, message stats and session tokenUsage as
 * fallback. Turns/steps merge with max (the journal only sees loaded runs).
 * Session inputTokens is the current prompt (shown via context%), so `input`
 * stays journal-only; output and cost fall back to the session totals.
 */
export function computeUsageStatusNumbers(
  events: readonly RuntimeEvent[],
  stats?: ComposerStats | null,
  tokenUsage?: UsageStatusSessionFallback | null,
): UsageStatusNumbers {
  const outline = projectTurnOutline(events)
  const usage = projectTokenUsage(events)
  const breakdown = projectContextBreakdown(events)

  const inputParts = [usage.totals.uncachedInput, usage.totals.cacheRead, usage.totals.cacheWrite]
  const input = inputParts.some(part => part !== undefined)
    ? inputParts.reduce<number>((sum, part) => sum + (part ?? 0), 0)
    : undefined

  const window = projectContextPressure(events).contextWindow
    ?? (typeof tokenUsage?.contextWindow === 'number' ? tokenUsage.contextWindow : undefined)
  // Pressure answers for the newest prompt: the last attempt that reported one.
  let lastPrompt: number | undefined
  for (let i = usage.attempts.length - 1; i >= 0; i--) {
    const attemptUsage = usage.attempts[i]!.usage
    const parts = [attemptUsage.uncachedInput, attemptUsage.cacheRead, attemptUsage.cacheWrite]
    if (parts.some(part => part !== undefined)) {
      lastPrompt = parts.reduce<number>((sum, part) => sum + (part ?? 0), 0)
      break
    }
  }
  const fallbackPrompt = typeof tokenUsage?.inputTokens === 'number' ? tokenUsage.inputTokens : undefined
  const promptForPressure = lastPrompt ?? (usage.attempts.length ? undefined : fallbackPrompt)
  const contextPercent = promptForPressure !== undefined && window
    ? Math.min(100, Math.round((promptForPressure / window) * 100))
    : undefined

  const last = usage.attempts.at(-1)
  return {
    turns: Math.max(outline.turnCount, stats?.turns ?? 0),
    steps: Math.max(outline.stepCount, stats?.steps ?? 0),
    ...(input !== undefined ? { input } : {}),
    ...((usage.totals.output ?? tokenUsage?.outputTokens) !== undefined
      ? { output: usage.totals.output ?? tokenUsage?.outputTokens }
      : {}),
    ...((usage.totals.costUsd ?? tokenUsage?.costUsd) !== undefined
      ? { costUsd: usage.totals.costUsd ?? tokenUsage?.costUsd }
      : {}),
    ...(contextPercent !== undefined ? { contextPercent } : {}),
    ...(usage.totals.cacheRead !== undefined ? { cacheRead: usage.totals.cacheRead } : {}),
    ...(usage.totals.cacheWrite !== undefined ? { cacheWrite: usage.totals.cacheWrite } : {}),
    ...(breakdown ? { breakdown: { system: breakdown.system, tools: breakdown.tools, messages: breakdown.messages } } : {}),
    ...(last
      ? {
          lastAttempt: {
            ...(last.route?.model ?? last.route?.provider ? { model: last.route?.model ?? last.route?.provider } : {}),
            ...(last.ttftMs !== undefined ? { ttftMs: last.ttftMs } : {}),
            ...(last.usage.output !== undefined ? { output: last.usage.output } : {}),
            ...(last.decodeMs !== undefined ? { decodeMs: last.decodeMs } : {}),
          },
        }
      : {}),
  }
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
  const openTrajectory = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('trajectory.open', { detail: { sessionId } }))
  }, [sessionId])

  return (
    <TooltipProvider>
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
    </TooltipProvider>
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
  tokenUsage?: UsageStatusSessionFallback | null
}

/** Live container: folds journal events from the shared runtime-trace atoms (no new IPC). */
export function ComposerUsageStatusLine({ sessionId, workspaceId, stats, tokenUsage }: ComposerUsageStatusLineProps) {
  const scopeKey = React.useMemo(
    () => runtimeTraceScopeKey({ workspaceId: workspaceId ?? '', sessionId }),
    [workspaceId, sessionId],
  )
  const trace = useAtomValue(runtimeTraceSessionAtomFamily(scopeKey))

  const numbers = React.useMemo<UsageStatusNumbers>(() => {
    const events = Object.values(trace.projections).flatMap(runtimeProjectionEvents)
    return computeUsageStatusNumbers(events, stats, tokenUsage)
  }, [trace.projections, stats, tokenUsage])

  return <UsageStatusLineView numbers={numbers} sessionId={sessionId} />
}
