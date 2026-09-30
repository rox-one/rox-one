import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  canonicalPageRef, decodeContentEntityRef, decodeDocumentDescriptor, legacyDocumentDescriptor,
  type DocumentDescriptor,
} from '../../packages/core/src/docs/content-descriptor.ts'
import { contentHash } from '../../packages/core/src/rox2/notes-engine.ts'
import { parseRox2EntityId, type Rox2EntityRef } from '../../packages/core/src/rox2/platform-contract.ts'
import {
  createDescriptorResolver, FileDescriptorStore,
  type AdoptDescriptorCommand, type ContentOwner, type ContentPolicy,
  type DescriptorStore, type SourceBinding, type StoredDescriptor,
} from '../../packages/server-core/src/docs/descriptor-resolver.ts'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const actor = { actorPrincipalId: 'local-uid:501' }
const ref: Rox2EntityRef = { workspaceId: 'workspace-1', entityId: 'note:folder/existing-id', accountNamespace: 'local-notes' }
const original = '---\r\ntitle: Existing\r\ncustom: yes\r\n---\r\n\r\n# Existing\r\n\r\n- Alpha\r\n- [[Linked]]\r\n'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rox-descriptor-'))
  temporaryDirectories.push(directory)
  const contentPath = join(directory, 'existing.md')
  const metadataPath = join(directory, 'descriptors.json')
  await writeFile(contentPath, original)
  const binding: SourceBinding = {
    workspaceId: ref.workspaceId, accountNamespace: ref.accountNamespace, sourceStoreId: 'native-store-1',
    ownerPrincipalId: actor.actorPrincipalId, authorityEpoch: 0, authority: 'markdown', contentKinds: ['document'], writable: true,
    offlineReadable: true,
  }
  const state = { allowed: true, allowSource: true, allowAdopt: true, reads: 0, bindingLookups: 0, badNativeId: false,
    revokeDuringRead: false, freshness: 'live' as 'live' | 'cached' | 'stale' | 'offline' }
  const owner: ContentOwner = {
    bindingFor(request) {
      state.bindingLookups += 1
      return request.workspaceId === binding.workspaceId && request.accountNamespace === binding.accountNamespace ? binding : null
    },
    async read(request) {
      state.reads += 1
      const nativeId = parseRox2EntityId(request.entityId).id
      if (nativeId !== 'folder/existing-id') return null
      const content = await readFile(contentPath, 'utf8')
      if (state.revokeDuringRead) state.allowed = false
      const revision = contentHash(content)
      return {
        ref: { ...request, entityId: `note:${nativeId}`, revisionId: revision },
        nativeId: state.badNativeId ? 'new-uuid-incorrect' : nativeId,
        title: 'Private Existing', content, revision, freshness: state.freshness,
      }
    },
  }
  const policy: ContentPolicy = {
    authorize(input) {
      return {
        allowed: input.context.actorPrincipalId === actor.actorPrincipalId && state.allowed
          && (!input.origin || state.allowSource) && (input.action !== 'adoptDescriptor' || state.allowAdopt),
        canWrite: true, policyRevision: 'local-policy-1',
      }
    },
  }
  const store = new FileDescriptorStore(metadataPath)
  const resolver = createDescriptorResolver({ store, owner, policy })
  const descriptor = legacyDocumentDescriptor({ ref, contentRevision: contentHash(original), authorityEpoch: 0 })
  const command: AdoptDescriptorCommand = {
    ref, expectedRevision: contentHash(original), expectedDescriptorRevision: null, operationId: 'adopt-1',
    idempotencyKey: 'adopt-1', authorityEpoch: 0, descriptor,
  }
  return { directory, contentPath, metadataPath, binding, state, owner, policy, store, resolver, descriptor, command }
}

