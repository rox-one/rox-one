/**
 * First-party foreign chat import (H5). Reads local P0 roots and writes Rox
 * transcripts. LOCAL_ONLY — never a DSH store, never HTTP :43120.
 */

import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import {
  discoverForeignSessionsAsync,
  persistForeignSessions,
  pageForeignDiscover,
  FOREIGN_DISCOVER_PAGE,
  FOREIGN_DISCOVER_PAGE_CAP,
  createCoalescedProgress,
  loadForeignImportScanCacheFile,
  type ForeignImportMode,
  type ForeignPersistResult,
} from '@rox/shared/sessions'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcSessionForeignImportActResult,
  rpcSessionForeignImportListResult,
  rpcSessionForeignImportReadResult,
} from '@rox/core/rox2'
import { ForeignAutoImporter, ingestPersistedBatch } from './session-foreign-auto-import'

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
    async (_ctx, args: { workspaceId?: string; offset?: number; limit?: number } | undefined) => {
      const workspaceId = args?.workspaceId
      if (!workspaceId) throw new Error('sessions.foreignDiscover: workspaceId is required')
      const listed = rpcSessionForeignImportListResult({ source: 'native' })
      if (!isClaimableLive(listed.result)) {
        // Not a silent empty list: tell the caller the scan could not run, so
        // the UI can show why instead of "nothing found".
        return { entries: [], scannedAt: Date.now(), cachePath: '', truncated: false, unavailable: 'not-live' as const }
      }
      const read = rpcSessionForeignImportReadResult({ source: 'native', nativeId: workspaceId })
      if (!isClaimableLive(read.result)) {
        return { entries: [], scannedAt: Date.now(), cachePath: '', truncated: false, unavailable: 'not-live' as const }
      }
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('sessions.foreignDiscover: workspace not found')
      const offset = args?.offset ?? 0
      const limit = args?.limit ?? FOREIGN_DISCOVER_PAGE
      if (offset > 0) {
        const cached = loadForeignImportScanCacheFile(workspace.rootPath)
        return pageForeignDiscover(
          { entries: cached.entries, scannedAt: cached.scannedAt ?? Date.now(), cachePath: '' },
          offset,
          Math.min(limit, FOREIGN_DISCOVER_PAGE_CAP),
        )
      }
      const discovered = await discoverForeignSessionsAsync({ workspaceRoot: workspace.rootPath, reuseCache: true })
      return pageForeignDiscover(discovered, 0, Math.min(limit, FOREIGN_DISCOVER_PAGE_CAP))
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
      const valid = sourcePaths.filter((sourcePath) => typeof sourcePath === 'string' && sourcePath.length > 0)
      const total = valid.length
      const progress = createCoalescedProgress((payload) => {
        pushTyped(server, RPC_CHANNELS.sessions.FOREIGN_PROGRESS, { to: 'workspace', workspaceId }, workspaceId, payload)
      })
      let done = 0
      const persisted = await persistForeignSessions(
        workspace.rootPath,
        valid.map((sourcePath) => ({ sourcePath })),
        args?.mode ?? 'skip',
        undefined,
        {
          onBatch: async (batch) => {
            done += batch.length
            progress.report({ done, total, phase: 'persist' })
            await ingestPersistedBatch(deps, workspaceId, batch)
            progress.report({ done, total, phase: 'ingest' })
          },
        },
      )
      progress.flush()
      let next = 0
      const results: ForeignPersistResult[] = sourcePaths.map((sourcePath) =>
        typeof sourcePath === 'string' && sourcePath.length > 0
          ? persisted[next++]!
          : { sourcePath: '', action: 'skipped' as const, reason: 'invalid-source-path' },
      )
      return {
        results,
        failed: results.filter((result) => result.reason === 'import-failed').length,
        truncated: submitted.length > sourcePaths.length,
        omitted: Math.max(0, submitted.length - sourcePaths.length),
      }
    },
  )
}
