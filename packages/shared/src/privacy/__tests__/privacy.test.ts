import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountReplica, ReplicaCategoryError } from '../../account-replica/index.ts'
import {
  aiIndexingAllowed,
  assertNotTrainingCategory,
  cloudInferenceAllowed,
  exportAllowlist,
  isPurposeAllowed,
  productImprovementAllowed,
  replicaAppendAllowed,
  replicaRealtimeAllowed,
} from '../policy.ts'
import { applyConsentToReplica } from '../replica-consent.ts'
import {
  completeDeletion,
  getDefaultPrivacyState,
  loadPrivacyState,
  requestDeletion,
  requestExport,
  setPurpose,
} from '../store.ts'
import { emptyPurposes } from '../types.ts'

describe('privacy consent ledger', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  function tmp() {
    const dir = mkdtempSync(join(tmpdir(), 'rox-privacy-'))
    dirs.push(dir)
    return dir
  }

  it('migrates existing users with no fabricated consent', () => {
    const dir = tmp()
    const state = loadPrivacyState(dir)
    expect(state.purposes).toEqual(emptyPurposes())
    expect(state.events[0]?.action).toBe('migrate-unset')
    expect(state.events[0]?.purpose).toBe('*')
    for (const purpose of Object.keys(state.purposes) as Array<keyof typeof state.purposes>) {
      expect(isPurposeAllowed(state.purposes, purpose)).toBe(false)
    }
  })

  it('revokes realtime sync without deleting local data and shows remote deletion status', () => {
    const dir = tmp()
    setPurpose('accountRecoveryReplica', true, dir)
    setPurpose('realtimeSync', true, dir)
    const replica = new AccountReplica('acct-1', 'recovery-secret')
    replica.bindWorkspace('ws-1')
    replica.enrollDevice('device-a', 'device-a-secret')
    applyConsentToReplica(replica, loadPrivacyState(dir).purposes)
    replica.append({
      deviceId: 'device-a',
      workspaceId: 'ws-1',
      category: 'notes',
      type: 'put',
      path: 'keep.md',
      body: '# local canonical',
    })
    const localCopy = replica.materialize('ws-1').get('notes:keep.md')
    const revoked = setPurpose('realtimeSync', false, dir)
    applyConsentToReplica(replica, revoked.purposes)
    expect(replicaRealtimeAllowed(revoked.purposes)).toBe(false)
    expect(replicaAppendAllowed(revoked.purposes)).toBe(true)
    expect(localCopy).toBe('# local canonical')
    const { receipt } = requestDeletion(dir)
    expect(receipt.status).toBe('queued')
    expect(receipt.localDataKept).toBe(true)
    expect(replica.materialize('ws-1').get('notes:keep.md')).toBe('# local canonical')
    const completed = completeDeletion(receipt.id, dir)
    expect(completed.deletions.at(-1)?.status).toBe('completed')
    expect(replica.materialize('ws-1').get('notes:keep.md')).toBe('# local canonical')
  })

  it('pauses replica writes when recovery consent is off', () => {
    const dir = tmp()
    const off = loadPrivacyState(dir)
    expect(replicaAppendAllowed(off.purposes)).toBe(false)
    const replica = new AccountReplica('acct-1', 'recovery-secret')
    replica.bindWorkspace('ws-1')
    replica.enrollDevice('device-a', 'device-a-secret')
    applyConsentToReplica(replica, off.purposes)
    expect(() =>
      replica.append({
        deviceId: 'device-a',
        workspaceId: 'ws-1',
        category: 'notes',
        type: 'put',
        path: 'x.md',
        body: 'nope',
      }),
    ).toThrow(ReplicaCategoryError)
  })

  it('never exports credentials, cookies or passkeys', () => {
    const dir = tmp()
    setPurpose('productImprovement', true, dir)
    const { bundle, receipt } = requestExport(dir)
    expect(receipt.excluded).toEqual(['credentials', 'cookies', 'passkeys'])
    expect(exportAllowlist(['notes', 'credentials', 'cookies', 'passkeys', 'tasks'])).toEqual(['notes', 'tasks'])
    expect(JSON.stringify(bundle)).not.toMatch(/ghp_|sk-|password|cookie=/i)
    expect(existsSync(receipt.path)).toBe(true)
    const onDisk = readFileSync(receipt.path, 'utf8')
    expect(onDisk).toContain('productImprovement')
    expect(() => assertNotTrainingCategory('passkeys')).toThrow(/excluded/)
    expect(productImprovementAllowed(loadPrivacyState(dir).purposes)).toBe(true)
    expect(aiIndexingAllowed(getDefaultPrivacyState().purposes)).toBe(false)
    expect(cloudInferenceAllowed(getDefaultPrivacyState().purposes)).toBe(false)
  })

  it('does not grant realtime without recovery consent', () => {
    const dir = tmp()
    expect(() => setPurpose('realtimeSync', true, dir)).toThrow(/requires account recovery/)
    expect(loadPrivacyState(dir).purposes.realtimeSync).toBe(false)
  })
})