describe('LSX-WP-001 content descriptor compatibility', () => {
  test('V1/V2 references retain Rox2 fields and the canonical page keeps native ID', () => {
    const pinned = { ...ref, revisionId: 'r1' }
    expect(decodeContentEntityRef(pinned)).toEqual({ status: 'ok', ref: pinned, sourceVersion: 1 })
    expect(decodeContentEntityRef({ ...pinned, version: 2 })).toEqual({ status: 'ok', ref: pinned, sourceVersion: 2 })
    expect(canonicalPageRef(pinned)).toEqual({ ...pinned, version: 2, entityId: 'page:folder/existing-id' })
    expect(decodeContentEntityRef({ ...pinned, version: 17 }).status).toBe('readOnly')
    expect(decodeContentEntityRef({ ...pinned, entityId: 'document:folder/existing-id' }).status).toBe('invalid')
    expect(decodeContentEntityRef({ ...pinned, version: null }).status).toBe('invalid')
    expect(decodeContentEntityRef({ kind: 'note', id: 'folder/existing-id' }).status).toBe('invalid')
  })

  test('V1 format descriptor defaults to document; V2 supports explicit page content kinds', () => {
    const legacy = { version: 1, authority: 'markdown' as const, authorityEpoch: 0, contentRef: ref,
      contentRevision: 'r1', markerVersion: 1, exportProfile: 'markdown' }
    const decoded = decodeDocumentDescriptor(legacy)
    expect(decoded.status).toBe('ok')
    if (decoded.status === 'ok') {
      expect(decoded.sourceVersion).toBe(1)
      expect(decoded.descriptor).toEqual({ ...legacy, version: 2, contentKind: 'document' })
      for (const contentKind of ['document', 'base', 'record']) {
        expect(decodeDocumentDescriptor({ ...decoded.descriptor, contentKind }).status).toBe('ok')
      }
    }
    for (const invalid of [null, 'broken-json', { ...legacy, markerVersion: 0 }, { ...legacy, authorityEpoch: -1 },
      { ...legacy, contentRef: { ...ref, workspaceId: '' } }, { ...legacy, version: 2 }, { ...legacy, version: 1.5 }]) {
      expect(decodeDocumentDescriptor(invalid).status).toBe('invalid')
    }
  })

  test('legacy query opens identical content without adopting metadata or rewriting native bytes', async () => {
    const f = await fixture()
    const result = await f.resolver.resolve(actor, ref)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.canonicalRef.entityId).toBe('page:folder/existing-id')
      expect(result.legacyAlias.entityId).toBe(ref.entityId)
      expect(result.ownerRef.entityId).toBe(ref.entityId)
      expect(result.contentHash).toBe(contentHash(original))
      expect(result.content).toBe(original)
      expect(result.origin.nativeId).toBe('folder/existing-id')
      expect(result.descriptorState).toBe('inferredLegacy')
      expect(result.descriptorRevision).toBeNull()
    }
    expect(await f.store.read()).toEqual({ schemaVersion: 1, records: [] })
    expect(await readFile(f.contentPath)).toEqual(Buffer.from(original))
    expect(await Bun.file(f.metadataPath).exists()).toBe(false)
  })

  test('explicit adoption durably stores descriptor/origin/aliases/receipt; restarted process reads same IDs and hash', async () => {
    const f = await fixture()
    const receipt = await f.resolver.adoptDescriptor(actor, f.command)
    expect(receipt.status).toBe('committed')
    const persisted = await f.store.read()
    expect(persisted.records).toHaveLength(1)
    expect(persisted.records[0]?.origin).toEqual({ sourceStoreId: 'native-store-1', nativeId: 'folder/existing-id',
      ownerPrincipalId: actor.actorPrincipalId, authorityEpoch: 0 })
    expect(persisted.records[0]?.aliases[0]?.entityId).toBe(ref.entityId)
    expect(JSON.stringify(persisted)).not.toContain(original)
    expect(await readFile(f.contentPath)).toEqual(Buffer.from(original))
    const restarted = createDescriptorResolver({ store: new FileDescriptorStore(f.metadataPath), owner: f.owner, policy: f.policy })
    const canonical = canonicalPageRef(ref)
    const [fromAlias, fromPage] = await Promise.all([restarted.resolve(actor, ref), restarted.resolve(actor, canonical)])
    expect(fromAlias).toEqual(fromPage)
    if (fromAlias.status === 'ok') {
      expect(fromAlias.contentHash).toBe(contentHash(original))
      expect(fromAlias.canonicalRef).toEqual({ ...canonical, revisionId: contentHash(original) })
      expect(fromAlias.descriptorState).toBe('persisted')
    }
    // This is an actual new JS process, not just a reconstructed in-memory repository.
    const modulePath = new URL('../../packages/server-core/src/docs/descriptor-resolver.ts', import.meta.url).pathname
    const child = Bun.spawn([process.execPath, '-e',
      'const { FileDescriptorStore } = await import(process.env.DESCRIPTOR_MODULE); const db = await new FileDescriptorStore(process.env.DESCRIPTOR_PATH).read(); process.stdout.write(JSON.stringify(db))'],
      { env: { ...process.env, DESCRIPTOR_MODULE: modulePath, DESCRIPTOR_PATH: f.metadataPath }, stdout: 'pipe', stderr: 'pipe' })
    const readback = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    expect(JSON.parse(readback)).toEqual(persisted)
  })

  test('retries return the durable receipt without another metadata revision; changed intent conflicts', async () => {
    const f = await fixture()
    const first = await f.resolver.adoptDescriptor(actor, f.command)
    const disk = await readFile(f.metadataPath)
    expect(await f.resolver.adoptDescriptor(actor, f.command)).toEqual(first)
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, ref: canonicalPageRef(ref) })).toEqual(first)
    expect(await readFile(f.metadataPath)).toEqual(disk)
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, operationId: 'different-operation' }))
      .toEqual({ status: 'error', code: 'conflict' })
    expect((await f.store.read()).records[0]?.descriptorRevision).toBe(1)
  })

  test('mandatory content CAS, descriptor CAS and authority epoch fence stale adoption', async () => {
    const f = await fixture()
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, expectedRevision: '' })).toEqual({ status: 'error', code: 'validation' })
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, expectedRevision: 'stale' }))
      .toEqual({ status: 'error', code: 'conflict', currentRevision: contentHash(original) })
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, authorityEpoch: 1 }))
      .toEqual({ status: 'error', code: 'conflict', currentRevision: contentHash(original) })
    await f.resolver.adoptDescriptor(actor, f.command)
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, idempotencyKey: 'second', operationId: 'second' }))
      .toEqual({ status: 'error', code: 'conflict', currentRevision: contentHash(original), descriptorRevision: 1 })
    expect(await f.resolver.resolve(actor, { ...ref, revisionId: 'stale' }))
      .toEqual({ status: 'error', code: 'conflict', currentRevision: contentHash(original) })
    expect(await readFile(f.contentPath)).toEqual(Buffer.from(original))
  })

  test('negative duplicate-ID control rejects adoption to a new UUID and owner substitution', async () => {
    const f = await fixture()
    const newIdentity: DocumentDescriptor = { ...f.descriptor, contentRef: { ...ref, entityId: 'page:new-uuid' } }
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, descriptor: newIdentity })).toEqual({ status: 'error', code: 'validation' })
    f.state.badNativeId = true
    expect(await f.resolver.resolve(actor, ref)).toEqual({ status: 'error', code: 'conflict' })
    expect((await f.store.read()).records).toHaveLength(0)
    expect(await readFile(f.contentPath)).toEqual(Buffer.from(original))
  })

  test('current actor policy runs before DB, binding, title or body; no payload descriptor grants access', async () => {
    const f = await fixture()
    let metadataReads = 0
    const countedStore: DescriptorStore = {
      read: async () => { metadataReads += 1; return f.store.read() }, transaction: run => f.store.transaction(run),
    }
    const resolver = createDescriptorResolver({ store: countedStore, owner: f.owner, policy: f.policy })
    expect(await resolver.resolve({ actorPrincipalId: 'stranger' }, ref)).toEqual({ status: 'error', code: 'denied' })
    expect(await resolver.resolve({ actorPrincipalId: '' }, ref)).toEqual({ status: 'error', code: 'denied' })
    expect(await resolver.adoptDescriptor({ actorPrincipalId: 'stranger' }, f.command)).toEqual({ status: 'error', code: 'denied' })
    expect(metadataReads).toBe(0)
    expect(f.state.bindingLookups).toBe(0)
    expect(f.state.reads).toBe(0)
    expect(await Bun.file(f.metadataPath).exists()).toBe(false)
    expect(await Bun.file(`${f.metadataPath}.lock`).exists()).toBe(false)
    f.state.allowSource = false
    expect(await resolver.resolve(actor, ref)).toEqual({ status: 'error', code: 'denied' })
    expect(f.state.reads).toBe(0)
  })

  test('revoke during owner read removes the response; persisted retry also reauthorizes', async () => {
    const f = await fixture()
    await f.resolver.adoptDescriptor(actor, f.command)
    f.state.allowed = false
    expect(await f.resolver.adoptDescriptor(actor, f.command)).toEqual({ status: 'error', code: 'denied' })
    f.state.allowed = true
    f.state.revokeDuringRead = true
    expect(await f.resolver.resolve(actor, ref)).toEqual({ status: 'error', code: 'denied' })
  })

  test('a source collision quarantines the alias without overwriting native content or origin', async () => {
    const f = await fixture()
    await f.resolver.adoptDescriptor(actor, f.command)
    const before = await readFile(f.metadataPath)
    // Same visible workspace/account/native ID belongs to another source: no guessed replacement.
    f.binding.sourceStoreId = 'different-store'
    expect(await f.resolver.resolve(actor, ref)).toEqual({ status: 'error', code: 'conflict' })
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, idempotencyKey: 'collision', operationId: 'collision', expectedDescriptorRevision: 1 }))
      .toEqual({ status: 'error', code: 'conflict' })
    expect(await readFile(f.metadataPath)).toEqual(before)
    expect(await readFile(f.contentPath)).toEqual(Buffer.from(original))
  })

  test('duplicate canonical/alias mapping is rejected at the durable store boundary', async () => {
    const f = await fixture()
    await f.resolver.adoptDescriptor(actor, f.command)
    const before = await readFile(f.metadataPath)
    await expect(f.store.transaction(async registry => {
      const duplicate = JSON.parse(JSON.stringify(registry.records[0])) as StoredDescriptor
      duplicate.origin.sourceStoreId = 'duplicate-source'
      registry.records.push(duplicate)
      return { changed: true, value: undefined }
    })).rejects.toThrow('Descriptor store conflict')
    expect(await readFile(f.metadataPath)).toEqual(before)
  })

  test('unknown future and malformed descriptor bytes survive read-only resolution and cannot be overwritten', async () => {
    const f = await fixture()
    await f.resolver.adoptDescriptor(actor, f.command)
    for (const [payload, code] of [
      [' { "version": 999, "privateFutureField": { "x": 1 } }\n', 'unknownFormat'],
      [' { broken descriptor bytes\n', 'validation'],
    ] as const) {
      await f.store.transaction(async registry => {
        registry.records[0]!.descriptorJson = payload
        return { changed: true, value: undefined }
      })
      const before = await readFile(f.metadataPath)
      const result = await f.resolver.resolve(actor, ref)
      expect(result.status).toBe('readOnly')
      if (result.status === 'readOnly') {
        expect(result.code).toBe(code)
        expect(result.preservedDescriptor).toBe(payload)
        expect(result.capabilities.write).toBe(false)
        expect(result.capabilities.adoptDescriptor).toBe(false)
        expect(result.contentHash).toBe(contentHash(original))
      }
      expect(await f.resolver.adoptDescriptor(actor, { ...f.command, expectedDescriptorRevision: 1, operationId: 'overwrite', idempotencyKey: 'overwrite' }))
        .toEqual({ status: 'error', code: 'unknownFormat' })
      expect(await readFile(f.metadataPath)).toEqual(before)
      expect((await new FileDescriptorStore(f.metadataPath).read()).records[0]?.descriptorJson).toBe(payload)
    }
    const unknown = ' { "version": 999 }\n'
    expect(decodeDocumentDescriptor(unknown)).toEqual({ status: 'readOnly', code: 'unknownFormat', version: 999, preserved: unknown })
  })

  test('unsupported source owners and offline data do not advertise a successful adoption', async () => {
    const f = await fixture()
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, descriptor: { ...f.descriptor, contentKind: 'base' } }))
      .toEqual({ status: 'error', code: 'missingDependency' })
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, descriptor: { ...f.descriptor, authority: 'rich-blocks' } }))
      .toEqual({ status: 'error', code: 'missingDependency' })
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, descriptor: { ...f.descriptor, markerVersion: 99 } }))
      .toEqual({ status: 'error', code: 'unknownFormat' })
    expect(await f.resolver.resolve(actor, { ...ref, workspaceId: 'unknown-workspace' }))
      .toEqual({ status: 'error', code: 'missingDependency' })
    f.state.allowAdopt = false
    const readable = await f.resolver.resolve(actor, ref)
    if (readable.status === 'ok') expect(readable.capabilities.adoptDescriptor).toBe(false)
    f.state.allowAdopt = true
    f.state.freshness = 'offline'
    const offline = await f.resolver.resolve(actor, ref)
    if (offline.status === 'ok') {
      expect(offline.capabilities.write).toBe(false)
      expect(offline.capabilities.adoptDescriptor).toBe(false)
    }
    expect(await f.resolver.adoptDescriptor(actor, f.command)).toEqual({ status: 'error', code: 'missingDependency' })
    f.binding.offlineReadable = false
    expect(await f.resolver.resolve(actor, ref)).toEqual({ status: 'error', code: 'offlineUnsupported' })
    expect((await f.store.read()).records).toHaveLength(0)
  })

  test('interrupted temp file is ignored; live process lock fails closed; dead owner lock can be recovered', async () => {
    const f = await fixture()
    await f.resolver.adoptDescriptor(actor, f.command)
    const committed = await readFile(f.metadataPath)
    await writeFile(`${f.metadataPath}.unfinished.tmp`, 'partial-invalid-json')
    expect((await new FileDescriptorStore(f.metadataPath).read()).records).toHaveLength(1)
    await writeFile(`${f.metadataPath}.lock`, JSON.stringify({ pid: process.pid }))
    await expect(f.store.recoverInterruptedCommit()).rejects.toThrow('Descriptor store conflict')
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, operationId: 'second', idempotencyKey: 'second', expectedDescriptorRevision: 1 }))
      .toEqual({ status: 'error', code: 'conflict' })
    const child = Bun.spawn([process.execPath, '-e', 'process.exit(0)'], { stdout: 'ignore', stderr: 'ignore' })
    expect(await child.exited).toBe(0)
    await writeFile(`${f.metadataPath}.lock`, JSON.stringify({ pid: child.pid }))
    expect(await f.store.recoverInterruptedCommit()).toBe('recovered')
    expect(await readFile(f.metadataPath)).toEqual(committed)
    expect(await f.resolver.adoptDescriptor(actor, { ...f.command, operationId: 'second', idempotencyKey: 'second', expectedDescriptorRevision: 1 }))
      .toMatchObject({ status: 'committed', descriptorRevision: 2 })
    expect(await readFile(f.contentPath)).toEqual(Buffer.from(original))
  })

  test('corrupt metadata remains on disk and returns validation instead of a new document', async () => {
    const f = await fixture()
    await writeFile(f.metadataPath, '{ broken registry')
    expect(await f.resolver.resolve(actor, ref)).toEqual({ status: 'error', code: 'validation' })
    expect(await f.resolver.adoptDescriptor(actor, f.command)).toEqual({ status: 'error', code: 'validation' })
    expect(await readFile(f.metadataPath, 'utf8')).toBe('{ broken registry')
    expect(await readFile(f.contentPath)).toEqual(Buffer.from(original))
  })

  test('future metadata registry remains untouched and produces an unknown-format diagnostic', async () => {
    const f = await fixture()
    const bytes = ' { "schemaVersion": 50, "future": [1,2,3] }\n'
    await writeFile(f.metadataPath, bytes)
    expect(await f.resolver.resolve(actor, ref)).toEqual({ status: 'error', code: 'unknownFormat' })
    expect(await f.resolver.adoptDescriptor(actor, f.command)).toEqual({ status: 'error', code: 'unknownFormat' })
    expect(await readFile(f.metadataPath, 'utf8')).toBe(bytes)
  })

  test('symlinked metadata folder/file/lock cannot redirect reads or writes outside the trusted source root', async () => {
    const f = await fixture()
    const outside = join(f.directory, 'outside')
    const vault = join(f.directory, 'vault')
    await mkdir(outside)
    await mkdir(vault)
    const outsideFile = join(outside, 'descriptor.json')
    const bytes = '{ "schemaVersion":1,"records":[] }'
    await writeFile(outsideFile, bytes)
    const metadataDirectory = join(vault, '.rox-docs')
    await symlink(outside, metadataDirectory, 'dir')
    const unsafeStore = new FileDescriptorStore(join(metadataDirectory, 'descriptor.json'), { trustedRoot: vault })
    const unsafeResolver = createDescriptorResolver({ store: unsafeStore, owner: f.owner, policy: f.policy })
    expect(await unsafeResolver.resolve(actor, ref)).toEqual({ status: 'error', code: 'validation' })
    expect(await unsafeResolver.adoptDescriptor(actor, f.command)).toEqual({ status: 'error', code: 'validation' })
    expect(await readFile(outsideFile, 'utf8')).toBe(bytes)
    await rm(metadataDirectory)
    await mkdir(metadataDirectory)
    const path = join(metadataDirectory, 'descriptor.json')
    const safeStore = new FileDescriptorStore(path, { trustedRoot: vault })
    await symlink(outsideFile, path)
    await expect(safeStore.read()).rejects.toThrow('Descriptor store validation')
    await rm(path)
    await symlink(outsideFile, `${path}.lock`)
    await expect(safeStore.recoverInterruptedCommit()).rejects.toThrow('Descriptor store validation')
    expect(await readFile(outsideFile, 'utf8')).toBe(bytes)
    expect(() => new FileDescriptorStore(outsideFile, { trustedRoot: vault })).toThrow('Descriptor store validation')
  })
})
