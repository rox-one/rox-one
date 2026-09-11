import { describe, expect, it } from 'bun:test'
import {
  createLargeVaultFixture,
  createSessionFixture,
  LARGE_VAULT_NOTE_COUNT,
} from '../fixtures'

describe('perf fixtures', () => {
  it('builds deterministic 500 and 2000 session indexes', () => {
    const small = createSessionFixture(500)
    const large = createSessionFixture(2000)
    expect(small.sessions).toHaveLength(500)
    expect(large.sessions).toHaveLength(2000)
    expect(small.sessions[0]?.id).toBe('sess-00000')
    expect(large.sessions[1999]?.id).toBe('sess-01999')
    expect(createSessionFixture(2000).sessions[42]).toEqual(large.sessions[42])
  })

  it('builds a large vault with stable ids and outbound links', () => {
    const vault = createLargeVaultFixture()
    expect(vault.notes).toHaveLength(LARGE_VAULT_NOTE_COUNT)
    expect(vault.notes[0]?.path).toBe('vault/notes/note-00000.md')
    expect(createLargeVaultFixture().notes[99]).toEqual(vault.notes[99])
    expect(vault.notes.some((note) => note.outboundLinks.length > 0)).toBe(true)
  })
})
