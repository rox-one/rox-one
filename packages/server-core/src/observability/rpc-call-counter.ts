/**
 * Server-side RPC call counter. Pairs with the renderer IPC harness so
 * session permission/metadata N+1 shows up on both sides of the boundary.
 *
 * Enabled only when `CRAFT_PERF_RPC_TRACE=1` or a counter is injected.
 * Default off — production dispatch does not allocate a counter.
 */

const PERMISSION_METHODS = [
  'sessions.permission',
  'sessions:getPermissionModeState',
] as const

const METADATA_METHODS = [
  'sessions.metadata',
  'sessions:getProvenance',
] as const

export const PERF_RPC_TRACE_ENV = 'CRAFT_PERF_RPC_TRACE'

export function isPerfRpcTraceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[PERF_RPC_TRACE_ENV]
  return value === '1' || value === 'true'
}

export function createRpcCallCounterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RpcCallCounter | null {
  return isPerfRpcTraceEnabled(env) ? new RpcCallCounter() : null
}

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
    const permission = PERMISSION_METHODS.reduce((sum, method) => sum + this.get(method), 0)
    const metadata = METADATA_METHODS.reduce((sum, method) => sum + this.get(method), 0)
    if (permission >= sessionCount) {
      reasons.push(`sessions.permission called ${permission} times for ${sessionCount} sessions`)
    }
    if (metadata >= sessionCount) {
      reasons.push(`sessions.metadata called ${metadata} times for ${sessionCount} sessions`)
    }
    return reasons
  }
}
