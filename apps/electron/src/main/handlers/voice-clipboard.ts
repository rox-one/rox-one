import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from './handler-deps'

export const HANDLED_CHANNELS = [RPC_CHANNELS.voice.COPY_TEXT] as const

/** Explicit local delivery only; the transport proof and managed owner cannot be supplied in arguments. */
export function registerVoiceClipboardGuiHandlers(server: RpcServer, deps: HandlerDeps,
  writeText: (text: string) => void = text => { require('electron').clipboard.writeText(text) }): void {
  server.handle(RPC_CHANNELS.voice.COPY_TEXT, (context, payload: unknown) => {
    const text = payload && typeof payload === 'object' ? (payload as { text?: unknown }).text : undefined
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 1_000_000) throw new Error('A bounded transcript is required')
    const id = context.webContentsId
    const owner = id === null ? null : deps.windowManager?.getWindowByWebContentsId(id)
    if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed() || owner.webContents.id !== id
      || !context.workspaceId || deps.windowManager?.getWorkspaceForWindow(id!) !== context.workspaceId
      || (server.isRequestContextCurrent && !server.isRequestContextCurrent(context, 'write'))) throw new Error('Voice delivery owner is unavailable')
    writeText(text)
    return { ok: true }
  }, { access: 'localElectron', nativeAction: 'write' })
}
