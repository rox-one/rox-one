/**
 * Turn-phase + tok/s helpers for the chat-chrome toolbar (H2).
 */

export type TurnPhase = 'thinking' | 'streaming' | 'compacting' | 'tool' | 'running'

export function computeTokensPerSecond(
  outputTokens: number | null | undefined,
  elapsedMs: number,
): number | null {
  if (elapsedMs < 250) return null
  if (outputTokens == null || !Number.isFinite(outputTokens) || outputTokens <= 0) return null
  return outputTokens / (elapsedMs / 1000)
}

export function formatTokensPerSecond(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0'
  if (rate < 10) return rate.toFixed(1)
  return String(Math.round(rate))
}

export function resolveTurnPhase(
  statusType: string | null | undefined,
  isProcessing: boolean,
  outputTokens?: number | null,
): TurnPhase | null {
  if (!isProcessing) return null
  switch (statusType) {
    case 'compacting':
      return 'compacting'
    case 'tool':
    case 'tool_use':
    case 'tool-use':
      return 'tool'
    case 'thinking':
      return 'thinking'
    case 'streaming':
      return 'streaming'
    default:
      return (outputTokens ?? 0) > 0 ? 'streaming' : 'thinking'
  }
}

export function formatCostUsd(costUsd: number | null | undefined): string | null {
  if (costUsd == null || !Number.isFinite(costUsd) || costUsd < 0) return null
  if (costUsd === 0) return '$0.00'
  if (costUsd < 0.01) return '<$0.01'
  return `$${costUsd.toFixed(2)}`
}
