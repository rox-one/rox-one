/**
 * createKnowledgeToolRuntime — the server-core implementation of the
 * KnowledgeToolRuntime seam from @craft-agent/session-tools-core. Registered
 * once by registerKnowledgeHandlers (handlers/rpc/knowledge.ts), it lets the
 * knowledge_search / knowledge_read / knowledge_get_backlinks session tools
 * reach the SAME provider resolution path as the knowledge RPC read channels
 * (connection record → CredentialManager token → KnowledgeRegistry.connect).
 *
 * Boundary rules (mirrored by the handlers' tests):
 * - connectionId omitted → the first configured connection (MVP single-connection
 *   default, same as KnowledgeRegistry.connect's defaultConnectionId).
 * - No connection configured → typed KnowledgeError CONNECTION_UNAVAILABLE.
 * - KnowledgeError from the provider passes through unchanged; anything else is
 *   wrapped as PROVIDER_ERROR — nothing raw crosses this seam.
 */
import { KnowledgeError } from '@craft-agent/core/knowledge'
import type { KnowledgeProvider } from '@craft-agent/core/knowledge'
import type {
  KnowledgeToolRuntime,
  KnowledgeReadContextMode,
} from '@craft-agent/session-tools-core'
import { KnowledgeConnectionsStore } from './connections-store'

export interface KnowledgeToolRuntimeDeps {
  /** The knowledge RPC layer's provider resolver (token-aware). */
  resolveProvider: (connectionId: string) => Promise<KnowledgeProvider>
  /** Connection listing; defaults to the on-disk global store. */
  listConnections?: () => Array<{ id: string }>
}

export function createKnowledgeToolRuntime(deps: KnowledgeToolRuntimeDeps): KnowledgeToolRuntime {
  const listConnections = deps.listConnections ?? (() => new KnowledgeConnectionsStore().list())

  function resolveConnectionId(explicit?: string): string {
    if (explicit && explicit.trim()) return explicit.trim()
    const first = listConnections()[0]
    if (!first) {
      throw new KnowledgeError(
        'CONNECTION_UNAVAILABLE',
        'No knowledge connection configured — open Settings → Knowledge and connect a SiYuan kernel first',
      )
    }
    return first.id
  }

  async function call<T>(connectionId: string | undefined, fn: (provider: KnowledgeProvider) => Promise<T>): Promise<T> {
    try {
      const provider = await deps.resolveProvider(resolveConnectionId(connectionId))
      return await fn(provider)
    } catch (error) {
      if (error instanceof KnowledgeError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new KnowledgeError('PROVIDER_ERROR', message)
    }
  }

  return {
    search: ({ connectionId, input }) => call(connectionId, (provider) => provider.search(input)),

    read: async ({ connectionId, ref, contextMode }) => {
      const wantsContext = contextMode !== undefined && contextMode !== 'none'
      return call(connectionId, async (provider) => {
        const node = await provider.get(ref)
        if (!wantsContext) return { node }
        const context = await provider.getContext(ref, contextMode as Exclude<KnowledgeReadContextMode, 'none'>)
        return { node, context }
      })
    },

    getBacklinks: ({ connectionId, ref }) =>
      call(connectionId, async (provider) => (await provider.getContext(ref, 'snapshot')).backlinks),
  }
}
