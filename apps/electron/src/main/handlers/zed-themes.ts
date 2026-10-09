/**
 * DISPATCH C1 — Zed theme import GUI handlers (LOCAL_ONLY).
 *
 * The scanner reads the host's installed Zed and the importer writes the local
 * theme catalog; both are device-local filesystem work, never remote-eligible.
 */

import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { ZedThemeImportRequest } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import { scanZedThemes, importZedTheme } from '../zed-themes-import'
import type { HandlerDeps } from './handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.zedThemes.LIST,
  RPC_CHANNELS.zedThemes.IMPORT,
] as const

export function registerZedThemesHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.zedThemes.LIST, async () => scanZedThemes())
  server.handle(RPC_CHANNELS.zedThemes.IMPORT, async (_ctx, request: ZedThemeImportRequest) => importZedTheme(request))
}