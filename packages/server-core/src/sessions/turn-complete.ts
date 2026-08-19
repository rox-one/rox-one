import type { SessionEvent } from '@craft-agent/shared/protocol'
import type { TokenUsage } from '@craft-agent/core/types'

export type TurnCompleteReason = 'complete' | 'interrupted' | 'error' | 'timeout'

export interface TurnCompleteFields {
  sessionId: string
  tokenUsage?: TokenUsage
  backgroundTasksAlive?: boolean
  hasUnread?: boolean
  reason?: TurnCompleteReason
  didReceiveNewFinalMessage?: boolean
}

export type SendTurnCompleteEvent = (event: SessionEvent, workspaceId: string) => void

/**
 * Emit exactly one renderer `complete` event.
 *
 * Plan-interrupt, auth-interrupt, and onProcessingStopped all go through this
 * helper so a mid-turn stop cannot grow a second inline payload in SessionManager.
 * Event shape is unchanged — callers pass the same fields they used to inline.
 */
export function emitTurnComplete(
  sendEvent: SendTurnCompleteEvent,
  workspaceId: string,
  fields: TurnCompleteFields,
): void {
  sendEvent({ type: 'complete', ...fields }, workspaceId)
}
