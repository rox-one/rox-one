import { getToolchainManager, setToolchainDisabledTools } from '@craft-agent/shared/toolchain-runtime'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { ToolName } from '@craft-agent/shared/toolchain'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcToolchainActResult,
  rpcToolchainListResult,
  rpcToolchainReadResult,
} from '@craft-agent/core/rox2'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.toolchain.STATUS,
  RPC_CHANNELS.toolchain.UPDATE,
  RPC_CHANNELS.toolchain.GET_DISABLED,
  RPC_CHANNELS.toolchain.SET_DISABLED,
] as const

export function registerToolchainHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // Snapshot of per-tool statuses (no side effects).
  server.handle(RPC_CHANNELS.toolchain.STATUS, async () => {
    const listed = rpcToolchainListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('toolchain status is not live')
    return getToolchainManager().status()
  })

  // Force update of a single tool.
  server.handle(RPC_CHANNELS.toolchain.UPDATE, async (_ctx, name: ToolName) => {
    const act = rpcToolchainActResult({ source: 'native', action: 'write', nativeId: name })
    if (!isClaimableLive(act)) throw new Error('toolchain update is not live')
    return getToolchainManager().update(name)
  })

  // Disabled default-on tools (seeded from config toolchain.disabled).
  server.handle(RPC_CHANNELS.toolchain.GET_DISABLED, async () => {
    const read = rpcToolchainReadResult({ source: 'native', nativeId: 'disabled' })
    if (!isClaimableLive(read.result)) throw new Error('toolchain disabled list is not live')
    return getToolchainManager().getDisabledTools()
  })

  // Replace disabled list: persist config, sync live manager, restart background ensureAll
  // (вновь включённые default-on инструменты доустанавливаются; прогресс — через STATUS_CHANGED).
  server.handle(RPC_CHANNELS.toolchain.SET_DISABLED, async (_ctx, tools: ToolName[]) => {
    const act = rpcToolchainActResult({ source: 'native', action: 'write', nativeId: 'disabled' })
    if (!isClaimableLive(act)) throw new Error('toolchain set disabled is not live')
    const applied = setToolchainDisabledTools(Array.isArray(tools) ? tools : [])
    void getToolchainManager().ensureAll({ background: true })
    return applied
  })

  // Push install progress to every client (local toolchain — broadcast to all).
  getToolchainManager().onStatusChange((status) => {
    server.push(RPC_CHANNELS.toolchain.STATUS_CHANGED, { to: 'all' }, status)
  })
}
