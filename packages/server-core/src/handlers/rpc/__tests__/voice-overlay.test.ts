import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getDefaultVoicePrefs } from '@rox/shared/voice'
import { registerVoiceHandlers } from '../voice'
import type { NativeVoiceOverlayHost } from '../../voice-overlay-host'
import type { HandlerDeps } from '../../handler-deps'
import type { HandlerFn, RequestContext, RpcServer } from '../../../transport'

test('actual capture handlers publish only the current server context and retire disconnect/shutdown ownership', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rox-overlay-port-'))
  const handlers = new Map<string, HandlerFn>()
  const published: Parameters<NativeVoiceOverlayHost['publish']>[0][] = [], retired: string[] = []
  let valid = true; let disconnect: (id: string) => void = () => {}; let shutdown = () => {}
  const server = { handle: (key: string, handler: HandlerFn) => handlers.set(key, handler), push() {},
    isRequestContextCurrent: () => valid,
    onClientDisconnect(callback: typeof disconnect) { disconnect = callback; return () => {} },
    onShutdown(callback: typeof shutdown) { shutdown = callback; return () => {} },
  } as unknown as RpcServer
  registerVoiceHandlers(server, { voiceOverlay: { publish: value => published.push(value), retire: id => retired.push(id) } } as unknown as HandlerDeps,
    { configDir: directory, loadPrefs: () => ({ ...getDefaultVoicePrefs(), overlayPosition: 'top' }) })
  const context: RequestContext = { clientId: 'verified-original', workspaceId: 'workspace', webContentsId: 19 }
  try {
    const started = await handlers.get(RPC_CHANNELS.voice.START)!(context, {})
    expect(published[0]!.context).toBe(context)
    expect(published[0]!.state).toMatchObject({ recordingId: started.recordingId, phase: 'permission' })
    expect(published[0]!.position).toBe('top')
    await handlers.get(RPC_CHANNELS.voice.GRANT)!(context)
    await handlers.get(RPC_CHANNELS.voice.CHUNK)!(context, { audioBase64: Buffer.from('fixture-only').toString('base64') })
    expect(published.at(-1)!.state.phase).toBe('recording')
    valid = false
    expect(published[0]!.assertCurrent).toThrow('no longer connected')
    const count = published.length
    disconnect(context.clientId)
    expect(published).toHaveLength(count)
    expect(retired).toContain(context.clientId)
    valid = true
    await handlers.get(RPC_CHANNELS.voice.START)!(context, {})
    shutdown()
    expect(retired.filter(id => id === context.clientId)).toHaveLength(2)
  } finally { shutdown(); rmSync(directory, { recursive: true, force: true }) }
})
