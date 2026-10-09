/**
 * Knowledge Map RPC — `knowledgeMap:get` → `KnowledgeMapDto` (plan §3.2).
 *
 * The corpus (context docs, memory, workspace notes) is derived and read-only,
 * so a single GET rebuilds it on demand. `knowledgeMap:changed` is intentionally
 * NOT pushed here: no cheap, ownership-safe re-scan trigger exists in this
 * module (notes/context-docs already emit their own change events; the renderer
 * rebuilds on those + the explicit «Перестроить» button).
 */

import { join } from 'path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { resolveConfigDir } from '@rox/shared/config/paths'
import { getDefaultWorkspacesDir, loadWorkspaceConfig } from '@rox/shared/workspaces'
import type { RequestContext, RpcServer } from '@rox/server-core/transport'
import { buildKnowledgeMap } from '../../knowledge/knowledge-map.ts'

export const HANDLED_CHANNELS = [RPC_CHANNELS.knowledgeMap.GET] as const

/** Generic profile label used when no user name is resolvable server-side. */
const PROFILE_ROOT_LABEL = 'Профиль'

/** Notes root resolution mirrors `handlers/rpc/notes.ts` (`getWorkspaceNotesRoot`). */
function resolveWorkspaceNotesRoot(workspaceId: string): string | null {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return null
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (config?.notesPath) return config.notesPath
  return join(getDefaultWorkspacesDir(), workspaceId, 'notes')
}

export function registerKnowledgeMapHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.knowledgeMap.GET, async (ctx: RequestContext) => {
    const notesRoot = ctx.workspaceId ? resolveWorkspaceNotesRoot(ctx.workspaceId) : null
    return buildKnowledgeMap({
      configDir: resolveConfigDir(),
      notesRoot,
      rootLabel: PROFILE_ROOT_LABEL,
    })
  })
}