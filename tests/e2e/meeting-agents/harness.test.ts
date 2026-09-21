import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  bootMeetingApp,
  evidenceRow,
  productionFixtureGuard,
  stampHarnessEvidence,
  type BootMeetingAppResult,
} from './harness.ts'
import { createFixtureGateway } from './gateway.ts'

const handles: BootMeetingAppResult[] = []

afterEach(async () => {
  while (handles.length > 0) {
    const h = handles.pop()
    await h?.dispose().catch(() => undefined)
  }
})

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('meeting-agents harness (#385)', () => {
  it('fails closed when production would ship a fixture entrypoint', () => {
    expect(
      productionFixtureGuard({
        nodeEnv: 'production',
        fixtureEntrypoint: true,
      }).reason,
    ).toBe('production-fixture-entrypoint')
  })

  it('does not treat an env flag as a fake transport enable', () => {
    expect(
      productionFixtureGuard({
        fixtureEntrypoint: false,
        fakeTransportEnv: '1',
      }).reason,
    ).toBe('env-flag-is-not-transport')
  })

  it('splits evidence levels', () => {
    expect(evidenceRow('E3', 'passed').level).toBe('E3')
    expect(evidenceRow('L4', 'blocked').status).toBe('blocked')
    expect(evidenceRow('N5', 'not_run').status).toBe('not_run')
  })

  it('never stamps E3 passed for fixture HTML / test-fixture entry', () => {
    const fixture = stampHarnessEvidence({
      entrypoint: 'test-fixture',
      productStateExercised: true,
    })
    expect(fixture.level).toBe('U1')
    expect(fixture.entrypoint).toBe('test-fixture')
    expect(`${fixture.level}:${fixture.status}`).not.toBe('E3:passed')

    const electronIdle = stampHarnessEvidence({
      entrypoint: 'apps-electron',
      productStateExercised: false,
    })
    expect(electronIdle).toMatchObject({
      level: 'E3',
      status: 'not_run',
      entrypoint: 'apps-electron',
      packaged: 'not_run',
    })

    const electronProduct = stampHarnessEvidence({
      entrypoint: 'apps-electron',
      productStateExercised: true,
    })
    expect(electronProduct).toMatchObject({
      level: 'E3',
      status: 'passed',
      entrypoint: 'apps-electron',
    })
  })

  it('bootMeetingApp refuses production + fixture entrypoint before spawn', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await expect(bootMeetingApp({ caseId: 'bootstrap' })).rejects.toThrow(
        /production-fixture-entrypoint|fail-closed/,
      )
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
    }
  })

  it('fixture gateway is loopback, authenticated, and counts live server state', async () => {
    const gw = await createFixtureGateway()
    try {
      expect(new URL(gw.origin).hostname).toBe('127.0.0.1')
      const denied = await fetch(`${gw.origin}/counts`)
      expect(denied.status).toBe(401)
      await gw.reset('bootstrap')
      await gw.emitSegment({ id: 'seg-1', text: 'прототип' })
      await gw.failNext('asr', 'timeout')
      const counts = await gw.counts()
      expect(counts).toEqual({
        modelCalls: 0,
        remoteWrites: 0,
        forbiddenCalls: 0,
        segments: 1,
      })
      expect(await gw.readRemote('missing-op')).toBeNull()
    } finally {
      await gw.close()
    }
  })

  it('bootMeetingApp starts a live Electron pid on an isolated profile', async () => {
    const h = await bootMeetingApp({ caseId: 'bootstrap' })
    handles.push(h)
    expect(h.pid).toBeGreaterThan(0)
    expect(pidAlive(h.pid)).toBe(true)
    expect(h.gateway.kind).toBe('loopback-fixture')
    expect(new URL(h.gateway.origin).hostname).toBe('127.0.0.1')
    expect(h.profileDir).toContain('meeting-agents')
    expect(existsSync(join(h.profileDir, 'home'))).toBe(true)
    expect(existsSync(join(h.profileDir, 'config'))).toBe(true)
    expect(h.page).not.toHaveProperty('getByTestId')
    expect(h.entrypoint).toBe('test-fixture')
    expect(h.evidence.level).toBe('U1')
    expect(h.evidence.status).toBe('passed')
    expect(h.evidence.entrypoint).toBe('test-fixture')
    expect(h.evidence.packaged).toBe('not_run')
    expect(`${h.evidence.level}:${h.evidence.status}`).not.toBe('E3:passed')
    const onDisk = JSON.parse(
      await readFile(join(h.profileDir, 'harness-evidence.json'), 'utf8'),
    ) as { level: string; status: string; entrypoint: string }
    expect(onDisk.entrypoint).toBe('test-fixture')
    expect(`${onDisk.level}:${onDisk.status}`).not.toBe('E3:passed')
  }, 60_000)

  it('restart reopens the same profileDir and keeps storage', async () => {
    const h = await bootMeetingApp({ caseId: 'bootstrap' })
    handles.push(h)
    const profileDir = h.profileDir
    const pid1 = h.pid
    const markerPath = join(profileDir, 'user-marker.txt')
    await writeFile(markerPath, 'persist-me', 'utf8')
    const storePath = join(profileDir, 'config', 'meeting-agents', 'store.json')
    const before = JSON.parse(await readFile(storePath, 'utf8')) as { bootCount: number; caseId: string }
    expect(before.caseId).toBe('bootstrap')
    expect(before.bootCount).toBe(1)

    await h.restart()
    expect(h.profileDir).toBe(profileDir)
    expect(h.pid).not.toBe(pid1)
    expect(pidAlive(h.pid)).toBe(true)
    expect(pidAlive(pid1)).toBe(false)
    expect(await readFile(markerPath, 'utf8')).toBe('persist-me')
    const after = JSON.parse(await readFile(storePath, 'utf8')) as { bootCount: number; caseId: string }
    expect(after.caseId).toBe('bootstrap')
    expect(after.bootCount).toBe(2)
    expect((await h.gateway.counts()).forbiddenCalls).toBe(0)
  }, 60_000)

  it('dispose stops Electron and removes only the owned temp profile', async () => {
    const h = await bootMeetingApp({ caseId: 'bootstrap' })
    const pid = h.pid
    const profileDir = h.profileDir
    await h.dispose()
    expect(pidAlive(pid)).toBe(false)
    expect(existsSync(profileDir)).toBe(false)
  }, 60_000)
})
