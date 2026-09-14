import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  acceptContextDocTemplate,
  deleteContextDoc,
  ensureContextDocs,
  keepMineContextDocTemplate,
  listContextDocs,
  readContextDoc,
  readContextDocTemplate,
  writeContextDoc,
} from '@craft-agent/shared/context-docs'
import { resolveConfigDir } from "@craft-agent/shared/config/paths"
import {
  isClaimableLive,
  rpcContextDocsActResult,
  rpcContextDocsListResult,
  rpcContextDocsReadResult,
} from '@craft-agent/core/rox2'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.contextDocs.LIST,
  RPC_CHANNELS.contextDocs.READ,
  RPC_CHANNELS.contextDocs.WRITE,
  RPC_CHANNELS.contextDocs.DELETE,
  RPC_CHANNELS.contextDocs.READ_TEMPLATE,
  RPC_CHANNELS.contextDocs.ACCEPT_TEMPLATE,
  RPC_CHANNELS.contextDocs.KEEP_MINE_TEMPLATE,
] as const

/**
 * Runtime context documents (soul.md, rules.md, user-added *.md in
 * <CONFIG_DIR>/context/). LOCAL_ONLY — the docs live next to the local
 * config dir and are edited from the Context settings tab.
 */
export function registerContextDocsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // Seed bundled templates (resources/context/*.md) once per server boot.
  // Runs here (not only in electron main) so headless servers get the same
  // seeding; existing user files are never overwritten by the seed.
  try {
    ensureContextDocs()
  } catch (error) {
    console.error('[context-docs] Seeding failed:', error)
  }

  server.handle(RPC_CHANNELS.contextDocs.LIST, async () => {
    const listed = rpcContextDocsListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    return listContextDocs()
  })

  server.handle(RPC_CHANNELS.contextDocs.READ, async (_ctx, filename: string) => {
    const read = rpcContextDocsReadResult({ source: 'native', nativeId: filename })
    if (!isClaimableLive(read.result)) throw new Error('context doc is not live')
    return readContextDoc(filename)
  })

  server.handle(RPC_CHANNELS.contextDocs.WRITE, async (_ctx, filename: string, content: string) => {
    const act = rpcContextDocsActResult({ source: 'native', action: 'write', nativeId: filename })
    if (!isClaimableLive(act)) throw new Error('context doc write is not live')
    const info = writeContextDoc(filename, content)
    pushTyped(server, RPC_CHANNELS.contextDocs.CHANGED, { to: 'all' })
    return info
  })

  server.handle(RPC_CHANNELS.contextDocs.DELETE, async (_ctx, filename: string) => {
    const act = rpcContextDocsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: filename })
    if (!isClaimableLive(act)) throw new Error('context doc destroy is not live')
    deleteContextDoc(filename)
    pushTyped(server, RPC_CHANNELS.contextDocs.CHANGED, { to: 'all' })
  })

  server.handle(RPC_CHANNELS.contextDocs.READ_TEMPLATE, async (_ctx, filename: string) => {
    const read = rpcContextDocsReadResult({ source: 'native', nativeId: filename })
    if (!isClaimableLive(read.result)) throw new Error('context doc template is not live')
    return readContextDocTemplate(filename)
  })

  server.handle(RPC_CHANNELS.contextDocs.ACCEPT_TEMPLATE, async (_ctx, filename: string) => {
    const act = rpcContextDocsActResult({ source: 'native', action: 'write', nativeId: filename })
    if (!isClaimableLive(act)) throw new Error('context doc template write is not live')
    const info = acceptContextDocTemplate(filename)
    pushTyped(server, RPC_CHANNELS.contextDocs.CHANGED, { to: 'all' })
    return info
  })

  server.handle(RPC_CHANNELS.contextDocs.KEEP_MINE_TEMPLATE, async (_ctx, filename: string) => {
    const act = rpcContextDocsActResult({ source: 'native', action: 'write', nativeId: filename })
    if (!isClaimableLive(act)) throw new Error('context doc template write is not live')
    const info = keepMineContextDocTemplate(filename)
    pushTyped(server, RPC_CHANNELS.contextDocs.CHANGED, { to: 'all' })
    return info
  })
}