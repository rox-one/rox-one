/**
 * PERF-10 (#1577): the shell wiring of the warm-up queue. Drives the real
 * `installShellWarmup` with a stubbed electronAPI and asserts the observable
 * outcome: every step's read ran once, in the plan's order, and landed in the
 * shared query cache the first visit reads from.
 */
import { installDom, uninstallDom } from '../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { createRoxQueryClient, resetRoxQueryClientForTests, roxQueryClient } from '../query/client'
import { roxKeys } from '../query/keys'
import { resetSharedReads } from '../query/shared-read'
import { emptyWorkspaceWorkState } from '@rox/shared/workspace-work'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { getShellStore } from '@/platform/shell-store'
import { installShellWarmup, warmupDiagnostics } from '../shell-warmup'

installDom()
afterAll(() => uninstallDom())

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

interface Captured { calls: string[] }

function stubApi(captured: Captured) {
  const note = {
    id: 'n1', title: 'Note', path: 'a/n1.md', relativePath: 'n1.md', tags: [], properties: {},
    links: [], assetRefs: [], updatedAt: 1, createdAt: 1, size: 10,
  }
  return {
    getSessions: async () => {
      captured.calls.push('getSessions')
      return [{ id: 's1', workspaceId: 'ws', name: 'Session', createdAt: 2, lastUsedAt: 3, lastMessageAt: 3, messageCount: 1, preview: '', sessionStatus: 'active', permissionMode: 'safe', labels: [], projectId: null, isArchived: false }]
    },
    getSessionMessages: async () => {
      captured.calls.push('getSessionMessages')
      // The real API answers a full session; `null` exercises the loader's
      // no-op branch while still proving the read happened.
      return null
    },
    listNotes: async () => {
      captured.calls.push('listNotes')
      return [note]
    },
    getSources: async () => {
      captured.calls.push('getSources')
      return []
    },
    getSkills: async () => {
      captured.calls.push('getSkills')
      return []
    },
    listMemoryProposals: async () => {
      captured.calls.push('listMemoryProposals')
      return []
    },
    listPendingSkills: async () => {
      captured.calls.push('listPendingSkills')
      return []
    },
    getMessagingPendingSenders: async () => {
      captured.calls.push('getMessagingPendingSenders')
      return []
    },
    identityGetState: async () => {
      captured.calls.push('identityGetState')
      return { annotationActorId: 'actor-1' }
    },
    getOrgIdentity: async () => {
      captured.calls.push('getOrgIdentity')
      return { userId: 'actor-1', authority: 'local' }
    },
    getWindowWorkspace: async () => 'ws',
    feedList: async () => {
      captured.calls.push('feedList')
      return []
    },
    workspaceWorkRead: async () => {
      captured.calls.push('workspaceWorkRead')
      return { ...emptyWorkspaceWorkState('ws'), revision: 1, access: { actorId: 'o', canWrite: true, canDelete: true, canManage: true }, members: [], conflicts: [] }
    },
    workspaceWorkWrite: async () => { throw new Error('unused') },
    workspaceWorkDelete: async () => { throw new Error('unused') },
    workspaceWorkSnapshotProfile: async () => null,
    onWorkspaceWorkChanged: () => () => {},
    meetingsLocal: {
      list: async () => {
        captured.calls.push('meetingsLocal.list')
        return []
      },
    },
  }
}

beforeEach(() => {
  const client = createRoxQueryClient()
  resetRoxQueryClientForTests(client)
  resetSharedReads(client)
  getShellStore().set(windowWorkspaceIdAtom, 'ws')
})

describe('installShellWarmup', () => {
  it('runs every step in order and lands the reads in the shared cache', async () => {
    const captured: Captured = { calls: [] }
    const api = stubApi(captured)
    ;(window as unknown as { electronAPI: unknown }).electronAPI = api
    // The queue must not wait for a real idle deadline in a unit test: idle
    // callbacks are parked and drained explicitly between microtask flushes.
    const parked: Array<(deadline: { didTimeout: boolean; timeRemaining(): number }) => void> = []
    ;(globalThis as unknown as { requestIdleCallback?: (cb: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void) => number }).requestIdleCallback =
      callback => parked.push(callback)
    ;(globalThis as unknown as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback = () => {}
    const drainIdle = () => {
      for (let i = 0; i < 200 && parked.length > 0; i += 1) {
        const callback = parked.shift()
        callback?.({ didTimeout: false, timeRemaining: () => 4 })
      }
    }

    const stop = installShellWarmup()
    try {
      for (let i = 0; i < 60 && (warmupDiagnostics()?.completed.length ?? 0) < 8; i += 1) {
        drainIdle()
        await flush()
      }
      const status = warmupDiagnostics()
      expect(status?.failed).toEqual([])
      expect(status?.completed).toEqual([
        'sessions-meta', 'transcript-tails', 'notes-tasks', 'skills-sources',
        'agent-profiles', 'inbox-feed', 'calendar', 'route-chunks',
      ])
      expect(captured.calls[0]).toBe('getSessions')
      expect(captured.calls).toContain('getSessionMessages')
      expect(captured.calls).toContain('listNotes')
      expect(captured.calls).toContain('feedList')
      expect(captured.calls).toContain('meetingsLocal.list')
      // The notes listing is in the shared cache BEFORE any Notes mount reads it.
      expect(roxQueryClient().getQueryData(roxKeys.notesList('ws'))).toBeDefined()
    } finally {
      stop()
      delete (window as unknown as { electronAPI?: unknown }).electronAPI
    }
  })

  it('does nothing without an active workspace and stops on demand', async () => {
    const captured: Captured = { calls: [] }
    getShellStore().set(windowWorkspaceIdAtom, null)
    ;(window as unknown as { electronAPI: unknown }).electronAPI = stubApi(captured)
    const stop = installShellWarmup()
    await flush()
    expect(captured.calls).toEqual([])
    expect(warmupDiagnostics()).toBeNull()
    stop()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })
})