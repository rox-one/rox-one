import { strict as assert } from 'node:assert'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthority } from '../../../authority/native-authority'
import { WsRpcServer } from '../../../transport/server'
import { WsRpcClient } from '../../../transport/client'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { registerVoiceHandlers } from '../voice'
import type { NativeVoiceOverlayHost } from '../../voice-overlay-host'
import type { HandlerDeps } from '../../handler-deps'

const root = process.env.ROX_CONFIG_DIR!
const authority = new NativeAuthority({ stateDir: join(root, 'authority') })
const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let administrator: ReturnType<NativeAuthority['bootstrapLocalAdministrator']>
try { Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }); administrator = authority.bootstrapLocalAdministrator('overlay-test-owner') }
finally { if (tty) Object.defineProperty(process.stdin, 'isTTY', tty); else Reflect.deleteProperty(process.stdin, 'isTTY') }
const workspace = join(root, 'workspace'); mkdirSync(workspace)
authority.registerWorkspace(administrator.credential, 'workspace', workspace)
const enrolled = authority.redeemEnrollment(authority.issueEnrollment(administrator.credential, 'overlay-test-device', Date.now() + 60_000), 'overlay-test-device')!
authority.grantWorkspace(administrator.credential, enrolled.principal.subject, 'workspace', ['read', 'write', 'subscribe'])
const published: Parameters<NativeVoiceOverlayHost['publish']>[0][] = [], retired: string[] = []
const server = new WsRpcServer({ port: 0, requireAuth: true, nativeAuthority: authority,
  nativeEventChannels: new Set([RPC_CHANNELS.voice.JOB, RPC_CHANNELS.voice.OVERLAY]),
  resolveLocalClientBinding: candidate => candidate.localClientProof === 'synthetic-server-verified-proof' ? { workspaceId: 'workspace', webContentsId: 19 } : null,
})
registerVoiceHandlers(server, { nativeData: { authority }, voiceOverlay: {
  publish(input) { input.assertCurrent(); published.push(input) }, retire(clientId) { retired.push(clientId) },
} } as HandlerDeps, { configDir: root })
await server.listen()
// The new seam uses production client timeouts. Existing native fixture's 500ms/2s/20s controls remain unchanged.
const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token: enrolled.credential, workspaceId: 'workspace',
  localClientProof: 'synthetic-server-verified-proof', webContentsId: 19, mode: 'local', autoReconnect: false })
try {
  client.connect()
  const job = await client.invoke(RPC_CHANNELS.voice.START, { mimeType: 'audio/webm' })
  await client.invoke(RPC_CHANNELS.voice.GRANT)
  await client.invoke(RPC_CHANNELS.voice.CHUNK, { audioBase64: Buffer.from('synthetic private audio').toString('base64') })
  assert.deepEqual(published.map(input => input.state.phase), ['permission', 'recording', 'recording'])
  assert(published.every(input => input.context.webContentsId === 19 && input.context.workspaceId === 'workspace'
    && input.context.principal?.subject === enrolled.principal.subject && input.state.recordingId === job.recordingId))
  const owner = published[0]!
  authority.revokeWorkspaceGrant(administrator.credential, enrolled.principal.subject, 'workspace')
  assert(retired.includes(owner.context.clientId))
  assert.throws(owner.assertCurrent)
  const count = published.length
  await assert.rejects(client.invoke(RPC_CHANNELS.voice.CANCEL))
  assert.equal(published.length, count)
  console.log('authenticated overlay owner, actual capture phases, original local window binding and revoke retirement passed')
} finally { client.destroy(); await server.close(); authority.close() }
