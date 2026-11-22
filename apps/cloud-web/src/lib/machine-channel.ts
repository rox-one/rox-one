/**
 * One live stream per machine, shared by every card on the page.
 *
 * The machine page and its load card both watch the same machine. They ask
 * this module instead of the network, so the server keeps one sampler: the
 * first subscriber opens the stream, the last one closes it, and both receive
 * every snapshot. A broken stream reconnects behind them — 1 s, 2 s, 4 s,
 * then 10 s at most — and waits while the tab is hidden, because a background
 * tab does not need live numbers.
 *
 * Listeners get the last known snapshot at once, so a card mounted mid-stream
 * paints without waiting for the next frame.
 */
import { streamMachine } from './api'
import type { MachineSnapshot } from './api'

/** `streaming` has open frames; `offline` means two failures in a row. */
export type MachineStreamStatus = 'streaming' | 'reconnecting' | 'offline'
export type MachineSnapshotListener = (snapshot: MachineSnapshot) => void
export type MachineStatusListener = (status: MachineStreamStatus) => void

const FIRST_RETRY_MS = 1000
const MAX_RETRY_MS = 10_000

interface Entry {
  id: string
  listeners: Set<MachineSnapshotListener>
  statusListeners: Set<MachineStatusListener>
  latest: MachineSnapshot | null
  status: MachineStreamStatus
  controller: AbortController | null
  retry: number | undefined
  failures: number
  paused: boolean
}

const entries = new Map<string, Entry>()
let watchingVisibility = false

function onVisibilityChange(): void {
  const hidden = typeof document !== 'undefined' && document.hidden
  for (const entry of entries.values()) {
    if (hidden) pause(entry)
    else resume(entry)
  }
}

function watchVisibility(): void {
  if (watchingVisibility || typeof document === 'undefined') return
  watchingVisibility = true
  document.addEventListener('visibilitychange', onVisibilityChange)
}

function unwatchVisibility(): void {
  if (!watchingVisibility || typeof document === 'undefined') return
  watchingVisibility = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
}

function setStatus(entry: Entry, next: MachineStreamStatus): void {
  if (entry.status === next) return
  entry.status = next
  for (const listener of [...entry.statusListeners]) listener(next)
}

/** 1 s, 2 s, 4 s, 8 s, then 10 s: a broken network should not hammer the server. */
function delayFor(failures: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, failures - 1), MAX_RETRY_MS)
}

function clearRetry(entry: Entry): void {
  if (entry.retry === undefined) return
  window.clearTimeout(entry.retry)
  entry.retry = undefined
}

function schedule(entry: Entry): void {
  if (entry.paused || entry.retry !== undefined) return
  if (entry.listeners.size + entry.statusListeners.size === 0) return
  entry.retry = window.setTimeout(() => {
    entry.retry = undefined
    start(entry)
  }, delayFor(entry.failures))
}

function finish(entry: Entry, controller: AbortController): void {
  if (entry.controller !== controller) return
  entry.controller = null
  // A stop of our own — last listener gone, tab hidden — is not a failure.
  if (controller.signal.aborted || entry.paused) return
  // A closed stream is a lost stream, whether the socket dropped or the server
  // ended it, so the wait grows the same way for both.
  entry.failures += 1
  setStatus(entry, entry.failures >= 2 ? 'offline' : 'reconnecting')
  schedule(entry)
}

function start(entry: Entry): void {
  if (entry.controller !== null || entry.retry !== undefined || entry.paused) return
  if (entry.listeners.size + entry.statusListeners.size === 0) return
  const controller = new AbortController()
  entry.controller = controller
  void streamMachine(
    entry.id,
    {
      // `ready` proves the socket opened; only a snapshot resets the backoff,
      // because a body that closes right after `ready` must still back off.
      ready: () => {
        if (entry.controller !== controller) return
        setStatus(entry, 'streaming')
      },
      snapshot: (snapshot) => {
        if (entry.controller !== controller) return
        entry.failures = 0
        entry.latest = snapshot
        setStatus(entry, 'streaming')
        for (const listener of [...entry.listeners]) listener(snapshot)
      },
    },
    controller.signal,
  ).then(
    () => finish(entry, controller),
    () => finish(entry, controller),
  )
}

function pause(entry: Entry): void {
  entry.paused = true
  clearRetry(entry)
  const controller = entry.controller
  entry.controller = null
  controller?.abort()
}

function resume(entry: Entry): void {
  if (!entry.paused) return
  entry.paused = false
  entry.failures = 0
  setStatus(entry, 'reconnecting')
  start(entry)
}

function dispose(entry: Entry): void {
  if (entries.get(entry.id) === entry) entries.delete(entry.id)
  entry.listeners.clear()
  entry.statusListeners.clear()
  entry.paused = true
  clearRetry(entry)
  const controller = entry.controller
  entry.controller = null
  controller?.abort()
  if (entries.size === 0) unwatchVisibility()
}

/**
 * Watch one machine. The returned function leaves the stream; the fetch itself
 * outlives a single card and stops only with the last subscriber.
 */
export function subscribeMachine(
  id: string,
  listener: MachineSnapshotListener,
  status?: MachineStatusListener,
): () => void {
  if (id.length === 0) return () => {}

  let entry = entries.get(id)
  if (entry === undefined) {
    entry = {
      id,
      listeners: new Set(),
      statusListeners: new Set(),
      latest: null,
      status: 'reconnecting',
      controller: null,
      retry: undefined,
      failures: 0,
      paused: typeof document !== 'undefined' && document.hidden,
    }
    entries.set(id, entry)
    watchVisibility()
  }

  entry.listeners.add(listener)
  if (status !== undefined) entry.statusListeners.add(status)
  // The cards mount after the stream may already have an answer.
  status?.(entry.status)
  if (entry.latest !== null) listener(entry.latest)
  start(entry)

  let closed = false
  return () => {
    if (closed) return
    closed = true
    entry!.listeners.delete(listener)
    if (status !== undefined) entry!.statusListeners.delete(status)
    if (entry!.listeners.size + entry!.statusListeners.size === 0) dispose(entry!)
  }
}
