import { describe, expect, it } from 'bun:test'
import {
  deleteOwnedCopies,
  nativeDeleteAvailable,
  retentionNativeEvidence,
} from '../retention.ts'
import {
  audienceRecap,
  createShareRecord,
  exportMeeting,
  nativeExportAvailable,
  revokeMember,
  searchVisible,
  sharingNativeEvidence,
} from '../sharing.ts'

describe('sharing-retention (#388)', () => {
  it('does not leak private notes into recap/search; native export cannot leak them', () => {
    const record = {
      ...createShareRecord(),
      recap: 'public summary',
      privateNotes: ['secret diary'],
      members: ['alice'],
    }
    expect(audienceRecap(record, 'alice')).toBe('public summary')
    expect(audienceRecap(record, 'bob')).toBeNull()
    expect(searchVisible(record, 'alice', 'secret diary')).toEqual([])
    const exported = exportMeeting(record, 'markdown')
    expect(exported.status).toBe('unsupported')
    expect(exported.live).toBe(false)
    expect(exported.payload).toBeUndefined()
  })

  it('revoked members and links lose access', () => {
    const shared = { ...createShareRecord(), recap: 'hello', members: ['alice', 'bob'], links: ['lnk-1'] }
    const revoked = revokeMember(shared, 'bob')
    expect(audienceRecap(revoked, 'bob')).toBeNull()
    expect(revoked.links).toEqual([])
  })

  it('native export is fail-closed (U1); N5 is not_run', () => {
    const record = { ...createShareRecord(), recap: 'public', members: ['alice'] }
    const json = exportMeeting(record, 'json')
    expect(nativeExportAvailable()).toBe(false)
    expect(json.status).toBe('unsupported')
    expect(json.reason).toBe('native-export-unavailable')
    expect(json.live).toBe(false)
    expect(json.evidenceLevel).toBe('U1')
    expect(record.exports).toEqual([])
    expect(sharingNativeEvidence()).toEqual({ evidenceLevel: 'U1', native: 'not_run' })
  })

  it('native delete is fail-closed; external-retained is not claimed deleted', () => {
    const record = {
      ...createShareRecord(),
      recap: 'x',
      exports: [{ kind: 'json' as const, body: '{}' }],
      externalRetained: ['gmail-sent'],
    }
    const deleted = deleteOwnedCopies(record)
    expect(nativeDeleteAvailable()).toBe(false)
    expect(deleted.status).toBe('unsupported')
    expect(deleted.reason).toBe('native-delete-unavailable')
    expect(deleted.live).toBe(false)
    expect(deleted.evidenceLevel).toBe('U1')
    expect(deleted.payload?.ownedCopiesDeleted).toBe(false)
    expect(deleted.payload?.externalRetained).toEqual(['gmail-sent'])
    expect(record.recap).toBe('x')
    expect(record.exports).toEqual([{ kind: 'json', body: '{}' }])
    expect(record.tombstones).toEqual([])
    expect(record.externalRetained).toEqual(['gmail-sent'])
    expect(retentionNativeEvidence()).toEqual({ evidenceLevel: 'U1', native: 'not_run' })
  })
})
