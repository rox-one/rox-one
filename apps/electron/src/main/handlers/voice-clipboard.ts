import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from './handler-deps'

export const HANDLED_CHANNELS = [RPC_CHANNELS.voice.COPY_TEXT] as const

/** Explicit local delivery only; the transport proof and managed owner cannot be supplied in arguments. */
export function registerVoiceClipboardGuiHandlers(server: RpcServer, deps: HandlerDeps,
  // Electron 44 makes clipboard.writeText return a Promise in the main process;
  // await it so the copy completes before this RPC reports success.
  writeText: (text: string) => void = async text => { await require('electron').clipboard.writeText(text) }): void {
  server.handle(RPC_CHANNELS.voice.COPY_TEXT, async (context, payload: unknown) => {
    const text = payload && typeof payload === 'object' ? (payload as { text?: unknown }).text : undefined
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 1_000_000) throw new Error('A bounded transcript is required')
    const id = context.webContentsId
    const owner = id === null ? null : deps.windowManager?.getWindowByWebContentsId(id)
    if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed() || owner.webContents.id !== id
      || !context.workspaceId || deps.windowManager?.getWorkspaceForWindow(id!) !== context.workspaceId
      || (server.isRequestContextCurrent && !server.isRequestContextCurrent(context, 'write'))) throw new Error('Voice delivery owner is unavailable')
    await writeText(text)
    return { ok: true }
  }, { access: 'localElectron', nativeAction: 'write' })
}
