/**
 * W1-10 (#1507) — workspace-service harness self-tests.
 *
 * Covers the seeded two-user workspace, temp-dir isolation and the
 * Postgres fixture contract: live (after a SELECT 1 probe) when
 * ROX_TEST_PG_URL is set, opt-in docker only with ROX_TEST_PG_DOCKER=1,
 * skipped otherwise. A plain run never starts or pulls a container.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { seedTwoUserWorkspace } from '@rox/test-harness'
import { makeTempWorkspace, tempHomeEnv, pgOrSkip } from './harness-helpers.ts'

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

  test('postgres fixture: live when configured, otherwise skipped without docker', async () => {
    const { fixture } = await pgOrSkip()
    try {
      if (process.env.ROX_TEST_PG_URL) expect(fixture.status).toBe('live')
      else if (process.env.ROX_TEST_PG_DOCKER !== '1') expect(fixture.status).toBe('skipped')
      else expect(fixture.status).toBe('live')
    } finally {
      if (fixture.cleanup) await fixture.cleanup()
    }
  })
})
