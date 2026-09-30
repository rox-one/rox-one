import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import {
  canonicalPageRef, contentEntityKey, contentOriginKey, decodeContentEntityRef,
  decodeDocumentDescriptor, isEntityOrigin, legacyDocumentDescriptor, legacyNoteAlias,
  sameContentIdentity,
  type ContentAuthority, type ContentEntityRef, type ContentKind, type DocumentDescriptor,
  type EntityOrigin,
} from '../../../core/src/docs/content-descriptor.ts'
import { contentHash } from '../../../core/src/rox2/notes-engine.ts'
import { parseRox2EntityId, type Rox2EntityRef } from '../../../core/src/rox2/platform-contract.ts'

/** Set by the authenticated server adapter, never copied from a request body. */
export type AuthenticatedContentContext = { actorPrincipalId: string }
export type SourceBinding = {
  workspaceId: string
  accountNamespace?: string
  sourceStoreId: string
  ownerPrincipalId?: string
  providerConnectionId?: string
  authorityEpoch: number
  authority: ContentAuthority
  contentKinds: readonly ContentKind[]
  /** Absent means the initial Markdown marker/export capabilities only. */
  markerVersions?: readonly number[]
  exportProfiles?: readonly string[]
  /** Set only after source policy authorizes local ownership or an offline lease. */
  offlineReadable?: boolean
  /** Actual owner's edit support; a descriptor cannot turn this on. */
  writable: boolean
}
export type ContentSnapshot = {
  ref: Rox2EntityRef
  nativeId: string
  title: string
  /** Exact content, used only in the response; never copied to the descriptor DB. */
  content: string
  revision: string
  freshness: 'live' | 'cached' | 'stale' | 'offline'
}
export interface ContentOwner {
  /** Server configured source selection, not a payload-supplied owner. */
  bindingFor(ref: Rox2EntityRef): SourceBinding | null | Promise<SourceBinding | null>
  read(ref: Rox2EntityRef, binding: SourceBinding): Promise<ContentSnapshot | null>
}
export type ContentAuthorization = { allowed: boolean; policyRevision: string; canWrite?: boolean }
export interface ContentPolicy {
  authorize(input: {
    context: AuthenticatedContentContext
    ref: Rox2EntityRef
    action: 'read' | 'adoptDescriptor'
    origin?: EntityOrigin
  }): ContentAuthorization | Promise<ContentAuthorization>
}

export type DescriptorReceipt = {
  status: 'committed'
  operationId: string
  idempotencyKey: string
  canonicalRef: ContentEntityRef
  revision: string
  descriptorRevision: number
  authorityEpoch: number
}
export type StoredDescriptor = {
  canonicalRef: ContentEntityRef
  ownerRef: Rox2EntityRef
  origin: EntityOrigin
  aliases: Rox2EntityRef[]
  /** Retained bytes, including future versions/unknown fields. */
  descriptorJson: string
  descriptorRevision: number
  commands: Array<{ actorPrincipalId: string; idempotencyKey: string; digest: string; receipt: DescriptorReceipt }>
}
export type DescriptorRegistry = { schemaVersion: 1; records: StoredDescriptor[] }
export interface DescriptorStore {
  read(): Promise<DescriptorRegistry>
  /** Descriptor, origin, aliases and idempotency receipt share one durable commit. */
  transaction<T>(run: (registry: DescriptorRegistry) => Promise<{ changed: boolean; value: T }>): Promise<T>
}

type FailureCode = 'validation' | 'conflict' | 'denied' | 'deleted' | 'missingDependency' | 'unknownFormat' | 'offlineUnsupported'
export type ContentFailure = { status: 'error'; code: FailureCode; currentRevision?: string; descriptorRevision?: number }
export type ContentResolution = {
  status: 'ok' | 'readOnly'
  code?: 'unknownFormat' | 'missingDependency' | 'validation'
  canonicalRef: ContentEntityRef
  legacyAlias: Rox2EntityRef
  ownerRef: Rox2EntityRef
  origin: EntityOrigin
  title: string
  content: string
  contentHash: string
  revision: string
  descriptorRevision: number | null
  descriptorState: 'inferredLegacy' | 'persisted'
  descriptor?: DocumentDescriptor
  preservedDescriptor?: string
  capabilities: { read: true; write: boolean; adoptDescriptor: boolean }
  freshness: ContentSnapshot['freshness']
  policyRevision: string
}
export type AdoptDescriptorCommand = {
  ref: unknown
  expectedRevision: string
  /** null is a CAS assertion that no descriptor has been installed yet. */
  expectedDescriptorRevision: number | null
  operationId: string
  idempotencyKey: string
  authorityEpoch: number
  descriptor: unknown
}

