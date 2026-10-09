/**
 * notify.ts — the frozen server-side notification seam for memory-repo
 * materialization (spec §7).
 *
 * Every write site that mutates memory sources (MemoryService.applyResult, RPC
 * mutations, memory-io import, approve-memory-proposal, PromotionEngine
 * promotion/rollback) calls `notifyRepoMutation(bank, reason)`. A4 wires the
 * real notifier (the MemoryRepoService debounce) via `setRepoNotifier`; until
 * then, or after `setRepoNotifier(null)`, the call is a silent no-op.
 *
 * The seam must NEVER throw: a notification failure can never break a memory
 * mutation.
 */

/**
 * A bank selector carrying the optional owner scope. `ownerKey8` is the 8-hex
 * lesson-owner key (`ownerKey8For`) — present only for owner-carrying writes, so
 * the owner-scoped projection (`main#<owner8>` / `ws:<id>#<owner8>`) is the one
 * re-materialized instead of the ownerless base bank.
 */
export type RepoBankRef =
  | { scope: 'main'; ownerKey8?: string }
  | { scope: 'workspace'; workspaceId: string; ownerKey8?: string }

export type RepoNotifier = (bank: RepoBankRef, reason: string) => void

let notifier: RepoNotifier | null = null

export function setRepoNotifier(fn: RepoNotifier | null): void {
  notifier = fn
}

export function notifyRepoMutation(bank: RepoBankRef, reason: string): void {
  if (!notifier) return
  try {
    notifier(bank, reason)
  } catch {
    // notification is advisory; the mutation already landed
  }
}