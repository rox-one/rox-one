import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { acknowledgementFromReceipt, isNativeReplicaNetworkLoss } from '../native-replica'
import type { NativeDataReceipt } from '../dto'
import type { ReplicaOperation } from '../../account-replica/types'

const context = { issuer: 'issuer-a', subject: 'subject-a', workspaceId: 'workspace-a', permissionFence: 'fence-a' }
const operation: ReplicaOperation = { id: 'operation-a', seq: 0, ts: 1, deviceId: 'device-a', accountId: 'account-a', workspaceId: context.workspaceId, category: 'notes', nativeId: 'note-a', expectedRevision: 1, schemaVersion: 1, changes: [{ path: 'notes/a.md', content: '# Unicode Привет\n' }] }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const receipt: NativeDataReceipt = { issuer: context.issuer, subject: context.subject, workspaceId: context.workspaceId, kind: 'notes', nativeId: operation.nativeId, operationId: operation.id, sequence: 2, revision: 2, contentHash: hash(JSON.stringify([['notes/a.md', hash(operation.changes[0]!.content!)]])), deleted: false }

test('receipt acceptance binds canonical UTF-8 bytes, path, account, identity, revision and deletion semantics', async () => {
  expect(await acknowledgementFromReceipt(operation, receipt, context)).toEqual({ serverSequence: 2, revision: 2 })
  for (const changed of [
    { ...receipt, contentHash: 'a'.repeat(64) }, { ...receipt, deleted: true },
    { ...receipt, nativeId: 'other-note' }, { ...receipt, subject: 'other-subject' },
    { ...receipt, issuer: 'other-issuer' }, { ...receipt, revision: 3 },
    { ...receipt, operationId: 'other-operation' }, { ...receipt, workspaceId: 'other-workspace' },
  ]) await expect(acknowledgementFromReceipt(operation, changed, context)).rejects.toThrow('does not match')
  await expect(acknowledgementFromReceipt({ ...operation, changes: [{ path: 'notes/moved.md', content: operation.changes[0]!.content }] }, receipt, context)).rejects.toThrow()
  await expect(acknowledgementFromReceipt({ ...operation, changes: [...operation.changes, { path: 'notes/second.md', content: 'second' }] }, receipt, context)).rejects.toThrow()
  const deletion = { ...operation, changes: [{ path: 'notes/a.md', content: null }] }
  expect(await acknowledgementFromReceipt(deletion, { ...receipt, contentHash: hash('[]'), deleted: true }, context)).toEqual({ serverSequence: 2, revision: 2 })
  await expect(acknowledgementFromReceipt(deletion, { ...receipt, contentHash: hash('[]'), deleted: false }, context)).rejects.toThrow()
})

test('only observed network loss enables offline source reuse; explicit authentication/protocol failures cannot', () => {
  expect(isNativeReplicaNetworkLoss({ status: 'disconnected', lastClose: { code: 1006 } })).toBe(true)
  expect(isNativeReplicaNetworkLoss({ status: 'failed', lastError: { kind: 'network' } })).toBe(true)
  for (const state of [
    { status: 'disconnected' }, { status: 'idle' }, { status: 'connected' },
    { status: 'failed', lastError: { kind: 'auth' }, lastClose: { code: 1006 } },
    { status: 'failed', lastError: { kind: 'protocol' }, lastClose: { code: 1006 } },
    { status: 'disconnected', lastError: { kind: 'unknown' }, lastClose: { code: 1006 } },
  ]) expect(isNativeReplicaNetworkLoss(state)).toBe(false)
})
