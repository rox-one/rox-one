/**
 * Environment questionnaire RPC — local prefs for onboarding and Settings.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  loadEnvironmentPrefs,
  pendingQuestionIds,
  saveEnvironmentPrefs,
  type EnvironmentPrefs,
} from '@craft-agent/shared/environment'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.environment.GET,
  RPC_CHANNELS.environment.SAVE,
] as const

export type EnvironmentSetupDto = {
  prefs: EnvironmentPrefs
  pendingQuestionIds: ReturnType<typeof pendingQuestionIds>
}

function toDto(prefs: EnvironmentPrefs): EnvironmentSetupDto {
  return {
    prefs,
    pendingQuestionIds: pendingQuestionIds(prefs),
  }
}

function broadcast(server: RpcServer, prefs: EnvironmentPrefs): void {
  pushTyped(server, RPC_CHANNELS.environment.CHANGED, { to: 'all' }, prefs)
}

export function registerEnvironmentHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.environment.GET, async () => {
    return toDto(loadEnvironmentPrefs())
  })

  server.handle(RPC_CHANNELS.environment.SAVE, async (_ctx, patch: unknown) => {
    const next = saveEnvironmentPrefs(
      (patch && typeof patch === 'object' ? patch : {}) as Partial<EnvironmentPrefs> & {
        completeQuestionnaire?: boolean
      },
    )
    broadcast(server, next)
    return toDto(next)
  })
}
