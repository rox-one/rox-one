import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingJournal } from '../../../packages/server-core/src/meetings/journal.ts'
import { loadMeetingQueryIndex, saveMeetingQueryIndex } from '../../../packages/server-core/src/meetings/query-store.ts'
import { startFixtureGateway } from './fixture-gateway.ts'
import {
  bootMeetingApp,
  evidenceRow,
  isolatedEnv,
  PLAYWRIGHT_VERSION_PIN,
  productionFixtureGuard,
  productionSourcesForbidFixtureEnv,
  repoRoot,
  seedIsolatedProfile,
  setMeetingElectronFactory,
  writeEvidence,
  type MeetingPageHandle,
} from './harness.ts'

const opened: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  setMeetingElectronFactory(null)
  for (const item of opened.splice(0)) await item.close()
})

describe('meeting-agents harness (#385 / I029)', () => {
  test('fails closed when production would ship a fixture entrypoint', () => {
    expect(
      productionFixtureGuard({
        nodeEnv: 'production',
        fixtureEntrypoint: true,
      }).reason,
    ).toBe('production-fixture-entrypoint')
  })

  test('does not treat an env flag as a fake transport enable', () => {
    expect(
      productionFixtureGuard({
        fixtureEntrypoint: false,
        fakeTransportEnv: '1',
      }).reason,
    ).toBe('env-flag-is-not-transport')
  })

  test('production sources do not select fixture from an env flag', () => {
    expect(productionSourcesForbidFixtureEnv()).toEqual([])
  })

  test('bootMeetingApp has no silent fake Electron', async () => {
    await expect(bootMeetingApp({ caseId: 'bootstrap' })).rejects.toThrow(/fail-closed/)
  })

  test('splits evidence levels and never maps skip to pass', () => {
    expect(evidenceRow('E3', 'passed').level).toBe('E3')
    expect(evidenceRow('L4', 'blocked').result).toBe('blocked')
    expect(evidenceRow('N5', 'not_run').result).toBe('not_run')
    expect(['passed', 'failed', 'blocked', 'not_run']).toContain(evidenceRow('E3', 'not_run').result)
  })

  test('fixture gateway is loopback-only and counts forbidden egress', async () => {
    const gateway = await startFixtureGateway()
    opened.push(gateway)
    expect(gateway.url.startsWith('http://127.0.0.1:')).toBe(true)
    const health = await fetch(`${gateway.url}/health`)
    expect(health.ok).toBe(true)
    gateway.recordOutbound('https://example.invalid/v1/transcribe')
    expect(gateway.counts().forbiddenCalls).toBe(1)
    gateway.emitSegment({ id: 's1', text: 'прототип', final: true })
    expect(gateway.counts().modelCalls).toBe(1)
    const write = await fetch(`${gateway.url}/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'op-1', title: 'прототип' }),
    })
    expect(write.ok).toBe(true)
    expect(gateway.readRemote('op-1')?.operationId).toBe('op-1')
    gateway.failNext('write', 'after-effect')
    const failed = await fetch(`${gateway.url}/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'op-2' }),
    })
    expect(failed.status).toBe(500)
    expect(gateway.counts().remoteWrites).toBe(1)
  })

  test('restart updates handles on the same profile and dispose deletes only that temp dir', async () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'rox-meeting-e2e-restart-'))
    seedIsolatedProfile(profileDir)
    const marker = join(profileDir, 'workspace', 'meetings', 'query-index.json')
    writeFileSync(marker, '[]\n')
    let launches = 0
    setMeetingElectronFactory({
      async launch() {
        launches += 1
        const page: MeetingPageHandle = {
          getByTestId: () => ({
            click: async () => {},
            count: async () => launches,
            text: async () => `launch-${launches}`,
          }),
        }
        return { page, close: async () => {} }
      },
    })
    const h = await bootMeetingApp({ caseId: 'restart', profileDir })
    expect(h.profileDir).toBe(profileDir)
    expect(await h.page.getByTestId('meetings-page').text()).toBe('launch-1')
    await h.restart()
    expect(await h.page.getByTestId('meetings-page').text()).toBe('launch-2')
    expect(existsSync(marker)).toBe(true)
    await h.dispose()
    expect(existsSync(profileDir)).toBe(false)
    expect(launches).toBe(2)
  })

  test('isolated env does not point at the operator home config', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'rox-meeting-e2e-env-'))
    seedIsolatedProfile(profileDir)
    const env = isolatedEnv(profileDir, 'http://127.0.0.1:9')
    expect(env.HOME).toBe(join(profileDir, 'home'))
    expect(env.ROX_CONFIG_DIR).toBe(join(profileDir, 'config'))
    expect(env.CRAFT_CONFIG_DIR).toBe(join(profileDir, 'config'))
    expect(env.HOME).not.toBe(process.env.HOME)
    rmSync(profileDir, { recursive: true, force: true })
  })

  test('playwright pin is exact and evidence writes JSON', () => {
    expect(PLAYWRIGHT_VERSION_PIN).toBe('1.56.1')
    const path = writeEvidence(evidenceRow('E3', 'not_run', {
      caseId: 'E29',
      command: 'bun test tests/e2e/meeting-agents/harness.test.ts',
      blocker: 'Packaged Electron window not launched in this bun contract',
    }))
    expect(existsSync(path)).toBe(true)
    expect(repoRoot().includes('rox-one')).toBe(true)
  })

  test('C2 isolated profile keeps journal and query index across a new reader', async () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'rox-meeting-e2e-c2-'))
    seedIsolatedProfile(profileDir)
    const meetingsDir = join(profileDir, 'workspace', 'meetings')
    const journal = new MeetingJournal(meetingsDir, 'ws-a')
    await journal.load()
    await journal.append({
      commandId: 'c1',
      workspaceId: 'ws-a',
      expectedRevision: 0,
      type: 'create-meeting',
      payload: {
        meeting: {
          schemaVersion: 2,
          kind: 'meeting',
          ref: { workspaceId: 'ws-a', entityId: 'mtg-1', revisionId: 'r1' },
          title: 'Standup',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    }, { title: 'Standup' }, 'mtg-1')
    await saveMeetingQueryIndex(meetingsDir, [{
      id: 'mtg-1',
      workspaceId: 'ws-a',
      title: 'Standup',
      updatedAt: 1,
    }])
    const restarted = new MeetingJournal(meetingsDir, 'ws-a')
    const snapshot = await restarted.load()
    expect(snapshot.events).toHaveLength(1)
    const listed = await loadMeetingQueryIndex(meetingsDir)
    expect(listed.map((item) => item.id)).toEqual(['mtg-1'])
    rmSync(profileDir, { recursive: true, force: true })
  })
})
