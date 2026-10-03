import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setSearchPlatform, searchSessions } from '../search'
import type { PlatformServices } from '../../runtime/platform'

const roots: string[] = []

beforeAll(() => {
  setSearchPlatform({
    appRootPath: process.cwd(),
    resourcesPath: process.cwd(),
    isPackaged: false,
    appVersion: 'test',
    imageProcessor: {} as PlatformServices['imageProcessor'],
    logger: console,
    isDebugMode: false,
  } as PlatformServices)
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createSessions(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-search-visibility-'))
  roots.push(root)
  for (const [id, body] of [
    ['allowed-session', 'authorizedneedle'],
    ['denied-session', 'restrictedneedle'],
  ]) {
    const sessionDir = join(root, id)
    mkdirSync(sessionDir)
    writeFileSync(
      join(sessionDir, 'session.jsonl'),
      `${JSON.stringify({ type: 'session', id })}\n${JSON.stringify({ type: 'user', content: body })}\n`,
    )
  }
  return root
}

describe('session content search visibility', () => {
  it('retains only allowlisted session content and treats an empty allowlist as deny-all', async () => {
    const sessionsDir = createSessions()
    const visible = await searchSessions('needle', sessionsDir, {
      allowedSessionIds: ['allowed-session'],
    })

    expect(visible.map((result) => result.sessionId)).toEqual(['allowed-session'])
    expect(visible[0]?.matches[0]?.snippet).toContain('authorizedneedle')
    expect(JSON.stringify(visible)).not.toContain('restrictedneedle')

    expect(await searchSessions('needle', sessionsDir, { allowedSessionIds: [] })).toEqual([])
  })
})
