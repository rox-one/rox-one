/**
 * Deterministic session and vault fixtures. No secrets, no real paths.
 */

export interface FixtureSessionMeta {
  id: string
  name: string
  workspaceId: string
  lastMessageAt: number
  messageCount: number
  permissionMode: 'safe' | 'ask' | 'allow-all'
  messagesLoaded: boolean
  preview: string
}

export interface FixtureNote {
  id: string
  title: string
  folder: string
  bytes: number
}

export interface SessionFixture {
  name: 'sessions-500' | 'sessions-2000'
  workspaceId: string
  sessions: FixtureSessionMeta[]
}

export interface VaultFixture {
  name: 'large-vault'
  notes: FixtureNote[]
}

const WORKSPACE_ID = 'ws-bench'
const EPOCH = 1_725_000_000_000
const MODES: Array<FixtureSessionMeta['permissionMode']> = ['safe', 'ask', 'allow-all']

export function createSessionFixture(count: 500 | 2000): SessionFixture {
  const sessions: FixtureSessionMeta[] = []
  for (let i = 0; i < count; i += 1) {
    const id = `sess-${String(i).padStart(4, '0')}`
    sessions.push({
      id,
      name: `Session ${i}`,
      workspaceId: WORKSPACE_ID,
      lastMessageAt: EPOCH + i * 1000,
      messageCount: (i % 7) + 1,
      permissionMode: MODES[i % 3] ?? 'ask',
      messagesLoaded: true,
      preview: `preview-${i}`,
    })
  }
  return {
    name: count === 500 ? 'sessions-500' : 'sessions-2000',
    workspaceId: WORKSPACE_ID,
    sessions,
  }
}

export function createLargeVaultFixture(noteCount = 2000): VaultFixture {
  const notes: FixtureNote[] = []
  for (let i = 0; i < noteCount; i += 1) {
    notes.push({
      id: `note-${String(i).padStart(4, '0')}`,
      title: `Note ${i}`,
      folder: `folder-${Math.floor(i / 50)}`,
      bytes: 256 + (i % 128),
    })
  }
  return { name: 'large-vault', notes }
}

export function warmSessionCache(sessions: FixtureSessionMeta[]): Map<string, FixtureSessionMeta> {
  return new Map(sessions.map((session) => [session.id, session]))
}

export function lookupCachedSession(
  cache: Map<string, FixtureSessionMeta>,
  sessionId: string,
): FixtureSessionMeta | undefined {
  return cache.get(sessionId)
}
