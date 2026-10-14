/**
 * Queue-or-steer (top50 #17): how a message typed while the agent works is
 * delivered. 'auto' leaves the connection's midStreamBehavior in charge.
 */
import type { SteeringVerb } from '@rox/shared/protocol'

export type MidStreamMode = 'auto' | 'followup' | 'steer'

export const MID_STREAM_MODES: readonly MidStreamMode[] = ['auto', 'followup', 'steer']

export function queueModeFor(mode: MidStreamMode, isProcessing: boolean): SteeringVerb | undefined {
  if (!isProcessing || mode === 'auto') return undefined
  return mode
}
