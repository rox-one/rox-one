/**
 * First-party foreign chat import (H5). Reads local P0 roots and writes Rox
 * transcripts. LOCAL_ONLY — never a DSH store, never HTTP :43120.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  discoverForeignSessionsAsync,
  persistForeignSession,
  type ForeignImportMode,
  type ForeignPersistResult,
} from '@craft-agent/shared/sessions'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcSessionForeignImportActResult,
  rpcSessionForeignImportListResult,
  rpcSessionForeignImportReadResult,
} from '@craft-agent/core/rox2'
import { ForeignAutoImporter } from './session-foreign-auto-import'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sessions.FOREIGN_DISCOVER,
  RPC_CHANNELS.sessions.FOREIGN_PERSIST,
  RPC_CHANNELS.sessions.FOREIGN_AUTO_STATUS,
  RPC_CHANNELS.sessions.FOREIGN_AUTO_RUN,
  RPC_CHANNELS.sessions.FOREIGN_AUTO_SET,
] as const

const MAX_FOREIGN_PERSIST = 5_000

export function registerSessionForeignImportHandlers(server: RpcServer, deps: HandlerDeps): void {
  const autoImporter = new ForeignAutoImporter(deps)
  // Background import only runs inside the desktop app (never in tests or
  // headless servers, which have no local chat sources of the user).
  if (process.versions.electron && process.env.NODE_ENV !== 'test') autoImporter.start()

  const autoGate = (workspaceId: string | undefined) => {
    const act = rpcSessionForeignImportActResult({ source: 'native', action: 'write', nativeId: workspaceId ?? 'active' })
    if (!isClaimableLive(act)) throw new Error('sessions.foreignAuto is not live')
  }

  server.handle(RPC_CHANNELS.sessions.FOREIGN_AUTO_STATUS, async (_ctx, args: { workspaceId?: string } | undefined) =>
    autoImporter.status(args?.workspaceId),
  )

  server.handle(
    RPC_CHANNELS.sessions.FOREIGN_AUTO_RUN,
    async (_ctx, args: { workspaceId?: string; all?: boolean } | undefined) => {
      autoGate(args?.workspaceId)
      return autoImporter.run({ workspaceId: args?.workspaceId, all: args?.all === true, force: true })
    },
  )

  server.handle(
    RPC_CHANNELS.sessions.FOREIGN_AUTO_SET,
    async (_ctx, args: { workspaceId?: string; enabled?: boolean } | undefined) => {
      autoGate(args?.workspaceId)
      return autoImporter.setEnabled(args?.workspaceId, args?.enabled !== false)
    },
  )

  server.handle(
    RPC_CHANNELS.sessions.FOREIGN_DISCOVER,
    async (_ctx, args: { workspaceId?: string } | undefined) => {
      const workspaceId = args?.workspaceId
      if (!workspaceId) throw new Error('sessions.foreignDiscover: workspaceId is required')
      const listed = rpcSessionForeignImportListResult({ source: 'native' })
      if (!isClaimableLive(listed.result)) return { entries: [], scannedAt: Date.now(), cachePath: '', truncated: false }
      const read = rpcSessionForeignImportReadResult({ source: 'native', nativeId: workspaceId })
      if (!isClaimableLive(read.result)) throw new Error('sessions.foreignDiscover is not live')
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('sessions.foreignDiscover: workspace not found')
      // Async + incremental: never block the main process on a big scan.
      return discoverForeignSessionsAsync({ workspaceRoot: workspace.rootPath, reuseCache: true })
    },
  )

  server.handle(
    RPC_CHANNELS.sessions.FOREIGN_PERSIST,
    async (
      _ctx,
      args: { workspaceId?: string; sourcePaths?: string[]; mode?: ForeignImportMode } | undefined,
    ) => {
      const workspaceId = args?.workspaceId
      if (!workspaceId) throw new Error('sessions.foreignPersist: workspaceId is required')
      const act = rpcSessionForeignImportActResult({ source: 'native', action: 'write', nativeId: workspaceId })
      if (!isClaimableLive(act)) throw new Error('sessions.foreignPersist is not live')
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('sessions.foreignPersist: workspace not found')
      const submitted = args?.sourcePaths ?? []
      const sourcePaths = submitted.slice(0, MAX_FOREIGN_PERSIST)
      const results: ForeignPersistResult[] = []
      for (const sourcePath of sourcePaths) {
        if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
          results.push({ sourcePath: '', action: 'skipped' as const, reason: 'invalid-source-path' })
          continue
        }
        try {
          results.push(await persistForeignSession({ workspaceRoot: workspace.rootPath, sourcePath, mode: args?.mode }))
        } catch {
          results.push({ sourcePath, action: 'skipped' as const, reason: 'import-failed' })
        }
      }
      for (const result of results) {
        if (
          result.sessionId &&
          (result.action === 'created' || result.action === 'appended' || result.action === 'replaced')
        ) {
          try {
            deps.sessionManager.ingestImportedSession(workspaceId, result.sessionId)
            deps.sessionManager.notifySessionCreated(workspaceId, result.sessionId)
          } catch {
            // Persisted session remains available; list refresh can happen on the next load.
          }
        }
      }
      return {
        results,
        failed: results.filter((result) => result.reason === 'import-failed').length,
        truncated: submitted.length > sourcePaths.length,
        omitted: Math.max(0, submitted.length - sourcePaths.length),
      }
    },
  )
}
