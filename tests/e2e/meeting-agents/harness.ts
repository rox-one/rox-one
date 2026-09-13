/**
 * RMA-I029 / #385 — E2E harness contract.
 * Env flags do not enable fake transport. Fixture entrypoint is not production.
 */

export type MeetingAppHandles = {
  readonly caseId: string
  readonly profileDir: string
  readonly gateway: 'loopback-fixture' | 'production'
}

export type BootMeetingApp = (input: {
  readonly caseId: string
  readonly profileDir?: string
}) => Promise<{
  readonly app: MeetingAppHandles
  readonly page: unknown
  readonly profileDir: string
  readonly gateway: MeetingAppHandles['gateway']
  restart: () => Promise<void>
  dispose: () => Promise<void>
}>

export function productionFixtureGuard(input: {
  readonly nodeEnv?: string
  readonly fixtureEntrypoint: boolean
  readonly fakeTransportEnv?: string
}): { ok: true } | { ok: false; reason: string } {
  if (input.fixtureEntrypoint && input.nodeEnv === 'production') {
    return { ok: false, reason: 'production-fixture-entrypoint' }
  }
  if (input.fakeTransportEnv === '1') {
    return { ok: false, reason: 'env-flag-is-not-transport' }
  }
  return { ok: true }
}

export function evidenceRow(
  level: 'U1' | 'C2' | 'E3' | 'L4' | 'N5',
  status: 'passed' | 'failed' | 'blocked' | 'not_run',
): { level: string; status: string } {
  return { level, status }
}

export const bootMeetingApp: BootMeetingApp = async () => {
  throw new Error('bootMeetingApp requires a real Electron factory; default is fail-closed')
}
