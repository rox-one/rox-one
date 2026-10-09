/**
 * Production HandlerDeps composition for the standalone headless server.
 *
 * Kept as an importable function (not inline in `index.ts`) so the composed
 * surface can be exercised end-to-end over a real `WsRpcServer` without booting
 * the whole process. `index.ts` is the only production caller.
 */

import type { HandlerDeps } from '@rox/server-core/handlers'
import type { SessionManager } from '@rox/server-core/sessions'
import { NodeRegistry } from '@rox/server-core/nodes'
import type { PlatformServices } from '@rox/server-core/runtime'
import type { OAuthFlowStore } from '@rox/shared/auth'

type NativeData = NonNullable<HandlerDeps['nativeData']>

export interface ServerHandlerDepsInput {
  sessionManager: SessionManager
  platform: PlatformServices
  oauthFlowStore: OAuthFlowStore
  /** Present on the real host; omitted by the node-surface test. */
  nativeAuthority?: NativeData['authority']
  nativeJournal?: NativeData['journal']
  collaborationSync?: NativeData['sync']
  browserPaneManager?: HandlerDeps['browserPaneManager']
  messagingRegistry?: HandlerDeps['messagingRegistry']
}

export function createServerHandlerDeps(input: ServerHandlerDepsInput): HandlerDeps {
  const learning = input.sessionManager.getLearningRpcService()
  const nativeData = input.nativeAuthority && input.nativeJournal && input.collaborationSync
    ? {
        authority: input.nativeAuthority,
        journal: input.nativeJournal,
        sync: input.collaborationSync,
      }
    : undefined
  return {
    sessionManager: input.sessionManager,
    platform: input.platform,
    oauthFlowStore: input.oauthFlowStore,
    browserPaneManager: input.browserPaneManager,
    messagingRegistry: input.messagingRegistry,
    ...(nativeData ? { nativeData } : {}),
    ...(learning ? { learning } : {}),
    // f.9 — server-owned node/device registry, composed with the registry's
    // default bounds. `nodes:*` handlers register only when this is present, so
    // omitting it makes the entire node surface answer CHANNEL_NOT_FOUND.
    nodes: new NodeRegistry(),
  }
}