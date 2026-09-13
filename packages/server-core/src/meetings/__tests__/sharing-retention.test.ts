import { describe, expect, it } from 'bun:test'
import {
  audienceRecap,
  createShareRecord,
  deleteOwnedCopies,
  exportMeeting,
  revokeMember,
  searchVisible,
} from '../sharing.ts'

describe('sharing-retention (#388)', () => {
  it('does not leak private notes into recap/search/export', () => {
    const record = {
      ...createShareRecord(),
      recap: 'public summary',
      privateNotes: ['secret diary'],
      members: ['alice'],
    }
    expect(audienceRecap(record, 'alice')).toBe('public summary')
    expect(audienceRecap(record, 'bob')).toBeNull()
    expect(searchVisible(record, 'alice', 'secret diary')).toEqual([])
    expect(exportMeeting(record, 'markdown').body).not.toContain('secret diary')
  })

  it('revoked members and links lose access', () => {
    const shared = { ...createShareRecord(), recap: 'hello', members: ['alice', 'bob'], links: ['lnk-1'] }
    const revoked = revokeMember(shared, 'bob')
    expect(audienceRecap(revoked, 'bob')).toBeNull()
    expect(revoked.links).toEqual([])
  })

  it('export round-trips allowed recap text', () => {
    const record = { ...createShareRecord(), recap: 'public', members: ['alice'] }
    const json = exportMeeting(record, 'json')
    expect(JSON.parse(json.body).recap).toBe('public')
  })

  it('delete cascades owned copies but labels external-retained', () => {
    const record = {
      ...createShareRecord(),
      recap: 'x',
      exports: [{ kind: 'json' as const, body: '{}' }],
      externalRetained: ['gmail-sent'],
    }
    const deleted = deleteOwnedCopies(record)
    expect(deleted.recap).toBe('')
    expect(deleted.exports).toEqual([])
    expect(deleted.externalRetained).toEqual(['gmail-sent'])
    expect(deleted.tombstones).toContain('deleted')
  })
})
