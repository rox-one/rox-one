import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { importJWK, type JSONWebKeySet, type JWK } from 'jose'
import type { WorkspaceServerConfiguration } from './server.ts'
import type { VerifiedActorConfig } from './auth/verified-actor.ts'

export const MAX_CONFIGURATION_BYTES = 65536
export const MAX_TLS_MATERIAL_BYTES = 262144
export const DEFAULT_POOL_SIZE = 12
export const DEFAULT_SHUTDOWN_TIMEOUT_SECONDS = 30
const MAX_POOL_SIZE = 64
const MAX_PUBLIC_KEYS = 16
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost']
const PUBLIC_KEY_FIELDS = ['kty', 'kid', 'use', 'alg', 'key_ops', 'crv', 'x', 'y', 'n', 'e', 'x5c', 'x5t', 'x5t#S256']
const ALGORITHMS = ['EdDSA', 'RS256', 'PS256', 'ES256'] as const

export class ConfigurationError extends Error {
  constructor(readonly code: 'CONFIGURATION_UNAVAILABLE' | 'INVALID_CONFIGURATION') { super(code) }
}

export interface RuntimeConfiguration {
  readonly databaseUrl: string
  readonly poolSize: number
  readonly shutdownTimeoutSeconds: number
  readonly migrationsDirectory: string
  readonly workspace: Omit<WorkspaceServerConfiguration, 'database' | 'migrations' | 'requestLifecycle'>
}

/** Open the validated inode without following a leaf symlink; bound reads and reject concurrent mutation. */
export async function readProtectedFile(path: string, maxBytes: number): Promise<Buffer> {
  try {
    if (!isAbsolute(path)) throw new ConfigurationError('CONFIGURATION_UNAVAILABLE')
    const before = await lstat(path, { bigint: true })
    const owned = (info: typeof before) => info.isFile() && !info.isSymbolicLink() &&
      (info.mode & 0o7777n) === 0o600n && typeof process.getuid === 'function' && info.uid === BigInt(process.getuid())
    if (!owned(before) || before.size > BigInt(maxBytes)) throw new ConfigurationError('CONFIGURATION_UNAVAILABLE')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const opened = await file.stat({ bigint: true })
      if (!owned(opened) || opened.ino !== before.ino || opened.dev !== before.dev ||
          opened.size !== before.size || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) {
        throw new ConfigurationError('CONFIGURATION_UNAVAILABLE')
      }
      const bytes = Buffer.alloc(maxBytes + 1)
      let length = 0
      while (length < bytes.length) {
        const result = await file.read(bytes, length, bytes.length - length, length)
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      const after = await file.stat({ bigint: true })
      if (length > maxBytes || BigInt(length) !== opened.size || !owned(after) ||
          after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
        throw new ConfigurationError('CONFIGURATION_UNAVAILABLE')
      }
      return bytes.subarray(0, length)
    } finally { await file.close() }
  } catch { throw new ConfigurationError('CONFIGURATION_UNAVAILABLE') }
}

export function configurationRecord(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConfigurationError('INVALID_CONFIGURATION')
  const result = Object.fromEntries(Object.entries(value))
  if (Object.keys(result).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(result, key))) {
    throw new ConfigurationError('INVALID_CONFIGURATION')
  }
  return result
}

