/**
 * Advisory memory-repository watcher (Wave A, WP-06).
 *
 * Polls each bank's working tree and emits `onChange(bankId, count)` when the
 * tree diverges from the last materialization (the number of edited files
 * changes). It NEVER applies anything: the user reviews and imports through
 * the proposal pipeline. OFF by default — the config flag `memory.repo.watch`
 * is not added in Wave A, so the default wiring passes `enabled: () => false`.
 */

/** The subset of the repo service the watcher needs (structurally satisfied by MemoryRepoService). */
export interface RepoWatcherRepo {
  listBanks(): Promise<Array<{ id: string }>>
  status(bankId: string): Promise<{ dirty: boolean; editedFiles: string[] }>
}

export interface RepoWatcherDeps {
  repo: RepoWatcherRepo
  onChange: (bankId: string, count: number) => void
  /** Defaults to `() => false` (feature off). */
  enabled?: () => boolean
  /** Defaults to 30s. */
  intervalMs?: number
}

export interface RepoWatcher {
  start(): void
  stop(): void
  /** One poll pass — exposed so tests can drive it deterministically. */
  tick(): Promise<void>
}

export function createRepoWatcher(deps: RepoWatcherDeps): RepoWatcher {
  const enabled = deps.enabled ?? (() => false)
  const intervalMs = deps.intervalMs ?? 30_000
  const lastCounts = new Map<string, number>()
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false

  const tick = async (): Promise<void> => {
    if (!enabled() || running) return
    running = true
    try {
      const banks = await deps.repo.listBanks()
      for (const bank of banks) {
        try {
          const status = await deps.repo.status(bank.id)
          const count = status.editedFiles?.length ?? 0
          if (lastCounts.get(bank.id) === count) continue
          lastCounts.set(bank.id, count)
          if (count > 0) deps.onChange(bank.id, count)
        } catch {
          // advisory: a single bank's status failure must not stop the poll
        }
      }
    } catch {
      // advisory: enumeration failure is ignored
    } finally {
      running = false
    }
  }

  return {
    start(): void {
      if (timer) return
      timer = setInterval(() => { void tick() }, intervalMs)
    },
    stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    tick,
  }
}