export class DescriptorStoreError extends Error {
  constructor(public readonly code: 'validation' | 'conflict' | 'missingDependency' | 'unknownFormat') {
    super(`Descriptor store ${code}`)
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function checksum(value: string): string { return createHash('sha256').update(value).digest('hex') }
function withoutRevision(ref: Rox2EntityRef): Rox2EntityRef {
  const { revisionId: _revision, ...identity } = ref
  return identity
}
function originFor(binding: SourceBinding, nativeId: string): EntityOrigin {
  return {
    sourceStoreId: binding.sourceStoreId, nativeId, authorityEpoch: binding.authorityEpoch,
    ...(binding.ownerPrincipalId === undefined ? {} : { ownerPrincipalId: binding.ownerPrincipalId }),
    ...(binding.providerConnectionId === undefined ? {} : { providerConnectionId: binding.providerConnectionId }),
  }
}
function entryFor(registry: DescriptorRegistry, ref: Rox2EntityRef): StoredDescriptor | undefined {
  return registry.records.find(entry => sameContentIdentity(entry.canonicalRef, ref)
    || entry.aliases.some(alias => sameContentIdentity(alias, ref)))
}

/** Fail closed on corrupt/colliding metadata. Never silently replace it with an empty DB. */
function validateRegistry(raw: unknown): asserts raw is DescriptorRegistry {
  if (plainRecord(raw) && typeof raw.schemaVersion === 'number' && Number.isSafeInteger(raw.schemaVersion) && raw.schemaVersion > 1) {
    throw new DescriptorStoreError('unknownFormat')
  }
  if (!plainRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.records)) {
    throw new DescriptorStoreError('validation')
  }
  const refs = new Map<string, string>()
  const origins = new Set<string>()
  for (const candidate of raw.records) {
    if (!plainRecord(candidate)) throw new DescriptorStoreError('validation')
    const canonical = decodeContentEntityRef(candidate.canonicalRef)
    const owner = decodeContentEntityRef(candidate.ownerRef)
    if (canonical.status !== 'ok' || owner.status !== 'ok'
      || !plainRecord(candidate.canonicalRef) || candidate.canonicalRef.version !== 2
      || parseRox2EntityId(canonical.ref.entityId).kind !== 'page'
      || !isEntityOrigin(candidate.origin)
      || !Array.isArray(candidate.aliases) || !Array.isArray(candidate.commands)
      || typeof candidate.descriptorJson !== 'string'
      || typeof candidate.descriptorRevision !== 'number' || !Number.isSafeInteger(candidate.descriptorRevision) || candidate.descriptorRevision < 1
      || !sameContentIdentity(canonicalPageRef(owner.ref), canonical.ref)
      || parseRox2EntityId(canonical.ref.entityId).id !== candidate.origin.nativeId) {
      throw new DescriptorStoreError('validation')
    }
    const canonicalKey = contentEntityKey(canonical.ref)
    const originKey = contentOriginKey(candidate.origin)
    if (origins.has(originKey)) throw new DescriptorStoreError('conflict')
    origins.add(originKey)
    // A duplicate canonical record is a collision even if its alias list is empty.
    if (refs.has(canonicalKey)) throw new DescriptorStoreError('conflict')
    refs.set(canonicalKey, canonicalKey)
    for (const alias of candidate.aliases) {
      const decoded = decodeContentEntityRef(alias)
      if (decoded.status !== 'ok' || !sameContentIdentity(canonicalPageRef(decoded.ref), canonical.ref)) {
        throw new DescriptorStoreError('validation')
      }
      const key = contentEntityKey(decoded.ref)
      if (refs.has(key) && refs.get(key) !== canonicalKey) throw new DescriptorStoreError('conflict')
      refs.set(key, canonicalKey)
    }
    const commandKeys = new Set<string>()
    for (const command of candidate.commands) {
      if (!plainRecord(command) || !text(command.actorPrincipalId) || !text(command.idempotencyKey)
        || !text(command.digest) || !plainRecord(command.receipt)) throw new DescriptorStoreError('validation')
      const receipt = command.receipt
      const key = JSON.stringify([command.actorPrincipalId, command.idempotencyKey])
      if (commandKeys.has(key) || receipt.status !== 'committed' || !text(receipt.operationId)
        || receipt.idempotencyKey !== command.idempotencyKey
        || !text(receipt.revision) || receipt.authorityEpoch !== candidate.origin.authorityEpoch
        || typeof receipt.descriptorRevision !== 'number' || !Number.isSafeInteger(receipt.descriptorRevision)
        || receipt.descriptorRevision < 1 || receipt.descriptorRevision > candidate.descriptorRevision) {
        throw new DescriptorStoreError('validation')
      }
      const receiptRef = decodeContentEntityRef(receipt.canonicalRef)
      if (receiptRef.status !== 'ok' || !sameContentIdentity(receiptRef.ref, canonical.ref)) throw new DescriptorStoreError('validation')
      commandKeys.add(key)
    }
  }
}

// All instances in the canonical server process serialize against the same path.
const fileTransactions = new Map<string, Promise<unknown>>()

/**
 * Metadata-only file storage for one canonical server process. Atomic rename
 * makes interrupted temporary files harmless. A separate process must not own
 * this path concurrently; the exclusive commit lock refuses concurrent writers.
 * A lock left by an interrupted process permits reads and fails writes closed
 * until recoverInterruptedCommit verifies its recorded process has stopped.
 */
export class FileDescriptorStore implements DescriptorStore {
  readonly path: string
  readonly trustedRoot: string
  constructor(path: string, options: { trustedRoot?: string } = {}) {
    this.path = resolve(path)
    this.trustedRoot = resolve(options.trustedRoot ?? dirname(this.path))
    const location = relative(this.trustedRoot, this.path)
    if (!location || location === '..' || location.startsWith(`..${sep}`) || resolve(this.trustedRoot, location) !== this.path) {
      throw new DescriptorStoreError('validation')
    }
  }

