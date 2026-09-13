/**
 * Privacy RPC — consent ledger, export and deletion receipts.
 * State lives in CONFIG_DIR/privacy.json (user-scoped, not workspace).
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  completeDeletion,
  isConsentPurpose,
  loadPrivacyState,
  requestDeletion,
  requestExport,
  setPurpose,
  toPrivacyDto,
  type ConsentPurpose,
} from '@craft-agent/shared/privacy'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.privacy.GET,
  RPC_CHANNELS.privacy.SET_PURPOSE,
  RPC_CHANNELS.privacy.REQUEST_EXPORT,
  RPC_CHANNELS.privacy.REQUEST_DELETION,
  RPC_CHANNELS.privacy.COMPLETE_DELETION,
] as const

function broadcast(server: RpcServer, dto: ReturnType<typeof toPrivacyDto>): void {
  pushTyped(server, RPC_CHANNELS.privacy.CHANGED, { to: 'all' }, dto)
}

export function registerPrivacyHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.privacy.GET, async () => toPrivacyDto(loadPrivacyState()))

  server.handle(RPC_CHANNELS.privacy.SET_PURPOSE, async (_ctx, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('purpose payload required')
    const body = payload as { purpose?: unknown; granted?: unknown }
    if (typeof body.purpose !== 'string' || !isConsentPurpose(body.purpose)) {
      throw new Error(`Unknown consent purpose: ${String(body.purpose)}`)
    }
    const dto = toPrivacyDto(setPurpose(body.purpose as ConsentPurpose, body.granted === true))
    broadcast(server, dto)
    return dto
  })

  server.handle(RPC_CHANNELS.privacy.REQUEST_EXPORT, async () => {
    const { state, receipt } = requestExport()
    const dto = toPrivacyDto(state)
    broadcast(server, dto)
    return { ...dto, exportReceipt: receipt }
  })

  server.handle(RPC_CHANNELS.privacy.REQUEST_DELETION, async () => {
    const { state, receipt } = requestDeletion()
    const dto = toPrivacyDto(state)
    broadcast(server, dto)
    return { ...dto, deletionReceipt: receipt }
  })

  server.handle(RPC_CHANNELS.privacy.COMPLETE_DELETION, async (_ctx, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('deletion payload required')
    const body = payload as { deletionId?: unknown }
    if (typeof body.deletionId !== 'string' || !body.deletionId) {
      throw new Error('deletionId required')
    }
    const dto = toPrivacyDto(completeDeletion(body.deletionId))
    broadcast(server, dto)
    return dto
  })
}
