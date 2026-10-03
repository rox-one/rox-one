import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSession, saveSession, sessionPersistenceQueue, type StoredSession } from '@rox/shared/sessions'
import { storedToMessage } from '@rox/core/types'
import { createReactionAnnotation } from '../../../ui/src/components/chat/message-reactions'
import { SessionManager, createManagedSession } from './SessionManager'

const roots: string[] = []
afterEach(async () => { await sessionPersistenceQueue.flushAll(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('own-message reactions persist and broadcast', () => {
  it('saves, restores and removes a canonical user-message like without changing the assistant', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-own-reaction-')); roots.push(root)
    const workspace = { id: 'workspace-message-fixture', slug: 'workspace-message-fixture', name: 'Synthetic workspace', rootPath: root, createdAt: 1 }
    const stored: StoredSession = {
      id: 'session-message-fixture', workspaceRootPath: root, createdAt: 1, lastUsedAt: 1,
      messages: [
        { id: 'canonical-user', type: 'user', content: 'Synthetic own message', timestamp: 1 },
        { id: 'assistant', type: 'assistant', content: 'Synthetic reply', timestamp: 2 },
      ],
    } as StoredSession
    await saveSession(stored)
    const manager = new SessionManager()
    const managed = createManagedSession({ ...stored, messages: stored.messages.map(storedToMessage) }, workspace)
    managed.messages = stored.messages.map(storedToMessage)
    managed.messagesLoaded = true
    const events: any[] = []
    ;(manager as any).sessions.set(stored.id, managed)
    ;(manager as any).sendEvent = (event: any) => { events.push(event) }
    const reaction = createReactionAnnotation({ messageId: 'canonical-user', sessionId: stored.id, emoji: '❤️', actor: { id: 'local-user', type: 'user' } })
    manager.addMessageAnnotation(stored.id, 'canonical-user', reaction)
    await sessionPersistenceQueue.flush(stored.id)
    const restored = loadSession(root, stored.id)!
    expect(restored.messages[0]?.annotations?.map(annotation => annotation.id)).toEqual([reaction.id])
    expect(restored.messages[1]?.annotations).toBeUndefined()
    expect(events.at(-1)).toMatchObject({ type: 'message_annotations_updated', messageId: 'canonical-user', annotations: [reaction] })

    manager.removeMessageAnnotation(stored.id, 'canonical-user', reaction.id)
    await sessionPersistenceQueue.flush(stored.id)
    expect(loadSession(root, stored.id)?.messages[0]?.annotations).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: 'message_annotations_updated', messageId: 'canonical-user', annotations: [] })
  })
})
