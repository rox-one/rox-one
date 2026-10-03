import { describe, expect, it } from 'bun:test'
import { extractMentionHandles, resolveMentions } from '../mentions.ts'

describe('stable handle parsing', () => {
  it('trims only final dots, keeps internal dots and preserves Unicode and encounter order', () => {
    expect(extractMentionHandles('@ALICE... @a..b.- @Élodie... @张三... @alice')).toEqual(['alice', 'a..b.-', 'élodie', '张三'])
    expect(extractMentionHandles('mail a@b.test .@hidden @@hidden x_@hidden (@ok)')).toEqual(['ok'])
  })
  it('retains long internal dot runs and trims long trailing runs without truncating', () => {
    const internal = `a${'.'.repeat(16384)}x`
    expect(extractMentionHandles(`@${internal} @a${'.'.repeat(16384)}`)).toEqual([internal, 'a'])
  })
  it('deduplicates many distinct handles in first-seen order and resolves only exact roster identities', () => {
    const handles = Array.from({ length: 2048 }, (_, i) => `user.${i}`)
    expect(extractMentionHandles(handles.concat(handles).map(h => `@${h}`).join(' '))).toEqual(handles)
    expect(resolveMentions('@alice.id... @alice', [{ userId: 'id', username: 'alice', displayName: 'Alice', role: 'member' }])).toEqual(['id'])
  })
})
