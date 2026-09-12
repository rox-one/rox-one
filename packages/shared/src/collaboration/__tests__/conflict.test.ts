import { describe, expect, it } from 'bun:test'
import { mapOmpCollabVerb, OMP_COLLAB_SURFACE_MAP, resolveConcurrentEdit } from '../index.ts'

describe('concurrent prompt/annotation conflict', () => {
  it('last-writer-wins and records both actors', () => {
    const a = {
      kind: 'prompt' as const,
      targetId: 'composer',
      actorAccountId: 'acc_a',
      writtenAt: 10,
      body: 'hello',
    }
    const b = {
      kind: 'prompt' as const,
      targetId: 'composer',
      actorAccountId: 'acc_b',
      writtenAt: 20,
      body: 'hello from b',
    }
    const resolved = resolveConcurrentEdit(a, b)
    expect(resolved.winner).toBe(b)
    expect(resolved.conflict).toBe(true)
    expect(resolved.actors).toEqual(['acc_a', 'acc_b'])
  })
})

describe('OMP collab surface map', () => {
  it('maps share/join/export/vibe onto native Rox actions', () => {
    expect(OMP_COLLAB_SURFACE_MAP.share).toBe('inviteBro')
    expect(mapOmpCollabVerb('join')).toBe('joinBroInvite')
    expect(mapOmpCollabVerb('export')).toBe('exportSession')
    expect(mapOmpCollabVerb('vibe')).toBe('sessionPresence')
    expect(mapOmpCollabVerb('publish')).toBeNull()
  })
})
