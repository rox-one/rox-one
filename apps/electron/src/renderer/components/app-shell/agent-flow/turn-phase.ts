/**
 * Agent turn phases (top50 #14) — pure derivation of what the agent is doing
 * right now from the live transcript. No React; unit-tested in isolation.
 */

export type TurnPhase = 'idle' | 'starting' | 'thinking' | 'tool' | 'writing' | 'waiting'

export interface TurnPhaseMessage {
  role: string
  isStreaming?: boolean
  isIntermediate?: boolean
  isQueued?: boolean
  isPending?: boolean
  toolStatus?: string
  toolName?: string
  toolDisplayName?: string
}

export interface TurnPhaseState {
  phase: TurnPhase
  /** Tool currently executing (phase 'tool'). */
  toolName?: string
  /** Tools finished in the current turn. */
  toolsDone: number
  /** User messages waiting for the agent (queued while it works). */
  queued: number
}

const RUNNING_TOOL = new Set(['pending', 'executing'])

export function deriveTurnPhase(
  messages: readonly TurnPhaseMessage[] | undefined,
  opts: { isProcessing: boolean; hasPendingRequest?: boolean },
): TurnPhaseState {
  const list = messages ?? []
  const queued = list.reduce((n, m) => n + (m.role === 'user' && m.isQueued ? 1 : 0), 0)
  if (!opts.isProcessing) return { phase: 'idle', toolsDone: 0, queued }

  // Current turn = everything after the last non-queued user message.
  let start = 0
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]!
    if (m.role === 'user' && !m.isQueued) { start = i + 1; break }
  }
  const turn = list.slice(start)
  const toolsDone = turn.reduce((n, m) => n + (m.role === 'tool' && m.toolStatus && !RUNNING_TOOL.has(m.toolStatus) ? 1 : 0), 0)
  if (opts.hasPendingRequest) return { phase: 'waiting', toolsDone, queued }

  for (let i = turn.length - 1; i >= 0; i--) {
    const m = turn[i]!
    if (m.role === 'user' && m.isQueued) continue
    if (m.role === 'tool' && m.toolStatus && RUNNING_TOOL.has(m.toolStatus)) {
      return { phase: 'tool', toolName: m.toolDisplayName || m.toolName, toolsDone, queued }
    }
    if (m.role === 'thinking' && m.isStreaming) return { phase: 'thinking', toolsDone, queued }
    if (m.role === 'assistant' && m.isStreaming) {
      return { phase: m.isIntermediate ? 'thinking' : 'writing', toolsDone, queued }
    }
    if (m.role === 'user' || m.role === 'tool' || m.role === 'assistant' || m.role === 'thinking') break
  }
  return { phase: turn.every((m) => m.role === 'user') ? 'starting' : 'thinking', toolsDone, queued }
}
