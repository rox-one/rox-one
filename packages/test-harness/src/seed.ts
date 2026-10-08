/**
 * W1-10 (#1507) — seeded two-user workspace.
 *
 * Deterministic in-memory seed: users A (owner) and B (member), two spaces,
 * directory people and a DM. Wave-2 journey tests (J1–J23) build on this
 * seed; the wave-1 scope is the seed itself plus its determinism guarantee.
 */

export interface SeededUser {
  principalId: string
  handle: string
  displayName: string
  email: string
  role: 'owner' | 'member'
}

export interface SeededSpace {
  spaceId: string
  name: string
  memberIds: string[]
  chatId: string
  folderId: string
  taskListId: string
}

export interface SeededWorkspace {
  workspaceId: string
  users: [SeededUser, SeededUser]
  spaces: SeededSpace[]
  dmChatId: string
  generalChatId: string
  seedTag: string
}

export const SEED_TAG = 'w1-10/seed-v1'

export function seedTwoUserWorkspace(): SeededWorkspace {
  const alice: SeededUser = {
    principalId: 'principal:alice',
    handle: '@alice',
    displayName: 'Alice',
    email: 'alice@example.test',
    role: 'owner',
  }
  const bob: SeededUser = {
    principalId: 'principal:bob',
    handle: '@bob',
    displayName: 'Bob',
    email: 'bob@example.test',
    role: 'member',
  }
  return {
    workspaceId: 'workspace:seed',
    users: [alice, bob],
    spaces: [
      {
        spaceId: 'space:marketing',
        name: 'Marketing',
        memberIds: [alice.principalId, bob.principalId],
        chatId: 'chat:marketing',
        folderId: 'folder:marketing',
        taskListId: 'task-list:marketing',
      },
      {
        spaceId: 'space:platform',
        name: 'Platform',
        memberIds: [alice.principalId],
        chatId: 'chat:platform',
        folderId: 'folder:platform',
        taskListId: 'task-list:platform',
      },
    ],
    dmChatId: 'chat:dm-alice-bob',
    generalChatId: 'chat:general',
    seedTag: SEED_TAG,
  }
}