function text(value: unknown, maximum = 2048): string {
  if (typeof value !== 'string' || !value.length || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConfigurationError('INVALID_CONFIGURATION')
  }
  return value
}
function absolute(value: unknown): string {
  const path = text(value, 4096)
  if (!isAbsolute(path)) throw new ConfigurationError('INVALID_CONFIGURATION')
  return path
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new ConfigurationError('INVALID_CONFIGURATION')
  return value
}
function algorithm(value: unknown): VerifiedActorConfig['algorithms'][number] {
  if (typeof value !== 'string' || !ALGORITHMS.some(entry => entry === value)) throw new ConfigurationError('INVALID_CONFIGURATION')
  return value as VerifiedActorConfig['algorithms'][number]
}
async function publicJwks(value: unknown, algorithms: VerifiedActorConfig['algorithms']): Promise<JSONWebKeySet> {
  const input = configurationRecord(value, ['keys'])
  if (!Array.isArray(input.keys) || input.keys.length < 1 || input.keys.length > MAX_PUBLIC_KEYS) throw new ConfigurationError('INVALID_CONFIGURATION')
  const keys: JWK[] = []
  for (const entry of input.keys) {
    const key = configurationRecord(entry, PUBLIC_KEY_FIELDS, ['kty'])
    if (!['OKP', 'EC', 'RSA'].includes(text(key.kty))) throw new ConfigurationError('INVALID_CONFIGURATION')
    for (const [field, fieldValue] of Object.entries(key)) {
      if (field !== 'key_ops' && field !== 'x5c') text(fieldValue, 8192)
    }
    if (key.x5c !== undefined && (!Array.isArray(key.x5c) || !key.x5c.length || key.x5c.some(value => typeof value !== 'string' || !value.length))) {
      throw new ConfigurationError('INVALID_CONFIGURATION')
    }
    if (key.alg !== undefined) algorithm(key.alg)
    if (key.use !== undefined && key.use !== 'sig') throw new ConfigurationError('INVALID_CONFIGURATION')
    if (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify')) {
      throw new ConfigurationError('INVALID_CONFIGURATION')
    }
    // The external JWK port is structurally checked above and cryptographically imported below.
    const jwk = key as JWK
    const candidates = algorithms.filter(value => key.alg === undefined || key.alg === value)
    let usable = false
    for (const candidate of candidates) {
      try { await importJWK(jwk, candidate); usable = true; break } catch { /* Try the next explicitly configured algorithm. */ }
    }
    if (!usable) throw new ConfigurationError('INVALID_CONFIGURATION')
    keys.push(jwk)
  }
  return { keys }
}

