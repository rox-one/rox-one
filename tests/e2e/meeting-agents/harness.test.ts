import { describe, expect, it } from 'bun:test'
import { bootMeetingApp, evidenceRow, productionFixtureGuard } from './harness.ts'

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

  it('bootMeetingApp has no silent fake Electron', async () => {
    await expect(bootMeetingApp({ caseId: 'bootstrap' })).rejects.toThrow(/fail-closed/)
  })

  it('splits evidence levels', () => {
    expect(evidenceRow('E3', 'passed').level).toBe('E3')
    expect(evidenceRow('L4', 'blocked').status).toBe('blocked')
  })
})
