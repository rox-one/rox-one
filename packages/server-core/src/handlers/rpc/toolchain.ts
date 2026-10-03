import { getToolchainManager, setToolchainDisabledTools } from '@rox/shared/toolchain-runtime'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import { isToolName, type ToolName, type ToolStatus } from '@rox/shared/toolchain'
import type { RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcToolchainActResult,
  rpcToolchainListResult,
  rpcToolchainReadResult,
} from '@rox/core/rox2'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.toolchain.STATUS,
  RPC_CHANNELS.toolchain.UPDATE,
  RPC_CHANNELS.toolchain.GET_DISABLED,
  RPC_CHANNELS.toolchain.SET_DISABLED,
] as const

export function registerToolchainHandlers(server: RpcServer, _deps: HandlerDeps): void {
  const nativeSubscribers = new Map<string, RequestContext>()
  const safeStatus = (status: ToolStatus): ToolStatus => ({ name: status.name, phase: status.phase,
    tier: status.tier, installedVersion: status.installedVersion,
    downloadedBytes: status.downloadedBytes, totalBytes: status.totalBytes,
    error: status.error ? 'RUNTIME_UNAVAILABLE' : undefined })
  const unsubscribeDisconnect = server.onClientDisconnect?.(clientId => nativeSubscribers.delete(clientId))
  // Snapshot of per-tool statuses (no side effects).
  server.handle(RPC_CHANNELS.toolchain.STATUS, async (ctx) => {
    const listed = rpcToolchainListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('toolchain status is not live')
    const status = await getToolchainManager().status()
    if (ctx.principal) {
      if (!server.isRequestContextCurrent?.(ctx, 'read')) throw new CodedError('AUTH_FAILED', 'Runtime status scope changed')
      nativeSubscribers.set(ctx.clientId, ctx)
      return status.map(safeStatus)
    }
    return status
  }, { nativeAction: 'read' })

  // Force update of a single tool.
  server.handle(RPC_CHANNELS.toolchain.UPDATE, async (ctx, name: ToolName) => {
    if (!isToolName(name)) throw new CodedError('HANDLER_ERROR', 'Unknown runtime tool')
    const act = rpcToolchainActResult({ source: 'native', action: 'write', nativeId: name })
    if (!isClaimableLive(act)) throw new Error('toolchain update is not live')
    const status = await getToolchainManager().update(name)
    return ctx.principal ? safeStatus(status) : status
  }, { access: 'localElectron', nativeAction: 'write' })

  // Disabled default-on tools (seeded from config toolchain.disabled).
  server.handle(RPC_CHANNELS.toolchain.GET_DISABLED, async () => {
    const read = rpcToolchainReadResult({ source: 'native', nativeId: 'disabled' })
    if (!isClaimableLive(read.result)) throw new Error('toolchain disabled list is not live')
    return getToolchainManager().getDisabledTools()
  }, { access: 'localElectron', nativeAction: 'read' })

  // Replace disabled list: persist config, sync live manager, restart background ensureAll
  // (вновь включённые default-on инструменты доустанавливаются; прогресс — через STATUS_CHANGED).
  server.handle(RPC_CHANNELS.toolchain.SET_DISABLED, async (_ctx, tools: ToolName[]) => {
    const act = rpcToolchainActResult({ source: 'native', action: 'write', nativeId: 'disabled' })
    if (!isClaimableLive(act)) throw new Error('toolchain set disabled is not live')
    const applied = setToolchainDisabledTools(Array.isArray(tools) ? tools : [])
    void getToolchainManager().ensureAll({ background: true })
    return applied
  }, { access: 'localElectron', nativeAction: 'write' })

  // Push install progress to every client (local toolchain — broadcast to all).
  const unsubscribeStatus = getToolchainManager().onStatusChange((status) => {
    server.push(RPC_CHANNELS.toolchain.STATUS_CHANGED, { to: 'all' }, status)
    for (const [clientId, ctx] of nativeSubscribers) {
      if (!server.isRequestContextCurrent?.(ctx, 'read')) { nativeSubscribers.delete(clientId); continue }
      server.push(RPC_CHANNELS.toolchain.STATUS_CHANGED, { to: 'client', clientId }, safeStatus(status))
    }
  })
  server.onShutdown?.(() => { unsubscribeDisconnect?.(); unsubscribeStatus(); nativeSubscribers.clear() })
}
