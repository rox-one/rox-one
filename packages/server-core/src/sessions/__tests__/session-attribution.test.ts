import '../__test-config-isolation'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addWorkspace } from '@rox/shared/config'
import type { SessionParticipantIdentity } from '@rox/shared/protocol'
import { loadSession, sessionPersistenceQueue } from '@rox/shared/sessions'
import { nativeSessionEvent } from '../../handlers/rpc/native-session-scope'
import {
  SESSION_PARTICIPANT_CAP,
  SessionManager,
  upsertSessionParticipant,
} from '../SessionManager'

const roots: string[] = []
const managers: SessionManager[] = []
afterEach(async () => {
  managers.splice(0).forEach(manager => manager.cleanup())
  await sessionPersistenceQueue.flushAll()
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})

const LOCAL_ACTOR = { accountId: 'installation', displayName: 'Local', kind: 'profile' as const }

async function createAttributed() {
  const root = mkdtempSync(join(tmpdir(), 'rox-attribution-'))
  roots.push(root)
  const workspace = addWorkspace({ name: 'Attribution', rootPath: root })
  const manager = new SessionManager()
  managers.push(manager)
  const session = await manager.createSession(workspace.id,
    { name: 'Attributed', permissionMode: 'safe', enabledSourceSlugs: [] },
    { emitCreatedEvent: false, initialAssistantMessage: 'fixture', actor: LOCAL_ACTOR })
  return { root, manager, session }
}

describe('session creator capture (a1.3)', () => {
  it('writes the creator once at creation, persists it and binds it as a participant', async () => {
    const { root, session } = await createAttributed()

    expect(session.creator).toEqual(LOCAL_ACTOR)
    expect(session.participants).toEqual([
      { accountId: 'installation', displayName: 'Local', username: 'installation', kind: 'profile' },
    ])
    // Written to the JSONL header, not only held in memory.
    expect(loadSession(root, session.id)).toMatchObject({
      creator: LOCAL_ACTOR,
      participants: [{ accountId: 'installation', displayName: 'Local', username: 'installation', kind: 'profile' }],
    })
  })

  it('never lets assignOwner rewrite the creator, and adds the assignee as a participant', async () => {
    const { root, manager, session } = await createAttributed()

    await manager.assignSessionOwner(session.id, { kind: 'account', id: 'ada', displayName: 'Ada' }, 'installation')
    const owned = (await manager.getSession(session.id))!
    expect(owned.creator).toEqual(LOCAL_ACTOR)
    expect(owned.owner).toMatchObject({ kind: 'account', id: 'ada', displayName: 'Ada', assignedBy: 'installation' })
    expect(owned.participants?.map(participant => participant.accountId)).toEqual(['installation', 'ada'])

    // Clearing the owner must still leave the creator untouched.
    await manager.assignSessionOwner(session.id, null, 'ada')
    const cleared = (await manager.getSession(session.id))!
    expect(cleared.creator).toEqual(LOCAL_ACTOR)
    expect(cleared.owner).toBeUndefined()
    expect(loadSession(root, session.id)?.creator).toEqual(LOCAL_ACTOR)
  })

  it('records a writing actor as a participant and dedups repeat writes', async () => {
    const { manager, session } = await createAttributed()

    expect(await manager.noteSessionParticipant(session.id, {
      accountId: 'ada', displayName: 'Ada', username: 'ada', kind: 'profile',
    })).toBe(true)
    // Same actor writing again is a no-op (no re-persist).
    expect(await manager.noteSessionParticipant(session.id, {
      accountId: 'ada', displayName: 'Ada', username: 'ada', kind: 'profile',
    })).toBe(false)
    // A display-name change is a real update, not a duplicate.
    expect(await manager.noteSessionParticipant(session.id, {
      accountId: 'ada', displayName: 'Ada Lovelace', username: 'ada', kind: 'profile',
    })).toBe(true)

    const participants = (await manager.getSession(session.id))!.participants!
    expect(participants.map(participant => participant.accountId)).toEqual(['installation', 'ada'])
    expect(participants[1]!.displayName).toBe('Ada Lovelace')
  })
})

describe('participant maintenance (a1.3)', () => {
  it('dedups by accountId and keeps only the most recent entries up to the cap', () => {
    let list: SessionParticipantIdentity[] = upsertSessionParticipant(undefined, { accountId: 'a', displayName: 'A', username: 'a', kind: 'profile' })!
    expect(list).toEqual([{ accountId: 'a', displayName: 'A', username: 'a', kind: 'profile' }])

    // Duplicate accountId with identical identity → unchanged.
    expect(upsertSessionParticipant(list, { accountId: 'a', displayName: 'A', username: 'a', kind: 'profile' })).toBeNull()

    for (let index = 1; index < SESSION_PARTICIPANT_CAP + 5; index++) {
      list = upsertSessionParticipant(list, {
        accountId: `p${index}`, displayName: `P${index}`, username: `p${index}`, kind: 'profile',
      })!
    }
    expect(list.length).toBe(SESSION_PARTICIPANT_CAP)
    // Oldest entries are dropped; the newest actor is retained.
    expect(list[0]!.accountId).toBe('p5')
    expect(list.at(-1)!.accountId).toBe(`p${SESSION_PARTICIPANT_CAP + 4}`)
  })
})

describe('native projection of collaboration events (a1.3/a1.4/a2.5)', () => {
  it('forwards owner/visibility/typing/presence instead of dropping them', () => {
    const owner = { kind: 'account' as const, id: 'ada', displayName: 'Ada', assignedAt: 5, assignedBy: 'installation' }
    const viewer = { accountId: 'ada', displayName: 'Ada', username: 'ada', role: 'editor' as const, status: 'online' as const, joinedAt: 7 }

    expect(nativeSessionEvent({ type: 'session_owner_changed', sessionId: 's1', owner }))
      .toEqual({ type: 'session_owner_changed', sessionId: 's1', owner })
    expect(nativeSessionEvent({ type: 'session_owner_changed', sessionId: 's1', owner: null }))
      .toEqual({ type: 'session_owner_changed', sessionId: 's1', owner: null })
    expect(nativeSessionEvent({ type: 'session_visibility_changed', sessionId: 's1', visibility: 'read-only' }))
      .toEqual({ type: 'session_visibility_changed', sessionId: 's1', visibility: 'read-only' })
    expect(nativeSessionEvent({
      type: 'session_typing', sessionId: 's1',
      actors: [{ accountId: 'ada', displayName: 'Ada', expiresAt: 9 }],
    })).toEqual({
      type: 'session_typing', sessionId: 's1',
      actors: [{ accountId: 'ada', displayName: 'Ada', expiresAt: 9 }],
    })
    expect(nativeSessionEvent({ type: 'session_presence', sessionId: 's1', viewers: [viewer] }))
      .toEqual({ type: 'session_presence', sessionId: 's1', viewers: [viewer] })
  })
})