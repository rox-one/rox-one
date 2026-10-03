export interface SecurityResourceState<T> {
  readonly scope: string | null
  readonly phase: 'loading' | 'available' | 'unavailable' | 'failed'
  readonly data: T | null
}

/** Each panel loads independently; predecessor and previous-workspace replies are discarded. */
export function createSecurityResource<T>(publish: (state: SecurityResourceState<T>) => void) {
  let generation = 0
  return {
    async read(scope: string | null, probe?: () => Promise<T>) {
      const request = ++generation
      if (!scope || !probe) { publish({ scope, phase: 'unavailable', data: null }); return }
      publish({ scope, phase: 'loading', data: null })
      try {
        const data = await probe()
        if (request === generation) publish({ scope, phase: 'available', data })
      } catch {
        if (request === generation) publish({ scope, phase: 'failed', data: null })
      }
    },
    replace(scope: string, data: T) {
      generation++
      publish({ scope, phase: 'available', data })
    },
    cancel() { generation++ },
  }
}