export async function loadRuntimeConfiguration(path: string): Promise<RuntimeConfiguration> {
  const bytes = await readProtectedFile(path, MAX_CONFIGURATION_BYTES)
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const input = configurationRecord(parsed,
      ['schemaVersion', 'database', 'schema', 'serverId', 'listen', 'authentication', 'tls', 'migrationsDirectory', 'shutdownTimeoutSeconds'],
      ['schemaVersion', 'database', 'schema', 'serverId', 'listen', 'authentication'])
    if (input.schemaVersion !== 1) throw new ConfigurationError('INVALID_CONFIGURATION')
    const database = configurationRecord(input.database, ['url', 'poolSize'], ['url'])
    const databaseUrl = text(database.url, 8192)
    const databaseEndpoint = new URL(databaseUrl)
    if (!['postgres:', 'postgresql:'].includes(databaseEndpoint.protocol) || !databaseEndpoint.hostname ||
        databaseEndpoint.pathname.length < 2 || databaseEndpoint.hash) throw new ConfigurationError('INVALID_CONFIGURATION')
    const schema = text(input.schema, 63)
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new ConfigurationError('INVALID_CONFIGURATION')
    const serverId = text(input.serverId, 256)
    const listen = configurationRecord(input.listen, ['host', 'port'])
    const host = text(listen.host, 253)
    if (!/^[A-Za-z0-9.:_-]+$/.test(host)) throw new ConfigurationError('INVALID_CONFIGURATION')
    const port = integer(listen.port, 0, 65535)
    const auth = configurationRecord(input.authentication,
      ['mode', 'issuer', 'audience', 'algorithms', 'stateDirectory', 'checkoutDirectory', 'tokenLifetimeSeconds', 'keySource'],
      ['mode', 'issuer', 'audience', 'algorithms'])
    const issuer = text(auth.issuer)
    const audience = text(auth.audience)
    if (!Array.isArray(auth.algorithms) || !auth.algorithms.length) throw new ConfigurationError('INVALID_CONFIGURATION')
    const algorithms = auth.algorithms.map(algorithm)
    if (new Set(algorithms).size !== algorithms.length) throw new ConfigurationError('INVALID_CONFIGURATION')
    let authentication: RuntimeConfiguration['workspace']['authentication']
    if (auth.mode === 'local-bootstrap') {
      if (algorithms.length !== 1 || algorithms[0] !== 'EdDSA' || auth.keySource !== undefined) throw new ConfigurationError('INVALID_CONFIGURATION')
      authentication = { mode: 'local-bootstrap', configuration: {
        mode: 'local-bootstrap', issuer, audience,
        stateDirectory: absolute(auth.stateDirectory), checkoutDirectory: absolute(auth.checkoutDirectory),
        ...(auth.tokenLifetimeSeconds === undefined ? {} : { tokenLifetimeSeconds: integer(auth.tokenLifetimeSeconds, 1, 900) }),
      } }
    } else if (auth.mode === 'trusted-issuer') {
      if (auth.stateDirectory !== undefined || auth.checkoutDirectory !== undefined || auth.tokenLifetimeSeconds !== undefined) throw new ConfigurationError('INVALID_CONFIGURATION')
      const source = configurationRecord(auth.keySource, ['jwks', 'jwksUri', 'allowLoopbackHttp'], [])
      let keySource: VerifiedActorConfig['keySource']
      if (source.jwks !== undefined && source.jwksUri === undefined && source.allowLoopbackHttp === undefined) {
        keySource = { jwks: await publicJwks(source.jwks, algorithms) }
      } else if (source.jwksUri !== undefined && source.jwks === undefined) {
        const url = new URL(text(source.jwksUri, 8192))
        if (source.allowLoopbackHttp !== undefined && typeof source.allowLoopbackHttp !== 'boolean') throw new ConfigurationError('INVALID_CONFIGURATION')
        if (url.username || url.password || url.hash || (url.protocol !== 'https:' &&
            !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) && source.allowLoopbackHttp === true))) {
          throw new ConfigurationError('INVALID_CONFIGURATION')
        }
        keySource = { jwksUri: url, allowLoopbackHttp: source.allowLoopbackHttp === true }
      } else throw new ConfigurationError('INVALID_CONFIGURATION')
      authentication = { mode: 'trusted-issuer', configuration: { issuer, audience, algorithms, keySource } }
    } else throw new ConfigurationError('INVALID_CONFIGURATION')
    let tls: RuntimeConfiguration['workspace']['tls']
    if (input.tls !== undefined) {
      const inputTls = configurationRecord(input.tls, ['certificateFile', 'keyFile', 'caFile', 'passphrase'], ['certificateFile', 'keyFile'])
      tls = {
        cert: await readProtectedFile(absolute(inputTls.certificateFile), MAX_TLS_MATERIAL_BYTES),
        key: await readProtectedFile(absolute(inputTls.keyFile), MAX_TLS_MATERIAL_BYTES),
        ...(inputTls.caFile === undefined ? {} : { ca: await readProtectedFile(absolute(inputTls.caFile), MAX_TLS_MATERIAL_BYTES) }),
        ...(inputTls.passphrase === undefined ? {} : { passphrase: text(inputTls.passphrase, 4096) }),
      }
    }
    if (!LOOPBACK_HOSTS.includes(host) && !tls) throw new ConfigurationError('INVALID_CONFIGURATION')
    return {
      databaseUrl,
      poolSize: database.poolSize === undefined ? DEFAULT_POOL_SIZE : integer(database.poolSize, 1, MAX_POOL_SIZE),
      shutdownTimeoutSeconds: input.shutdownTimeoutSeconds === undefined ? DEFAULT_SHUTDOWN_TIMEOUT_SECONDS : integer(input.shutdownTimeoutSeconds, 1, 300),
      migrationsDirectory: input.migrationsDirectory === undefined ? resolve(import.meta.dir, '../migrations') : absolute(input.migrationsDirectory),
      workspace: { schema, serverId, host, port, authentication, ...(tls ? { tls } : {}) },
    }
  } catch (error) {
    if (error instanceof ConfigurationError) throw error
    throw new ConfigurationError('INVALID_CONFIGURATION')
  }
}