  /** A configured root is trusted; metadata descendants may never follow symlinks. */
  private async assertSafePath(): Promise<void> {
    const folders = [this.trustedRoot]
    const segments = relative(this.trustedRoot, dirname(this.path)).split(sep).filter(Boolean)
    for (const segment of segments) folders.push(resolve(folders[folders.length - 1]!, segment))
    for (const folder of folders) {
      try {
        const info = await lstat(folder)
        if (info.isSymbolicLink() || !info.isDirectory()) throw new DescriptorStoreError('validation')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error instanceof DescriptorStoreError ? error : new DescriptorStoreError('missingDependency')
      }
    }
    for (const file of [this.path, `${this.path}.lock`, `${this.path}.recovery.lock`]) {
      try {
        const info = await lstat(file)
        if (info.isSymbolicLink() || !info.isFile()) throw new DescriptorStoreError('validation')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error instanceof DescriptorStoreError ? error : new DescriptorStoreError('missingDependency')
        }
      }
    }
  }

  private async readBytes(path: string): Promise<string> {
    // NOFOLLOW also prevents the final component from being swapped to a symlink.
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { return await file.readFile('utf8') } finally { await file.close() }
  }

  async read(): Promise<DescriptorRegistry> {
    await this.assertSafePath()
    let bytes: string
    try { bytes = await this.readBytes(this.path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, records: [] }
      throw new DescriptorStoreError('missingDependency')
    }
    let raw: unknown
    try { raw = JSON.parse(bytes) } catch { throw new DescriptorStoreError('validation') }
    validateRegistry(raw)
    return raw
  }

  /** Server startup recovery only; never expose this as a client command. */
  async recoverInterruptedCommit(): Promise<'clean' | 'recovered'> {
    await this.assertSafePath()
    await mkdir(dirname(this.path), { recursive: true })
    await this.assertSafePath()
    let recovery
    try { recovery = await open(`${this.path}.recovery.lock`, 'wx', 0o600) } catch {
      throw new DescriptorStoreError('conflict')
    }
    try {
      let raw: unknown
      try { raw = JSON.parse(await this.readBytes(`${this.path}.lock`)) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'clean'
        throw new DescriptorStoreError('validation')
      }
      if (!plainRecord(raw) || !Number.isSafeInteger(raw.pid) || (raw.pid as number) < 1) throw new DescriptorStoreError('validation')
      try {
        process.kill(raw.pid as number, 0)
        throw new DescriptorStoreError('conflict')
      } catch (error) {
        // A live/inaccessible/reused PID is never proof that the owner stopped.
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new DescriptorStoreError('conflict')
      }
      await rm(`${this.path}.lock`)
      return 'recovered'
    } finally {
      await recovery.close()
      await rm(`${this.path}.recovery.lock`, { force: true })
    }
  }

