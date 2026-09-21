/**
 * E29 RED harness lifecycle (#385): network leak, production+fixture denial,
 * restart persistence smoke, shutdown cleanup.
 */
import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bootMeetingApp, productionFixtureGuard } from './harness'
import { createFixtureGateway } from './gateway'

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test.describe('meeting-agents RED lifecycle (#385 / E29)', () => {
  test('production + fixture entrypoint is denied (env alone is not transport)', () => {
    expect(
      productionFixtureGuard({
        nodeEnv: 'production',
        fixtureEntrypoint: true,
      }).reason,
    ).toBe('production-fixture-entrypoint')
    expect(
      productionFixtureGuard({
        fixtureEntrypoint: false,
        fakeTransportEnv: '1',
      }).reason,
    ).toBe('env-flag-is-not-transport')
  })

  test('network leak outside loopback increments forbiddenCalls', async () => {
    const gw = await createFixtureGateway()
    try {
      await gw.reset('network-leak')
      expect((await gw.counts()).forbiddenCalls).toBe(0)
      await gw.recordForbidden()
      expect((await gw.counts()).forbiddenCalls).toBe(1)
      // Unauthenticated / non-loopback clients must not read counts
      const denied = await fetch(`${gw.origin}/counts`)
      expect(denied.status).toBe(401)
    } finally {
      await gw.close()
    }
  })

  test('restart persistence smoke on same profileDir', async () => {
    const h = await bootMeetingApp({ caseId: 'restart-smoke' })
    try {
      const profileDir = h.profileDir
      const pid1 = h.pid
      const markerPath = join(profileDir, 'user-marker.txt')
      await writeFile(markerPath, 'persist-me', 'utf8')
      const storePath = join(profileDir, 'config', 'meeting-agents', 'store.json')
      const before = JSON.parse(await readFile(storePath, 'utf8')) as { bootCount: number }
      expect(before.bootCount).toBe(1)

      await h.restart()
      expect(h.profileDir).toBe(profileDir)
      expect(h.pid).not.toBe(pid1)
      expect(pidAlive(h.pid)).toBe(true)
      expect(pidAlive(pid1)).toBe(false)
      expect(await readFile(markerPath, 'utf8')).toBe('persist-me')
      const after = JSON.parse(await readFile(storePath, 'utf8')) as { bootCount: number }
      expect(after.bootCount).toBe(2)
      expect((await h.gateway.counts()).forbiddenCalls).toBe(0)
    } finally {
      await h.dispose()
    }
  })

  test('shutdown cleanup stops Electron and removes owned temp profile', async () => {
    const h = await bootMeetingApp({ caseId: 'shutdown' })
    const pid = h.pid
    const profileDir = h.profileDir
    await h.dispose()
    expect(pidAlive(pid)).toBe(false)
    expect(existsSync(profileDir)).toBe(false)
  })
})
