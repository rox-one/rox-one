import { expect, test } from 'bun:test'
import type { NoteDocument } from '../../../shared/types'
import { writeNoteThroughAuthority } from '../notes-write-authority'

const native = { id: 'renamed/path', nativeId: 'immutable-id', nativeRevision: 3, revision: 'sha256:opened', sourceStoreId: 'native-journal:workspace:registered-root', content: 'opened' } as NoteDocument
const projection = {
  status: 'ok' as const, canonicalRef: { workspaceId: 'workspace' },
  origin: { nativeId: 'immutable-id', sourceStoreId: native.sourceStoreId!, authorityEpoch: 1 },
  revision: native.revision!, capabilities: { write: true },
}

test('native metadata routes only to the durable writer even when a legacy callback exists', async () => {
  const calls: string[] = []
  const result = await writeNoteThroughAuthority(native, 'workspace', projection, {
    native: async () => { calls.push('native'); return native },
    markdown: async () => { calls.push('markdown'); return native },
  })
  expect(result).toBe(native)
  expect(calls).toEqual(['native'])
})

test('native writer failure never falls back to the MarkdownCommit file writer', async () => {
  let fallback = 0
  await expect(writeNoteThroughAuthority(native, 'workspace', projection, {
    native: async () => { throw Object.assign(new Error('canonical CAS conflict'), { code: 'HASH_CONFLICT' }) },
    markdown: async () => { fallback++; return native },
  })).rejects.toThrow('canonical CAS conflict')
  expect(fallback).toBe(0)
})

test('missing native revision, switched source, read-only projection, stale hash and other workspace refuse before either writer', async () => {
  let writes = 0
  const writers = { native: async () => { writes++; return native }, markdown: async () => { writes++; return native } }
  await expect(writeNoteThroughAuthority({ ...native, nativeRevision: undefined }, 'workspace', projection, writers)).rejects.toThrow()
  await expect(writeNoteThroughAuthority(native, 'workspace', { ...projection, origin: { ...projection.origin, sourceStoreId: 'legacy:store' } }, writers)).rejects.toThrow()
  await expect(writeNoteThroughAuthority(native, 'workspace', { ...projection, capabilities: { write: false } }, writers)).rejects.toThrow()
  await expect(writeNoteThroughAuthority(native, 'workspace', { ...projection, revision: 'sha256:concurrent' }, writers)).rejects.toThrow()
  await expect(writeNoteThroughAuthority(native, 'other-workspace', projection, writers)).rejects.toThrow()
  expect(writes).toBe(0)
})

test('an explicit bound non-native document retains the Compound CAS writer', async () => {
  const legacy = { id: 'legacy/path', revision: 'sha256:legacy', sourceStoreId: 'legacy:registered', content: 'legacy' } as NoteDocument
  let nativeWrites = 0
  let markdownWrites = 0
  const bound = { ...projection, revision: legacy.revision!, origin: { ...projection.origin, nativeId: legacy.id, sourceStoreId: legacy.sourceStoreId! } }
  const writers = { native: async () => { nativeWrites++; return legacy }, markdown: async () => { markdownWrites++; return legacy } }
  expect(await writeNoteThroughAuthority(legacy, 'workspace', bound, writers)).toBe(legacy)
  expect(nativeWrites).toBe(0)
  expect(markdownWrites).toBe(1)
  await expect(writeNoteThroughAuthority(legacy, 'workspace', null, writers)).rejects.toThrow()
  await expect(writeNoteThroughAuthority(legacy, 'workspace', { ...bound, origin: { ...bound.origin, sourceStoreId: native.sourceStoreId! } }, writers)).rejects.toThrow()
  expect(markdownWrites).toBe(1)
})
