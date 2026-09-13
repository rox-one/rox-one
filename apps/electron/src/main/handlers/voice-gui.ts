import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { loadVoicePrefs, type VoiceCommandAction } from '@craft-agent/shared/voice'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import { parseVoiceOverlayState } from '../../shared/voice-overlay-ipc'
import { rebindVoiceHotkeys, sendVoiceCommand } from '../voice-hotkeys'
import { registerVoiceOverlayIpc, setVoiceOverlayVisible } from '../voice-overlay'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.voice.SET_OVERLAY,
  RPC_CHANNELS.voice.REBIND_HOTKEYS,
  RPC_CHANNELS.voice.COMMAND,
] as const

const ACTIONS: readonly VoiceCommandAction[] = ['toggle', 'ptt-down', 'ptt-up', 'cancel']

export function registerVoiceGuiHandlers(server: RpcServer, _deps: HandlerDeps): void {
  registerVoiceOverlayIpc()

  server.handle(RPC_CHANNELS.voice.SET_OVERLAY, async (_ctx, payload: unknown) => {
    const prefs = loadVoicePrefs()
    const parsed = parseVoiceOverlayState(payload)
    const visible = parsed.visible && prefs.overlayEnabled
    await setVoiceOverlayVisible(visible, parsed)
    return { ok: true, visible }
  })

  server.handle(RPC_CHANNELS.voice.REBIND_HOTKEYS, async () => {
    return rebindVoiceHotkeys(loadVoicePrefs())
  })

  server.handle(RPC_CHANNELS.voice.COMMAND, async (_ctx, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const action = ACTIONS.includes(body.action as VoiceCommandAction)
      ? body.action as VoiceCommandAction
      : null
    if (!action) throw new Error('Unknown voice command')
    sendVoiceCommand({ action })
    return { ok: true }
  })
}
