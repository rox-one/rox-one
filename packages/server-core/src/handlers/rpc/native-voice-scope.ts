import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { NativeAuthority, NativeAuthorityAction } from '../../authority/native-authority'
import type { RequestContext, RpcServer } from '../../transport'

type VoiceAction = Exclude<NativeAuthorityAction, 'manage'>

/** Names are derived only from the verified server principal, never RPC arguments. */
export function nativeVoiceDirectory(configDir: string, context: RequestContext): string {
  if (!context.principal) return configDir
  const identity = createHash('sha256').update(JSON.stringify([
    'rox-private-voice-v1', context.principal.issuer, context.principal.subject,
  ])).digest('hex')
  const parent = join(configDir, 'voice-users')
  privateDirectory(parent)
  const directory = join(parent, identity)
  privateDirectory(directory)
  return directory
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Private voice storage is unavailable')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Private voice storage is unavailable')
  chmodSync(path, 0o700)
}

/** Legacy stores inherit umask; make every newly created actor file private. */
export function secureNativeVoiceDirectory(directory: string, context: RequestContext): void {
  if (!context.principal || !existsSync(directory)) return
  const walk = (path: string) => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new Error('Private voice storage is unavailable')
    }
    if (stat.isDirectory()) {
      chmodSync(path, 0o700)
      for (const entry of readdirSync(path)) walk(join(path, entry))
    } else if (stat.isFile()) chmodSync(path, 0o600)
    else throw new Error('Private voice storage is unavailable')
  }
  walk(directory)
}

/** A revoke and regrant cannot make an already running audio request current again. */
export function voiceRequestFence(
  server: RpcServer,
  authority: NativeAuthority | undefined,
  context: RequestContext,
  action: VoiceAction,
): () => void {
  const principal = context.principal
  const workspace = context.workspaceId
  const read = principal && workspace ? authority?.permissionFence(principal, workspace, 'read') : undefined
  const permission = principal && workspace ? authority?.permissionFence(principal, workspace, action) : undefined
  const assertCurrent = () => {
    if (principal && (!workspace || !authority || !read || !permission
      || authority.permissionFence(principal, workspace, 'read') !== read
      || authority.permissionFence(principal, workspace, action) !== permission)) {
      throw new Error('Voice access was revoked')
    }
    if (server.isRequestContextCurrent && !server.isRequestContextCurrent(context, action)) {
      throw new Error('Voice client is no longer connected or authorized')
    }
  }
  assertCurrent()
  return assertCurrent
}
