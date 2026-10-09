/**
 * GUI wiring for ROX Keeper: points the vault store at the local config dir
 * and hands the server-core handlers the host's OS key custody plus a reader
 * for the sealed browser-credential envelope (used only by `keeper:importBrowser`).
 */
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { getConfigDir, getWorkspaceByNameOrId } from '@rox/shared/config'
import { registerKeeperRpcHandlers } from '@rox/server-core/handlers/rpc/keeper'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handlers/handler-deps'

/** The concrete key store exposes `readKey`; the host interface only declares write custody. */
interface BrowserCredentialKeyReader {
  readKey?: (reference: string) => Buffer | null
}

export function registerKeeperGuiHandlers(server: RpcServer, deps: HandlerDeps): void {
  const vaultKeys = deps.browserCredentials?.vaultKeys as BrowserCredentialKeyReader | undefined
  registerKeeperRpcHandlers(server, deps, {
    directory: join(getConfigDir(), 'keeper'),
    safeStorage,
    platform: process.platform,
    workspaceFor: (id) => getWorkspaceByNameOrId(id),
    readBrowserCredentialKey: (reference) => vaultKeys?.readKey?.(reference) ?? null,
  })
}