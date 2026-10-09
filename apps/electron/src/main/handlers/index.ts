import type { HandlerDeps } from './handler-deps'
import type { RpcServer } from '@rox/server-core/transport'
import { registerCoreRpcHandlers, type ServerHandlerContext } from '@rox/server-core/handlers/rpc'
export { registerCoreRpcHandlers }

// GUI-only handlers remain local (Electron-specific imports)
import { registerVoiceClipboardGuiHandlers } from './voice-clipboard'
import { registerSystemGuiHandlers } from './system'
import { registerWorkspaceGuiHandlers } from './workspace'
import { registerBrowserHandlers } from './browser'
import { registerBrowserIntelHandlers } from './browser-intel'
import { registerSettingsGuiHandlers } from './settings'
import { registerSiyuanHandlers } from './siyuan'
import { registerExtensionHostHandlers } from './extension-host'
import { registerExtensionSurfaceHandlers } from './extension-surface'
import { registerClipboardHistoryGuiHandlers } from './clipboard-history'
import { registerKeeperGuiHandlers } from '../keeper/register'
export { startClipboardMonitor } from './clipboard-history'
import { setGithubUserToolHost } from '@rox/shared/connections'
import { createGithubEnvImportHost, registerWorkGraphHandlers } from './workgraph'
import { createGithubTokenResolver } from './github-token-resolver'
import type { WorkGraphKernel } from '@rox/server-core/workgraph'

export function registerGuiRpcHandlers(server: RpcServer, deps: HandlerDeps): void {
  registerSystemGuiHandlers(server, deps)
  registerVoiceClipboardGuiHandlers(server, deps)
  registerWorkspaceGuiHandlers(server, deps)
  registerBrowserHandlers(server, deps)
  registerBrowserIntelHandlers(server, deps)
  registerSettingsGuiHandlers(server, deps)
  registerSiyuanHandlers(server, deps)
  registerExtensionHostHandlers(server, deps)
  registerExtensionSurfaceHandlers(server, deps)
  registerClipboardHistoryGuiHandlers(server, deps)
  registerKeeperGuiHandlers(server, deps)
}

export function registerAllRpcHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  serverCtx?: ServerHandlerContext,
  workGraph?: WorkGraphKernel,
): void {
  // The credential fabric is created here (not in core) so the Dev Space clone
  // path can resolve a workspace GitHub token through the same broker/provider.
  const fabric = workGraph ? createGithubEnvImportHost() : undefined
  // GUI registers its own browser-pane handlers (see ./browser) — they are a
  // superset of the core ones plus window-stamping and the empty-state LAUNCH
  // channel. Registering both copies makes the RpcServer throw on duplicate
  // channels and the app fails to boot.
  registerCoreRpcHandlers(server, deps, serverCtx, {
    browserPane: false,
    ...(workGraph && fabric
      ? { devSpace: { resolveGithubToken: createGithubTokenResolver({ kernel: workGraph, broker: fabric.broker }) } }
      : {}),
  })
  registerGuiRpcHandlers(server, deps)
  if (workGraph && fabric) {
    registerWorkGraphHandlers(server, workGraph, fabric)
    setGithubUserToolHost({
      getKernel: () => workGraph,
      getBroker: () => fabric.broker,
      getProvider: () => fabric.provider,
      fetchImpl: fabric.fetchImpl,
    })
  }
}
