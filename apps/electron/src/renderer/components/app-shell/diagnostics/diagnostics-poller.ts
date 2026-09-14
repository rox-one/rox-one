interface PollerOptions<T> {
  load(signal: AbortSignal): Promise<T>
  onValue(value: T): void
  onError(error: unknown): void
  intervalMs?: number
  setTimer(callback: () => void, milliseconds: number): unknown
  clearTimer(timer: any): void
}

/** Serial, visibility-controlled polling. Construction performs no work. */
export function createDiagnosticsPoller<T>(options: PollerOptions<T>) {
  let active = false
  let disposed = false
  let controller: AbortController | undefined
  let timer: unknown
  let resumeAfterPending = false

  const clearTimer = () => {
    if (timer !== undefined) options.clearTimer(timer)
    timer = undefined
  }

  const run = async () => {
    if (!active || disposed || controller) return
    clearTimer()
    const current = new AbortController()
    controller = current
    try {
      const value = await options.load(current.signal)
      if (active && !disposed && !current.signal.aborted) options.onValue(value)
    } catch (error) {
      if (active && !disposed && !current.signal.aborted) options.onError(error)
    } finally {
      controller = undefined
      if (active && !disposed) {
        if (resumeAfterPending) {
          resumeAfterPending = false
          void run()
        } else if (options.intervalMs) {
          timer = options.setTimer(() => { void run() }, options.intervalMs)
        }
      }
    }
  }

  return {
    setActive(value: boolean) {
      if (disposed || active === value) return
      active = value
      clearTimer()
      if (!value) {
        resumeAfterPending = false
        controller?.abort()
      } else if (controller) {
        resumeAfterPending = true
      } else {
        void run()
      }
    },
    refresh() { if (!controller) void run() },
    dispose() {
      disposed = true
      active = false
      resumeAfterPending = false
      clearTimer()
      controller?.abort()
    },
  }
}
