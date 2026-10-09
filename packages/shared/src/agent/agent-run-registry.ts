/**
 * Agent run registry — runId correlation + terminal-state waits (port of
 * OpenClaw's `agent` / `agent.wait` async run contract).
 *
 * Provenance: port-analysis/areas/f-substrate-gateway.md §"Sessions, routing,
 * queues/steering" and §"Turn lifecycle" (row f.5). Upstream
 * `src/gateway/server-methods/agent.ts:19` returns `{runId, acceptedAt}`
 * immediately while `agent.wait` (`docs/concepts/agent-loop.md:20-24`) blocks
 * for the terminal `{status, startedAt, endedAt, error?}`. Clean-room
 * re-expression: a per-agent registry correlates an immediate `runId` with the
 * terminal outcome of the streaming run, and `wait` resolves only once that run
 * reaches a terminal state.
 *
 * Contract
 * - {@link AgentRunRegistry.begin} opens a run. A run's id is unique; re-begin
 *   with a live id is a programming error and throws.
 * - A send hands out its `runId` immediately (see `BaseAgent.startRun`) while the
 *   events continue streaming; {@link AgentRunRegistry.wait} only resolves once
 *   {@link AgentRunRegistry.finish} records a terminal state for that id.
 * - Waiting correlates strictly by run id: waits for a different run id never
 *   resolve from another run's finish.
 */

import type { AgentEvent } from '@rox/core/types'

/** Terminal state of a run, as returned by {@link AgentRunRegistry.wait}. */
export interface AgentRunTerminalState {
  runId: string
  status: 'ok' | 'error' | 'aborted'
  /** `Date.now()` when the run began. */
  startedAt: number
  /** `Date.now()` when the run reached its terminal state. */
  endedAt: number
  /** Failure/abort detail when `status !== 'ok'`. */
  error?: string
}

interface RunRecord {
  runId: string
  startedAt: number
  terminal?: AgentRunTerminalState
  waiters: Array<(state: AgentRunTerminalState) => void>
}

/** Correlates immediate run ids with terminal outcomes. One per agent backend. */
export class AgentRunRegistry {
  private readonly runs = new Map<string, RunRecord>()

  /** Open a run. Throws when `runId` is already live. */
  begin(runId: string): void {
    const existing = this.runs.get(runId)
    if (existing && !existing.terminal) throw new Error(`Agent run ${runId} is already active`)
    this.runs.set(runId, { runId, startedAt: Date.now(), waiters: [] })
  }

  /**
   * Record the terminal state and release every waiter. Idempotent for the same
   * run only until it is finished; finishing an unknown or already-terminal run
   * throws (a missing `begin` is a bug, not a silent no-op).
   */
  finish(runId: string, status: AgentRunTerminalState['status'], error?: string): AgentRunTerminalState {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Agent run ${runId} was never begun`)
    if (run.terminal) throw new Error(`Agent run ${runId} already finished`)
    const terminal: AgentRunTerminalState = { runId, status, startedAt: run.startedAt, endedAt: Date.now(), ...(error ? { error } : {}) }
    run.terminal = terminal
    const waiters = run.waiters
    run.waiters = []
    for (const resolve of waiters) resolve(terminal)
    return terminal
  }

  /** The terminal state if the run already finished, else undefined. */
  peek(runId: string): AgentRunTerminalState | undefined {
    return this.runs.get(runId)?.terminal
  }

  /**
   * Resolve with the run's terminal state. Resolves immediately when the run is
   * already terminal; otherwise it blocks until {@link finish}. Rejects when the
   * run id was never begun, so a wait can never hang on a typo'd id.
   */
  wait(runId: string): Promise<AgentRunTerminalState> {
    const run = this.runs.get(runId)
    if (!run) return Promise.reject(new Error(`Agent run ${runId} was never begun`))
    if (run.terminal) return Promise.resolve(run.terminal)
    return new Promise<AgentRunTerminalState>((resolve) => run.waiters.push(resolve))
  }
}

/**
 * Value returned by `BaseAgent.startRun`: the run id is available immediately,
 * the event generator carries the (still-streaming) turn.
 */
export interface AgentStartHandle {
  runId: string
  events: AsyncGenerator<AgentEvent>
}