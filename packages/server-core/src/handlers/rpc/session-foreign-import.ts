/**
 * First-party foreign chat import (H5). Reads local P0 roots and writes Rox
 * transcripts. LOCAL_ONLY — never a DSH store, never HTTP :43120.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  discoverForeignSessions,
  persistForeignSession,
  type ForeignImportMode,
} from '@craft-agent/shared/sessions'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sessions.FOREIGN_DISCOVER,
  RPC_CHANNELS.sessions.FOREIGN_PERSIST,
] as const

const MAX_FOREIGN_PERSIST = 50

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
      const sourcePaths = (args?.sourcePaths ?? [])
        .filter((path): path is string => typeof path === 'string' && path.length > 0)
        .slice(0, MAX_FOREIGN_PERSIST)
      const results = []
      for (const sourcePath of sourcePaths) {
        results.push(
          await persistForeignSession({
            workspaceRoot: workspace.rootPath,
            sourcePath,
            mode: args?.mode,
          }),
        )
      }
      for (const result of results) {
        if (
          result.sessionId &&
          (result.action === 'created' || result.action === 'appended' || result.action === 'replaced')
        ) {
          deps.sessionManager.ingestImportedSession(workspaceId, result.sessionId)
          deps.sessionManager.notifySessionCreated(workspaceId, result.sessionId)
        }
      }
      return { results }
    },
  )
}
