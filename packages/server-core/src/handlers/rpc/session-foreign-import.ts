/**
 * First-party foreign chat import (H5). Reads local P0 roots and writes Rox
 * transcripts. LOCAL_ONLY — never a DSH store, never HTTP :43120.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  discoverForeignSessions,
  inferForeignKind,
  persistForeignSession,
  type ForeignImportMode,
} from '@craft-agent/shared/sessions'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sessions.FOREIGN_DISCOVER,
  RPC_CHANNELS.sessions.FOREIGN_PERSIST,
] as const

export function registerSessionForeignImportHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.sessions.FOREIGN_DISCOVER,
    async (_ctx, args: { workspaceId?: string } | undefined) => {
      const workspaceId = args?.workspaceId
      if (!workspaceId) throw new Error('sessions.foreignDiscover: workspaceId is required')
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('sessions.foreignDiscover: workspace not found')
      return discoverForeignSessions({ workspaceRoot: workspace.rootPath })
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
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('sessions.foreignPersist: workspace not found')
      const results = []
      for (const sourcePath of args?.sourcePaths ?? []) {
        results.push(
          await persistForeignSession({
            workspaceRoot: workspace.rootPath,
            sourcePath,
            kind: inferForeignKind(sourcePath),
            mode: args?.mode,
          }),
        )
      }
      deps.sessionManager.reloadSessions()
      for (const result of results) {
        if (
          result.sessionId &&
          (result.action === 'created' || result.action === 'appended' || result.action === 'replaced')
        ) {
          deps.sessionManager.notifySessionCreated(workspaceId, result.sessionId)
        }
      }
      return { results }
    },
  )
}
