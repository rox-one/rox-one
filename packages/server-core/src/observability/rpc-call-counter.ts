/**
 * Server-side RPC call counter. Pairs with the renderer IPC harness so
 * session permission/metadata N+1 shows up on both sides of the boundary.
 */
export class RpcCallCounter {
  private readonly counts = new Map<string, number>()

  record(method: string, n = 1): void {
    this.counts.set(method, (this.counts.get(method) ?? 0) + n)
  }

  get(method: string): number {
    return this.counts.get(method) ?? 0
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts)
  }

  reset(): void {
    this.counts.clear()
  }

  wrap<TArgs extends unknown[], TResult>(
    method: string,
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs) => {
      this.record(method)
      return fn(...args)
    }
  }

  detectSessionMetadataNPlusOne(sessionCount: number): string[] {
    const reasons: string[] = []
    if (sessionCount < 2) return reasons
    for (const method of ['sessions.permission', 'sessions.metadata']) {
      const count = this.get(method)
      if (count >= sessionCount) {
        reasons.push(`${method} called ${count} times for ${sessionCount} sessions`)
      }
    }
    return reasons
  }
}
