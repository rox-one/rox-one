/**
 * Browser Intelligence Pipeline handlers (local-only).
 *
 * Thin registry over `apps/electron/src/main/browser-intel`: every channel
 * reads or mutates this machine's browser-profile stores and the local pipeline
 * sandbox, so all are LOCAL_ONLY (routing.ts) and never proxied to a remote
 * server. SET_CONSENT/START_RUN/CANCEL_RUN additionally broadcast the resulting
 * state so open windows stay in sync; progress pushes are forwarded from the
 * process-global pipeline subscription.
 */

import { RPC_CHANNELS } from '@rox/shared/protocol'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import {
  cancelBrowserIntelRun,
  getBrowserIntelSlotsSnapshot,
  getBrowserIntelStateSnapshot,
  getBrowserIntelStatsSnapshot,
  onBrowserIntelEvent,
  setBrowserIntelConsentAndSync,
  startBrowserIntelRun,
} from '../browser-intel/index.ts'
import type { HandlerDeps } from './handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.browserIntel.GET_STATE,
  RPC_CHANNELS.browserIntel.SET_CONSENT,
  RPC_CHANNELS.browserIntel.GET_STATS,
  RPC_CHANNELS.browserIntel.GET_SLOTS,
  RPC_CHANNELS.browserIntel.START_RUN,
  RPC_CHANNELS.browserIntel.CANCEL_RUN,
] as const

export function registerBrowserIntelHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // The pipeline is process-global and single-flight, so one subscription
  // serves every window. Progress drives the live stage UI; state events cover
  // run completion (which the mutating handlers below cannot observe).
  onBrowserIntelEvent(event => {
    if (event.type === 'progress') {
      pushTyped(server, RPC_CHANNELS.browserIntel.PROGRESS, { to: 'all' }, event.progress)
    } else {
      pushTyped(server, RPC_CHANNELS.browserIntel.STATE_CHANGED, { to: 'all' }, event.state)
    }
  })

  server.handle(RPC_CHANNELS.browserIntel.GET_STATE, () => getBrowserIntelStateSnapshot(), {
    access: 'localElectron',
    nativeAction: 'read',
  })

  server.handle(RPC_CHANNELS.browserIntel.SET_CONSENT, async (_ctx, consent: boolean) => {
    const state = await setBrowserIntelConsentAndSync(consent === true)
    pushTyped(server, RPC_CHANNELS.browserIntel.STATE_CHANGED, { to: 'all' }, state)
    return state
  }, { access: 'localElectron', nativeAction: 'write' })

  server.handle(RPC_CHANNELS.browserIntel.GET_STATS, () => getBrowserIntelStatsSnapshot(), {
    access: 'localElectron',
    nativeAction: 'read',
  })

  server.handle(RPC_CHANNELS.browserIntel.GET_SLOTS, () => getBrowserIntelSlotsSnapshot(), {
    access: 'localElectron',
    nativeAction: 'read',
  })

  server.handle(RPC_CHANNELS.browserIntel.START_RUN, () => {
    const result = startBrowserIntelRun()
    pushTyped(server, RPC_CHANNELS.browserIntel.STATE_CHANGED, { to: 'all' }, getBrowserIntelStateSnapshot())
    return result
  }, { access: 'localElectron', nativeAction: 'write' })

  server.handle(RPC_CHANNELS.browserIntel.CANCEL_RUN, () => {
    const result = cancelBrowserIntelRun()
    pushTyped(server, RPC_CHANNELS.browserIntel.STATE_CHANGED, { to: 'all' }, getBrowserIntelStateSnapshot())
    return result
  }, { access: 'localElectron', nativeAction: 'write' })
}