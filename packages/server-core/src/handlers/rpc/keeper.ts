/**
 * ROX Keeper RPC surface (personal secret vault).
 *
 * Every handler runs in the main process. The renderer receives masked views
 * (`password: null`) and can only obtain a secret through an explicit, single
 * `keeper:reveal`. Browser password approval/sealing still happens in the
 * browser-import handlers; here we only reopen the already sealed workspace
 * envelope and map its rows into keeper items, keeping the envelope intact.
 */
import { createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import {
  createKeeperStore,
  KEEPER_BROWSER_IMPORT_FOLDER,
  KEEPER_ERROR,
  KeeperError,
  type BrowserCredentialRecord,
  type KeeperCreateRequest,
  type KeeperImportResult,
  type KeeperItemView,
  type KeeperRevealResult,
  type KeeperSafeStorage,
  type KeeperUnlockStatus,
  type KeeperUpdateRequest,
  type KeeperVaultSnapshot,
} from '@rox/shared/keeper'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const KEEPER_CHANNELS = [
  RPC_CHANNELS.keeper.LIST,
  RPC_CHANNELS.keeper.GET,
  RPC_CHANNELS.keeper.CREATE,
  RPC_CHANNELS.keeper.UPDATE,
  RPC_CHANNELS.keeper.DELETE,
  RPC_CHANNELS.keeper.REVEAL,
  RPC_CHANNELS.keeper.UNLOCK_STATUS,
  RPC_CHANNELS.keeper.IMPORT_BROWSER,
] as const

const DEFAULT_SCOPE = 'personal'
const MAX_SEALED_ENVELOPE_BYTES = 64 * 1024 * 1024

export interface KeeperRuntime {
  /** `<configDir>/keeper` — one sub-directory per scope. */
  directory: string
  safeStorage: KeeperSafeStorage
  platform?: NodeJS.Platform
  workspaceFor?: (id: string) => { id: string; rootPath: string } | null
  /** Reads the OS-wrapped key for the sealed browser credential envelope. */
  readBrowserCredentialKey?: (reference: string) => Buffer | null
}

interface SealedEnvelope {
  version: number
  format: string
  cipher: string
  iv: string
  tag: string
  data: string
}

interface DecryptedEnvelope {
  version: number
  profileId?: string
  credentials?: unknown
}

function isSealedEnvelope(value: unknown): value is SealedEnvelope {
  if (!value || typeof value !== 'object') return false
  const sealed = value as Record<string, unknown>
  return sealed.format === 'rox-browser-credentials' && sealed.cipher === 'aes-256-gcm'
    && typeof sealed.iv === 'string' && typeof sealed.tag === 'string' && typeof sealed.data === 'string'
}

/** Decrypt the sealed browser credential envelope; never surfaces crypto diagnostics. */
export function openBrowserCredentialEnvelope(sealedText: string, key: Buffer): { profileId: string; records: BrowserCredentialRecord[] } {
  try {
    const raw: unknown = JSON.parse(sealedText)
    if (!isSealedEnvelope(raw) || key.length !== 32) throw new Error('bad envelope')
    const iv = Buffer.from(raw.iv, 'base64')
    const tag = Buffer.from(raw.tag, 'base64')
    const data = Buffer.from(raw.data, 'base64')
    if (iv.length !== 12 || tag.length !== 16 || data.length > MAX_SEALED_ENVELOPE_BYTES) throw new Error('bad envelope')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    const decoded = JSON.parse(plaintext) as DecryptedEnvelope
    if (!Array.isArray(decoded.credentials)) throw new Error('bad payload')
    const records: BrowserCredentialRecord[] = []
    for (const entry of decoded.credentials) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      if (typeof row.origin !== 'string' || typeof row.username !== 'string' || typeof row.password !== 'string') continue
      records.push({
        origin: row.origin,
        username: row.username,
        password: row.password,
        ...(typeof row.action === 'string' ? { action: row.action } : {}),
        ...(typeof row.realm === 'string' ? { realm: row.realm } : {}),
      })
    }
    return { profileId: typeof decoded.profileId === 'string' ? decoded.profileId : '', records }
  } catch {
    throw new KeeperError(KEEPER_ERROR.browserImportUnavailable)
  }
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

export function registerKeeperRpcHandlers(server: RpcServer, _deps: HandlerDeps, runtime: KeeperRuntime): void {
  const platform = runtime.platform ?? process.platform
  const workspaceFor = runtime.workspaceFor ?? getWorkspaceByNameOrId

  const storeFor = (scope: string) => createKeeperStore({
    directory: runtime.directory,
    safeStorage: runtime.safeStorage,
    platform,
    scope,
  })
  const scopeOf = (workspaceId: string | null) => workspaceId ?? DEFAULT_SCOPE

  server.handle(RPC_CHANNELS.keeper.UNLOCK_STATUS, (ctx): KeeperUnlockStatus => storeFor(scopeOf(ctx.workspaceId)).status(), { access: 'localElectron' })

  server.handle(RPC_CHANNELS.keeper.LIST, (ctx): KeeperVaultSnapshot => storeFor(scopeOf(ctx.workspaceId)).snapshot(), { access: 'localElectron' })

  server.handle(RPC_CHANNELS.keeper.GET, (ctx, id: unknown): KeeperItemView => {
    if (typeof id !== 'string' || !id) throw new KeeperError(KEEPER_ERROR.invalid)
    return storeFor(scopeOf(ctx.workspaceId)).getItemView(id)
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.keeper.CREATE, (ctx, request: unknown): KeeperItemView => {
    const body = request as KeeperCreateRequest | undefined
    if (!body || typeof body !== 'object' || !('item' in body)) throw new KeeperError(KEEPER_ERROR.invalid)
    return storeFor(scopeOf(ctx.workspaceId)).createItem(body.item)
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.keeper.UPDATE, (ctx, request: unknown): KeeperItemView => {
    const body = request as KeeperUpdateRequest | undefined
    if (!body || typeof body.id !== 'string' || !body.id) throw new KeeperError(KEEPER_ERROR.invalid)
    return storeFor(scopeOf(ctx.workspaceId)).updateItem(body.id, body.patch)
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.keeper.DELETE, (ctx, id: unknown): { id: string } => {
    if (typeof id !== 'string' || !id) throw new KeeperError(KEEPER_ERROR.invalid)
    return storeFor(scopeOf(ctx.workspaceId)).deleteItem(id)
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.keeper.REVEAL, (ctx, request: unknown): KeeperRevealResult => {
    const body = request as { id?: unknown; field?: unknown } | undefined
    if (!body || typeof body.id !== 'string' || !body.id) throw new KeeperError(KEEPER_ERROR.invalid)
    const field = body.field === 'totpSecret' ? 'totpSecret' : 'password'
    return storeFor(scopeOf(ctx.workspaceId)).reveal(body.id, field)
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.keeper.IMPORT_BROWSER, (ctx, request: unknown): KeeperImportResult => {
    const workspaceId = ctx.workspaceId ?? (request as { workspaceId?: unknown } | undefined)?.workspaceId
    if (typeof workspaceId !== 'string' || !workspaceId) throw new KeeperError(KEEPER_ERROR.browserImportUnavailable)
    const workspace = workspaceFor(workspaceId)
    if (!workspace) throw new KeeperError(KEEPER_ERROR.browserImportUnavailable)
    const index = readJsonFile(join(workspace.rootPath, 'browser', 'profile-index.json'))
    const reference = index && typeof index === 'object' ? (index as { credentialKeyRef?: unknown }).credentialKeyRef : undefined
    if (typeof reference !== 'string' || !reference || !runtime.readBrowserCredentialKey) {
      throw new KeeperError(KEEPER_ERROR.browserImportUnavailable)
    }
    const key = runtime.readBrowserCredentialKey(reference)
    if (!key) throw new KeeperError(KEEPER_ERROR.browserImportUnavailable)
    const sealedText = readFileSync(join(workspace.rootPath, 'browser', 'credential-vault.json'), 'utf8')
    const { profileId, records } = openBrowserCredentialEnvelope(sealedText, key)
    if (records.length === 0) return { added: 0, updated: 0, skipped: 0, folder: KEEPER_BROWSER_IMPORT_FOLDER }
    return storeFor(scopeOf(workspaceId)).importBrowserRecords(records, { profileId })
  }, { access: 'localElectron' })
}