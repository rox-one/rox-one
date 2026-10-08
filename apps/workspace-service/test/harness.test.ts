/**
 * W1-10 (#1507) — workspace-service harness self-tests.
 *
 * Covers the seeded two-user workspace, temp-dir isolation and the
 * Postgres fixture contract (live when ROX_TEST_PG_URL is set, skipped
 * otherwise — never failing).
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { seedTwoUserWorkspace } from '@rox/test-harness'
import { makeTempWorkspace, tempHomeEnv, pgOrSkip } from './helpers.ts'

describe('workspace-service harness', () => {
  test('seeded workspace has owner, member, spaces and chats', () => {
    const ws = seedTwoUserWorkspace()
    expect(ws.users).toHaveLength(2)
    expect(ws.users[0].role).toBe('owner')
    expect(ws.users[1].role).toBe('member')
    for (const space of ws.spaces) {
      expect(space.chatId).toBeString()
      expect(space.folderId).toBeString()
      expect(space.taskListId).toBeString()
    }
  })

  test('temp workspaces live outside the real home', () => {
    const dir = makeTempWorkspace()
    expect(existsSync(dir)).toBe(true)
    const home = process.env.HOME ?? ''
    expect(dir.startsWith(home)).toBe(false)
  })

  test('temp HOME never points at the real config', () => {
    const env = tempHomeEnv()
    expect(env.HOME).toBeString()
    expect(env.HOME).not.toBe(process.env.HOME)
  })

  test('postgres fixture is live-or-skipped, never failing', async () => {
    const { fixture } = await pgOrSkip()
    expect(['live', 'skipped']).toContain(fixture.status)
    if (fixture.cleanup) await fixture.cleanup()
  })
})
