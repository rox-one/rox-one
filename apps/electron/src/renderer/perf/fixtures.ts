import { createPrng } from './prng'
import type { PermissionMode, SessionIndexEntry, VaultNoteEntry } from './types'

export const FIXTURE_SEED = 20260903
export const SESSION_FIXTURE_COUNTS = [500, 2000] as const
export const LARGE_VAULT_NOTE_COUNT = 5000

const STATUSES = ['todo', 'in-progress', 'needs-review', 'done'] as const
const MODES: PermissionMode[] = ['safe', 'ask', 'allow-all']

export interface SessionFixture {
  count: number
  seed: number
  workspaceId: string
  sessions: SessionIndexEntry[]
}

export interface VaultFixture {
  count: number
  seed: number
  notes: VaultNoteEntry[]
}

export function createSessionFixture(
  count: 500 | 2000,
  seed = FIXTURE_SEED,
): SessionFixture {
  const rand = createPrng(seed + count)
  const workspaceId = 'ws-perf-harness'
  const sessions: SessionIndexEntry[] = []
  const origin = 1_704_067_200_000

  for (let i = 0; i < count; i++) {
    const createdAt = origin + i * 60_000
    sessions.push({
      id: `sess-${String(i).padStart(5, '0')}`,
      workspaceId,
      name: `Session ${i}`,
      createdAt,
      lastUsedAt: createdAt + Math.floor(rand() * 86_400_000),
      lastMessageAt: createdAt + Math.floor(rand() * 43_200_000),
      messageCount: Math.floor(rand() * 40),
      preview: `preview ${i} lorem`,
      sessionStatus: STATUSES[i % STATUSES.length] ?? 'todo',
      permissionMode: MODES[i % MODES.length] ?? 'ask',
      labels: i % 7 === 0 ? [`label-${i % 11}`] : [],
      projectId: i % 9 === 0 ? `proj-${i % 5}` : null,
      isArchived: i % 37 === 0,
    })
  }

  return { count, seed, workspaceId, sessions }
}

export function createLargeVaultFixture(
  count = LARGE_VAULT_NOTE_COUNT,
  seed = FIXTURE_SEED,
): VaultFixture {
  const rand = createPrng(seed + count + 17)
  const notes: VaultNoteEntry[] = []
  const origin = 1_704_067_200_000

  for (let i = 0; i < count; i++) {
    const linkCount = i % 5
    const outboundLinks: string[] = []
    for (let j = 0; j < linkCount; j++) {
      outboundLinks.push(`note-${String((i + j + 1) % count).padStart(5, '0')}`)
    }
    notes.push({
      id: `note-${String(i).padStart(5, '0')}`,
      path: `vault/notes/note-${String(i).padStart(5, '0')}.md`,
      title: `Note ${i}`,
      updatedAt: origin + Math.floor(rand() * 86_400_000 * 30),
      outboundLinks,
      sizeBytes: 200 + Math.floor(rand() * 8_000),
    })
  }

  return { count, seed, notes }
}

export function indexSessionsById(
  sessions: SessionIndexEntry[],
): Map<string, SessionIndexEntry> {
  const index = new Map<string, SessionIndexEntry>()
  for (const session of sessions) {
    index.set(session.id, session)
  }
  return index
}
