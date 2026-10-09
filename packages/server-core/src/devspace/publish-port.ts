/**
 * Window-free composition of the Dev Space {@link DevSpacePublishPort} over the
 * EXISTING server-side Markdown commit pipeline (`MarkdownCommitStore`,
 * `docs/markdown-commit.ts`) — the same durable, journaled writer the content:*
 * RPC uses. No commit logic is duplicated here: `write` delegates to
 * `store.commit` (updates) / `store.writeNative` (creates) and `read` to the
 * store's guarded `readNote`.
 *
 * The compose site is deliberately window-free: a Dev Space run is a
 * fire-and-forget server pipeline with no renderer `RequestContext`, so the host
 * supplies a server-owned principal binding (never a request payload) alongside
 * the store it composed the same way as the content pipeline. When the host
 * passes no port, the `publish` stage honestly reports `publish-unavailable`
 * instead of pretending a page was published.
 *
 * No `shell:exec`, no egress; the only writes are the Notes store (through the
 * store) — the pipeline's own audit is written by the stage, not here.
 */
import { MarkdownChangedDeliveryError, markdownRevision, type MarkdownCommitStore } from '../docs/markdown-commit.ts'
import { MarkdownCommitError } from '@rox/core/docs'
import type {
  DevSpacePublishedNote, DevSpacePublishPort, DevSpacePublishWriteInput, DevSpacePublishWriteResult,
} from './stages/publish.ts'

/**
 * Server-owned authority the port writes under. Not derived from a request:
 * the host composes it once for the workspace whose Notes the port publishes to.
 */
export interface DevSpacePublishBinding {
  /** Server principal the store's owner authorizes (no renderer window/actor). */
  readonly actorPrincipalId: string
  /** The workspace whose Notes store this port publishes into. */
  readonly workspaceId: string
  /** Server-issued store binding, as required by the content commit pipeline. */
  readonly sourceStoreId: string
  /** Authority epoch of the composing host; mirrors the content pipeline (1). */
  readonly authorityEpoch: number
}

/** Map a store failure to the port's secret-free result — never a raw message. */
function commitFailure(error: unknown): DevSpacePublishWriteResult {
  if (error instanceof MarkdownChangedDeliveryError) {
    // The write is durable but native invalidation did not accept the event.
    return { status: 'unavailable', detail: 'invalidation-pending' }
  }
  if (error instanceof MarkdownCommitError) {
    switch (error.kind) {
      case 'conflict': return { status: 'conflict', ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}) }
      case 'denied': return { status: 'denied' }
      case 'rateLimited': return { status: 'busy' }
      case 'unknownFormat': return { status: 'unavailable', detail: 'authority-changed' }
      default: return { status: 'failed', detail: error.kind }
    }
  }
  return { status: 'failed', detail: 'commit-failed' }
}

/**
 * Compose a {@link DevSpacePublishPort} over a window-free `MarkdownCommitStore`.
 * `expectedRevision: null` is a create (`writeNative`); otherwise the write is an
 * optimistic-concurrency update (`commit`). Node paths, symlink guards and the
 * journal all stay owned by the store.
 */
export function createDevSpacePublishPort(
  store: MarkdownCommitStore, binding: DevSpacePublishBinding,
): DevSpacePublishPort {
  const { actorPrincipalId, workspaceId, sourceStoreId, authorityEpoch } = binding
  return {
    async read(requestedWorkspaceId: string, noteId: string): Promise<DevSpacePublishedNote | null> {
      if (requestedWorkspaceId !== workspaceId) return null
      try {
        const note = await store.readNote(actorPrincipalId, workspaceId, noteId)
        return note ? { revision: note.revision, content: note.content } : null
      } catch (error) {
        // A strict owner may deny a read of an ABSENT note (its `authorize` only
        // grants existing documents). That is a "no page yet" signal for publish:
        // report absence, and let the create path re-decide under `authorizeNative`.
        // A deny over an existing note still cannot overwrite it — the create
        // CAS sees the file present and surfaces a conflict.
        if (error instanceof MarkdownCommitError && error.kind === 'denied') return null
        throw error
      }
    },

    async write(input: DevSpacePublishWriteInput): Promise<DevSpacePublishWriteResult> {
      // The port is composed for exactly one workspace; refuse any other scope.
      if (input.workspaceId !== workspaceId) return { status: 'denied' }
      try {
        if (input.expectedRevision === null) {
          const receipt = await store.writeNative(actorPrincipalId, {
            workspaceId, operationId: input.operationId, authorityEpoch, sourceStoreId, reason: 'create',
            changes: [{ kind: 'write', noteId: input.noteId, expectedRevision: null, content: input.content }],
          })
          return {
            status: 'committed',
            revision: markdownRevision(input.content),
            previousRevision: markdownRevision(''),
            operationId: receipt.operationId,
            committedAt: receipt.committedAt,
          }
        }
        const receipt = await store.commit(actorPrincipalId, {
          workspaceId, noteId: input.noteId, operationId: input.operationId, authorityEpoch, sourceStoreId,
          expectedRevision: input.expectedRevision, content: input.content,
        })
        return {
          status: 'committed',
          revision: receipt.revision,
          previousRevision: receipt.previousRevision,
          operationId: receipt.operationId,
          committedAt: receipt.committedAt,
        }
      } catch (error) {
        return commitFailure(error)
      }
    },
  }
}