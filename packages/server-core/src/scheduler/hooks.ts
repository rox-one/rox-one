/**
 * Named-event hook registry with ordered, sequential dispatch.
 *
 * Clean-room re-expression of the in-process hook subscription described for
 * the OpenClaw gateway (port row f.8; upstream `src/gateway/server/hooks.ts`).
 * The registry keeps per-event listeners in registration order and awaits them
 * one at a time so dispatch is deterministic; a throwing listener is recorded
 * and does not stop the remaining listeners (hooks are an observation seam and
 * must not be able to break each other or the scheduler).
 */

export interface HookContext {
  /** The event being dispatched. */
  readonly event: string
  /** Monotonic per-registry dispatch sequence (0-based). */
  readonly sequence: number
}

export type HookHandler<Payload = unknown> = (
  payload: Payload,
  context: HookContext,
) => void | Promise<void>

export interface HookFailure {
  readonly index: number
  readonly error: unknown
}

export interface HookDispatchResult {
  readonly event: string
  /** Number of listeners invoked (including ones that threw). */
  readonly invoked: number
  readonly failures: readonly HookFailure[]
}

export class HookRegistry {
  private readonly handlers = new Map<string, HookHandler<never>[]>()
  private sequence = 0

  /**
   * Register a listener; returns a disposer.
   *
   * The disposer removes this exact listener and returns whether it actually
   * removed one — `true` on the first call, `false` on any later call (the
   * listener is already gone). It is the boolean result of {@link off}, so a
   * caller can tell a real unsubscribe from a no-op.
   */
  on<Payload = unknown>(event: string, handler: HookHandler<Payload>): () => boolean {
    if (event === '') throw new Error('HookRegistry.on: event name must be non-empty')
    if (typeof handler !== 'function') throw new Error('HookRegistry.on: handler must be a function')
    const list = this.handlers.get(event) ?? []
    list.push(handler as HookHandler<never>)
    this.handlers.set(event, list)
    return () => this.off(event, handler)
  }

  /** Remove a previously registered listener. Returns whether it was present. */
  off<Payload = unknown>(event: string, handler: HookHandler<Payload>): boolean {
    const list = this.handlers.get(event)
    if (!list) return false
    const index = list.indexOf(handler as HookHandler<never>)
    if (index === -1) return false
    list.splice(index, 1)
    if (list.length === 0) this.handlers.delete(event)
    return true
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.length ?? 0
  }

  /** Event names with at least one listener, in first-registration order. */
  events(): string[] {
    return [...this.handlers.keys()]
  }

  /**
   * Dispatch `event` to its listeners in registration order, awaiting each
   * before starting the next. Never rejects for a listener error; failures are
   * reported in the result.
   */
  async emit<Payload = unknown>(event: string, payload: Payload): Promise<HookDispatchResult> {
    const list = this.handlers.get(event)
    if (!list || list.length === 0) {
      return { event, invoked: 0, failures: [] }
    }
    const sequence = this.sequence++
    const failures: HookFailure[] = []
    // Storage erases the payload generic (`HookHandler<never>`); re-assert the
    // emitted event's payload type at the copy boundary so dispatch stays
    // type-correct without widening the public registry API.
    const snapshot = [...list] as unknown as HookHandler<Payload>[]
    for (let index = 0; index < snapshot.length; index += 1) {
      try {
        await snapshot[index]!(payload, { event, sequence })
      } catch (error) {
        failures.push({ index, error })
      }
    }
    return { event, invoked: snapshot.length, failures }
  }
}