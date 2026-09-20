interface PausableDeadlineOptions<Timer> {
  durationMs: number
  now(): number
  setTimer(callback: () => void, milliseconds: number): Timer
  clearTimer(timer: Timer): void
  onElapsed(): void
}

export interface PausableDeadline {
  setActive(value: boolean): void
  dispose(): void
}

/** Counts only visible, uninterrupted reading time; never polls while paused. */
export function createPausableDeadline<Timer>(options: PausableDeadlineOptions<Timer>): PausableDeadline {
  let remaining = Math.max(0, options.durationMs)
  let timer: Timer | undefined
  let startedAt = 0
  let active = false
  let disposed = false
  let elapsed = false

  const pause = () => {
    if (timer !== undefined) options.clearTimer(timer)
    timer = undefined
    if (active) remaining = Math.max(0, remaining - Math.max(0, options.now() - startedAt))
    active = false
  }

  return {
    setActive(value: boolean) {
      if (disposed || elapsed || active === value) return
      if (!value) { pause(); return }
      active = true
      startedAt = options.now()
      timer = options.setTimer(() => {
        timer = undefined
        if (!active || disposed || elapsed) return
        active = false
        elapsed = true
        remaining = 0
        options.onElapsed()
      }, remaining)
    },
    dispose() {
      pause()
      disposed = true
    },
  }
}