  async transaction<T>(run: (registry: DescriptorRegistry) => Promise<{ changed: boolean; value: T }>): Promise<T> {
    const previous = fileTransactions.get(this.path) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(async () => {
      await this.assertSafePath()
      await mkdir(dirname(this.path), { recursive: true })
      await this.assertSafePath()
      let lock
      try { lock = await open(`${this.path}.lock`, 'wx', 0o600) } catch (error) {
        throw new DescriptorStoreError((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'conflict' : 'missingDependency')
      }
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid }))
        await lock.sync()
        const registry = await this.read()
        const outcome = await run(registry)
        if (!outcome.changed) return outcome.value
        validateRegistry(registry)
        await this.assertSafePath()
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(JSON.stringify(registry)); await file.sync() } finally { await file.close() }
        await rename(temporary, this.path)
        const directory = await open(dirname(this.path), 'r')
        try { await directory.sync() } finally { await directory.close() }
        return outcome.value
      } finally {
        await rm(temporary, { force: true })
        await lock.close()
        await rm(`${this.path}.lock`, { force: true })
      }
    })
    fileTransactions.set(this.path, next)
    try { return await next } finally { if (fileTransactions.get(this.path) === next) fileTransactions.delete(this.path) }
  }
}

function failure(error: unknown): ContentFailure {
  return { status: 'error', code: error instanceof DescriptorStoreError ? error.code : 'missingDependency' }
}

