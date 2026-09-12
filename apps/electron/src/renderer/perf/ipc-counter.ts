import { normalizeIpcChannel } from './channels'
import type { IpcChannelName, IpcCounts } from './types'
import { IPC_CHANNELS } from './types'

const PER_SESSION_CHANNELS: IpcChannelName[] = [
  'sessions.permission',
  'sessions.metadata',
]

export class IpcCallCounter {
  private readonly counts: IpcCounts = Object.fromEntries(IPC_CHANNELS.map((c) => [c, 0]))

  record(channel: IpcChannelName | string, n = 1): void {
    const name = normalizeIpcChannel(channel)
    this.counts[name] = (this.counts[name] ?? 0) + n
  }

  wrap<TArgs extends unknown[], TResult>(
    channel: IpcChannelName | string,
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs) => {
      this.record(channel)
      return fn(...args)
    }
  }

  wrapAsync<TArgs extends unknown[], TResult>(
    channel: IpcChannelName | string,
    fn: (...args: TArgs) => Promise<TResult>,
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs) => {
      this.record(channel)
      return await fn(...args)
    }
  }

  snapshot(): IpcCounts {
    return { ...this.counts }
  }

  get(channel: IpcChannelName): number {
    return this.counts[channel] ?? 0
  }

  reset(): void {
    for (const channel of IPC_CHANNELS) {
      this.counts[channel] = 0
    }
  }

  /**
   * N+1: permission/metadata fetched once per session in a list operation.
   * Batched list must use sessions.list (1) plus at most one batch of each.
   */
  detectSessionMetadataNPlusOne(sessionCount: number): string[] {
    const reasons: string[] = []
    if (sessionCount < 2) return reasons

    for (const channel of PER_SESSION_CHANNELS) {
      const count = this.get(channel)
      if (count >= sessionCount) {
        reasons.push(`${channel} called ${count} times for ${sessionCount} sessions`)
      }
    }
    return reasons
  }
}

export function diffIpc(before: IpcCounts, after: IpcCounts): IpcCounts {
  const delta: IpcCounts = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    delta[key] = (after[key] ?? 0) - (before[key] ?? 0)
  }
  return delta
}
