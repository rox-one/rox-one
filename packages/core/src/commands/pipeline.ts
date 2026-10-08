/**
 * W1-03 (#1500) — Ordered, named middleware chain shared by the local
 * (server-core) and workspace (workspace-service) executors.
 *
 * Hook point for W1-11 (#1508): the TECH-SPEC §13.2 policy steps (kill
 * switch, scope, risk class, rate limit, policy mode, standing approval,
 * audit) are inserted with `executor.use(middleware)` between the built-in
 * `authorize` stage and the transactional `execute` stage, without rewriting
 * the executor. A middleware may short-circuit by returning a receipt.
 */

import type { CommandEnvelope } from './envelope.ts'
import type { CommandReceipt } from './receipt.ts'
import type { CommandActor, CommandDefinition, ExecutionAuthority } from './registry.ts'

export interface CommandPipelineContext {
  readonly envelope: CommandEnvelope
  readonly definition: CommandDefinition<unknown>
  /** Payload after schema validation. */
  readonly payload: unknown
  readonly workspaceId: string
  readonly actor: CommandActor
  readonly authority: ExecutionAuthority
  /** Scratch space for middleware (e.g. computed risk class, audit ids). */
  readonly state: Map<string, unknown>
}

export interface CommandMiddleware {
  /** Unique, stable name (used for ordering diagnostics and removal). */
  readonly name: string
  run(ctx: CommandPipelineContext, next: () => Promise<CommandReceipt>): Promise<CommandReceipt>
}

/** Built-in stage names, in order. User middleware runs between `authorize` and `execute`. */
export const BUILT_IN_COMMAND_STAGES = ['validate', 'resolve', 'authorize', 'execute'] as const

/** Compose middleware around a terminal step (koa-style; `next` may be called at most once). */
export function composeCommandMiddleware(
  middleware: readonly CommandMiddleware[],
  terminal: (ctx: CommandPipelineContext) => Promise<CommandReceipt>,
): (ctx: CommandPipelineContext) => Promise<CommandReceipt> {
  return (ctx) => {
    const dispatch = (index: number): Promise<CommandReceipt> => {
      const current = middleware[index]
      if (!current) return terminal(ctx)
      let called = false
      return current.run(ctx, () => {
        if (called) return Promise.reject(new Error(`Middleware ${current.name} called next() twice`))
        called = true
        return dispatch(index + 1)
      })
    }
    return dispatch(0)
  }
}

/** Ordered named list with duplicate-name protection. */
export class CommandMiddlewareChain {
  private readonly items: CommandMiddleware[] = []

  use(middleware: CommandMiddleware): this {
    if (!middleware?.name || typeof middleware.run !== 'function') throw new Error('Invalid command middleware')
    if ((BUILT_IN_COMMAND_STAGES as readonly string[]).includes(middleware.name)) {
      throw new Error(`Middleware name is reserved: ${middleware.name}`)
    }
    if (this.items.some(item => item.name === middleware.name)) throw new Error(`Duplicate middleware: ${middleware.name}`)
    this.items.push(middleware)
    return this
  }

  remove(name: string): boolean {
    const index = this.items.findIndex(item => item.name === name)
    if (index === -1) return false
    this.items.splice(index, 1)
    return true
  }

  names(): string[] {
    return this.items.map(item => item.name)
  }

  list(): readonly CommandMiddleware[] {
    return this.items
  }
}
