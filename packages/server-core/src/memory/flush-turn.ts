/**
 * flush-turn — the memory flush turn (spec c1.8).
 *
 * At a turn/session boundary the pending memory writes accumulated in the
 * workspace's {@link MemoryProposalStore} are committed to the canonical corpus
 * deterministically and idempotently, in a crash-safe order.
 *
 * The crash-safe order is owned by {@link approveMemoryProposalDurably}: the
 * durable write-intent is persisted BEFORE the corpus write and the write
 * receipt (`approval.writtenAt`) AFTER it. A crash anywhere in between leaves a
 * pending intent in the store and no corpus entry, never a half-written one.
 * Replaying the flush:
 *   - replays intents in deterministic id order,
 *   - is idempotent — an intent already carrying a receipt is skipped, and the
 *     approval path dedups by its receipt/dedup key so no second corpus line is
 *     ever appended,
 *   - is recoverable — an intent that still fails stays pending for the next
 *     flush instead of being dropped.
 *
 * Clean-room re-expression of OpenClaw's `buildMemoryFlushPlan`
 * (extensions/memory-core/src/flush-plan.ts:63): the flush turn persists
 * unwritten memory durably at the boundary, but ROX writes through its proposal
 * store's durable intent rather than an append-only daily-note prompt.
 */
import { approveMemoryProposalDurably } from './approve-memory-proposal'
import type { MemoryProposalStore } from './MemoryProposalStore'
import type { MemoryProposal } from '@rox/shared/memory/proposals'

export interface FlushTurnResult {
  /** Proposal ids whose canonical write is now confirmed durable. */
  flushed: string[]
  /** Pending intents that could not be applied (retained for the next flush). */
  failed: Array<{ id: string; error: string }>
}

export interface FlushTurnDeps {
  store: MemoryProposalStore
  workspaceRoot: string
  /** Flush timestamp; also the receipt/`writtenAt` time. Defaults to now. */
  now?: Date
  logger?: { warn: (msg: string, err?: unknown) => void }
}

/**
 * Commit every pending memory write intent for one workspace. Never throws:
 * a read failure or a per-intent failure is reported in the result so the
 * turn boundary is never broken by a durability recovery.
 */
export function flushMemoryWrites(deps: FlushTurnDeps): FlushTurnResult {
  const result: FlushTurnResult = { flushed: [], failed: [] }
  let pending: MemoryProposal[]
  try {
    pending = deps.store.pendingWriteIntents()
  } catch (err) {
    deps.logger?.warn('flushMemoryWrites: could not read pending intents', err)
    return result
  }
  for (const proposal of pending) {
    const receipt = proposal.approval
    if (!receipt) continue
    try {
      approveMemoryProposalDurably({
        store: deps.store,
        workspaceRoot: deps.workspaceRoot,
        proposalId: proposal.id,
        scope: receipt.scope,
        ...(receipt.projectId ? { projectId: receipt.projectId } : {}),
        // The approval path re-checks the owner against the stored proposal; a
        // personal intent's owner must be replayed from its own receipt.
        ...(receipt.owner ?? proposal.owner ? { owner: receipt.owner ?? proposal.owner } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      })
      result.flushed.push(proposal.id)
    } catch (err) {
      result.failed.push({ id: proposal.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}