/** Resolver has no content writer. Source policy is reevaluated on every call. */
export function createDescriptorResolver(deps: { store: DescriptorStore; owner: ContentOwner; policy: ContentPolicy }) {
  async function authorize(context: AuthenticatedContentContext, ref: Rox2EntityRef,
    action: 'read' | 'adoptDescriptor', origin?: EntityOrigin): Promise<ContentAuthorization> {
    if (!context || !text(context.actorPrincipalId)) return { allowed: false, policyRevision: '' }
    const decision = await deps.policy.authorize({ context, ref, action, origin })
    return decision.allowed && text(decision.policyRevision) ? decision : { allowed: false, policyRevision: '' }
  }

  async function load(context: AuthenticatedContentContext, raw: unknown, action: 'read' | 'adoptDescriptor', registry?: DescriptorRegistry) {
    const decoded = decodeContentEntityRef(raw)
    if (decoded.status !== 'ok') return { error: { status: 'error', code: decoded.code } as ContentFailure }
    const ref = decoded.ref
    // No source/metadata lookup, including DB reads, before current input policy.
    const inputPolicy = await authorize(context, ref, action)
    if (!inputPolicy.allowed) return { error: { status: 'error', code: 'denied' } as ContentFailure }
    const db = registry ?? await deps.store.read()
    const entry = entryFor(db, ref)
    const ownerRef = entry?.ownerRef ?? withoutRevision(ref)
    const binding = await deps.owner.bindingFor(ownerRef)
    if (!binding || binding.workspaceId !== ref.workspaceId || binding.accountNamespace !== ref.accountNamespace
      || !text(binding.sourceStoreId) || !Number.isSafeInteger(binding.authorityEpoch) || binding.authorityEpoch < 0) {
      return { error: { status: 'error', code: 'missingDependency' } as ContentFailure }
    }
    const nativeId = parseRox2EntityId(ref.entityId).id
    const origin = originFor(binding, nativeId)
    if (!isEntityOrigin(origin)) return { error: { status: 'error', code: 'validation' } as ContentFailure }
    if (entry && (contentOriginKey(entry.origin) !== contentOriginKey(origin)
      || entry.origin.authorityEpoch !== origin.authorityEpoch)) {
      return { error: { status: 'error', code: 'conflict' } as ContentFailure }
    }
    // Permission on an alias is insufficient for its target/source.
    const sourcePolicy = await authorize(context, ownerRef, action, origin)
    if (!sourcePolicy.allowed) return { error: { status: 'error', code: 'denied' } as ContentFailure }
    const snapshot = await deps.owner.read(ownerRef, binding)
    if (!snapshot) return { error: { status: 'error', code: 'deleted' } as ContentFailure }
    if (snapshot.freshness !== 'live' && binding.offlineReadable !== true) {
      return { error: { status: 'error', code: 'offlineUnsupported' } as ContentFailure }
    }
    const canonicalRef = canonicalPageRef({ ...ref, revisionId: snapshot.revision })
    if (snapshot.nativeId !== nativeId || !sameContentIdentity(canonicalPageRef(snapshot.ref), canonicalRef)
      || !text(snapshot.revision) || typeof snapshot.content !== 'string' || typeof snapshot.title !== 'string') {
      return { error: { status: 'error', code: 'conflict' } as ContentFailure }
    }
    if (ref.revisionId !== undefined && ref.revisionId !== snapshot.revision) {
      return { error: { status: 'error', code: 'conflict', currentRevision: snapshot.revision } as ContentFailure }
    }
    const currentPolicy = await authorize(context, ownerRef, action, origin)
    if (!currentPolicy.allowed) return { error: { status: 'error', code: 'denied' } as ContentFailure }
    return { db, entry, snapshot, binding, origin, canonicalRef, sourcePolicy: currentPolicy, ownerRef: snapshot.ref }
  }

  async function resolveContent(context: AuthenticatedContentContext, ref: unknown): Promise<ContentResolution | ContentFailure> {
    try {
      const loaded = await load(context, ref, 'read')
      if ('error' in loaded) return loaded.error!
      const { entry, snapshot, binding, origin, canonicalRef, sourcePolicy, ownerRef } = loaded
      const decoded = entry ? decodeDocumentDescriptor(entry.descriptorJson) : {
        status: 'ok' as const,
        descriptor: legacyDocumentDescriptor({ ref: ownerRef, contentRevision: snapshot.revision, authorityEpoch: binding.authorityEpoch }),
      }
      let code: ContentResolution['code']
      let descriptor: DocumentDescriptor | undefined
      if (decoded.status === 'ok') {
        descriptor = { ...decoded.descriptor, contentRevision: snapshot.revision }
        if (!sameContentIdentity(descriptor.contentRef, ownerRef) || descriptor.authorityEpoch !== origin.authorityEpoch) code = 'validation'
        else if (descriptor.authority !== binding.authority || !binding.contentKinds.includes(descriptor.contentKind)) code = 'missingDependency'
        else if (!(binding.markerVersions ?? [1]).includes(descriptor.markerVersion)
          || !(binding.exportProfiles ?? ['markdown']).includes(descriptor.exportProfile)) code = 'unknownFormat'
      } else code = decoded.code
      const writable = !code && binding.writable && sourcePolicy.canWrite === true && snapshot.freshness === 'live'
      const canAdopt = !code && snapshot.freshness === 'live'
        && (await authorize(context, ownerRef, 'adoptDescriptor', origin)).allowed
      if (!(await authorize(context, ownerRef, 'read', origin)).allowed) return { status: 'error', code: 'denied' }
      return {
        status: code ? 'readOnly' : 'ok', ...(code ? { code } : {}),
        canonicalRef, legacyAlias: legacyNoteAlias(canonicalRef), ownerRef, origin,
        title: snapshot.title, content: snapshot.content, contentHash: contentHash(snapshot.content), revision: snapshot.revision,
        descriptorRevision: entry?.descriptorRevision ?? null, descriptorState: entry ? 'persisted' : 'inferredLegacy',
        ...(descriptor ? { descriptor } : {}), ...(entry ? { preservedDescriptor: entry.descriptorJson } : {}),
        capabilities: { read: true, write: writable, adoptDescriptor: canAdopt },
        freshness: snapshot.freshness, policyRevision: sourcePolicy.policyRevision,
      }
    } catch (error) { return failure(error) }
  }

  async function adoptDescriptor(context: AuthenticatedContentContext, command: AdoptDescriptorCommand): Promise<DescriptorReceipt | ContentFailure> {
    try {
      if (!command || !text(command.expectedRevision) || !text(command.operationId) || !text(command.idempotencyKey)
        || !(command.expectedDescriptorRevision === null || (Number.isSafeInteger(command.expectedDescriptorRevision) && command.expectedDescriptorRevision >= 1))
        || !Number.isSafeInteger(command.authorityEpoch) || command.authorityEpoch < 0) return { status: 'error', code: 'validation' }
      const decoded = decodeDocumentDescriptor(command.descriptor)
      if (decoded.status !== 'ok') return { status: 'error', code: decoded.code }
      const descriptorJson = typeof command.descriptor === 'string' ? command.descriptor : JSON.stringify(command.descriptor)
      const ref = decodeContentEntityRef(command.ref)
      if (ref.status !== 'ok') return { status: 'error', code: ref.code }
      // Do not create a directory/lock for an unauthorized request.
      if (!(await authorize(context, ref.ref, 'adoptDescriptor')).allowed) return { status: 'error', code: 'denied' }
      return await deps.store.transaction(async registry => {
        const loaded = await load(context, command.ref, 'adoptDescriptor', registry)
        if ('error' in loaded) return { changed: false, value: loaded.error! as DescriptorReceipt | ContentFailure }
        const { entry, snapshot, binding, origin, canonicalRef, ownerRef } = loaded
        const digest = checksum(JSON.stringify({ actor: context.actorPrincipalId, ref: contentEntityKey(canonicalRef),
          operationId: command.operationId, expectedRevision: command.expectedRevision,
          expectedDescriptorRevision: command.expectedDescriptorRevision, authorityEpoch: command.authorityEpoch, descriptorJson }))
        const previous = entry?.commands.find(value => value.actorPrincipalId === context.actorPrincipalId && value.idempotencyKey === command.idempotencyKey)
        if (previous) return { changed: false, value: previous.digest === digest ? clone(previous.receipt) : { status: 'error', code: 'conflict' } as ContentFailure }
        if (entry && decodeDocumentDescriptor(entry.descriptorJson).status !== 'ok') return { changed: false, value: { status: 'error', code: 'unknownFormat' } as ContentFailure }
        if (snapshot.revision !== command.expectedRevision || (entry?.descriptorRevision ?? null) !== command.expectedDescriptorRevision
          || command.authorityEpoch !== origin.authorityEpoch) return { changed: false, value: {
            status: 'error', code: 'conflict', currentRevision: snapshot.revision, ...(entry ? { descriptorRevision: entry.descriptorRevision } : {}),
          } as ContentFailure }
        if (snapshot.freshness !== 'live') return { changed: false, value: { status: 'error', code: 'missingDependency' } as ContentFailure }
        const descriptor = decoded.descriptor
        if (!sameContentIdentity(descriptor.contentRef, ownerRef) || descriptor.contentRevision !== snapshot.revision
          || (descriptor.contentRef.revisionId !== undefined && descriptor.contentRef.revisionId !== snapshot.revision)
          || descriptor.authorityEpoch !== origin.authorityEpoch) return { changed: false, value: { status: 'error', code: 'validation' } as ContentFailure }
        // Authority/format migration requires the separate native owner conversion command.
        if (descriptor.authority !== binding.authority || !binding.contentKinds.includes(descriptor.contentKind)) {
          return { changed: false, value: { status: 'error', code: 'missingDependency' } as ContentFailure }
        }
        if (!(binding.markerVersions ?? [1]).includes(descriptor.markerVersion)
          || !(binding.exportProfiles ?? ['markdown']).includes(descriptor.exportProfile)) {
          return { changed: false, value: { status: 'error', code: 'unknownFormat' } as ContentFailure }
        }
        const aliases = [withoutRevision(legacyNoteAlias(canonicalRef)), withoutRevision(ownerRef)]
          .filter((alias, index, all) => all.findIndex(other => sameContentIdentity(alias, other)) === index)
        const collision = registry.records.some(other => other !== entry && (
          sameContentIdentity(other.canonicalRef, canonicalRef) || contentOriginKey(other.origin) === contentOriginKey(origin)
          || aliases.some(alias => entryFor({ schemaVersion: 1, records: [other] }, alias))))
        if (collision) return { changed: false, value: { status: 'error', code: 'conflict' } as ContentFailure }
        if (!(await authorize(context, ownerRef, 'adoptDescriptor', origin)).allowed) {
          return { changed: false, value: { status: 'error', code: 'denied' } as ContentFailure }
        }
        const descriptorRevision = (entry?.descriptorRevision ?? 0) + 1
        const receipt: DescriptorReceipt = { status: 'committed', operationId: command.operationId, idempotencyKey: command.idempotencyKey,
          canonicalRef, revision: snapshot.revision, descriptorRevision, authorityEpoch: origin.authorityEpoch }
        const record: StoredDescriptor = {
          canonicalRef: canonicalPageRef(withoutRevision(canonicalRef)), ownerRef: withoutRevision(ownerRef), origin, aliases,
          descriptorJson, descriptorRevision, commands: [...(entry?.commands ?? []), { actorPrincipalId: context.actorPrincipalId,
            idempotencyKey: command.idempotencyKey, digest, receipt }],
        }
        if (entry) registry.records[registry.records.indexOf(entry)] = record
        else registry.records.push(record)
        return { changed: true, value: receipt }
      })
    } catch (error) { return failure(error) }
  }

  return { resolve: resolveContent, describe: resolveContent, adoptDescriptor }
}
