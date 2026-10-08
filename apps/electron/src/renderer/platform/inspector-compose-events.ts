/**
 * Compose requests fired by `InspectorActionRail`'s create buttons.
 *
 * These used to be window events. The rail pushes a fresh panel and the mode
 * screen mounts only afterwards, so a synchronously dispatched event was lost
 * whenever the target screen was not already open — «Создать новую задачу» did
 * nothing on a cold screen. A request is therefore recorded here and consumed
 * by the target screen when it mounts: the new panel always wins, and no
 * already-open panel reacts.
 */
export type ComposeTarget = 'tasks' | 'meetings' | 'notes'

/** Requests expire so a panel that never mounts cannot open a stale composer. */
const REQUEST_TTL_MS = 10_000

const pending: Partial<Record<ComposeTarget, { count: number; at: number }>> = {}

/** Record a create request; the next mounting target screen consumes it. */
export function requestCompose(target: ComposeTarget): void {
  const entry = pending[target]
  if (entry && Date.now() - entry.at < REQUEST_TTL_MS) entry.count += 1
  else pending[target] = { count: 1, at: Date.now() }
}

/** true exactly once per `requestCompose()` call, for a freshly mounted screen. */
export function consumePendingCompose(target: ComposeTarget): boolean {
  const entry = pending[target]
  if (!entry) return false
  if (Date.now() - entry.at > REQUEST_TTL_MS) {
    delete pending[target]
    return false
  }
  if (entry.count <= 1) delete pending[target]
  else entry.count -= 1
  return true
}
