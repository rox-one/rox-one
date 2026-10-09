import { describe, expect, it } from 'bun:test'
import {
  decideOnboardDaemon,
  detectExternalSupervisor,
  readOnboardDaemonFlags,
  ROX_SERVICE_LABEL,
} from '../onboard-daemon-decision.ts'

const base = { flow: 'classic', externallySupervised: false, interactive: false } as const

describe('decideOnboardDaemon — tri-state table', () => {
  it('installs on an explicit --install-daemon even in a non-interactive classic run', () => {
    expect(decideOnboardDaemon({ ...base, installDaemon: true })).toMatchObject({
      state: 'install',
      reason: 'flag-install',
      source: 'flag',
    })
  })

  it('installs by default in the quickstart flow', () => {
    expect(decideOnboardDaemon({ ...base, flow: 'quickstart' })).toMatchObject({
      state: 'install',
      reason: 'quickstart-default',
      source: 'quickstart',
    })
  })

  it('installs for an interactive classic wizard prompt (default true)', () => {
    expect(decideOnboardDaemon({ ...base, interactive: true })).toMatchObject({
      state: 'install',
      reason: 'interactive-default',
      source: 'interactive',
    })
  })

  it('skips when an external supervisor owns the process', () => {
    expect(decideOnboardDaemon({ ...base, externallySupervised: true })).toMatchObject({
      state: 'skip',
      reason: 'externally-supervised',
      source: 'supervision',
    })
  })

  it('refuses with a reason when non-interactive and neither install nor skip applies', () => {
    const decision = decideOnboardDaemon({ ...base, flow: 'classic' })
    expect(decision.state).toBe('refuse')
    expect(decision.reason).toBe('non-interactive')
  })
})

describe('decideOnboardDaemon — precedence', () => {
  it('lets --skip-daemon win over --install-daemon', () => {
    expect(decideOnboardDaemon({ ...base, skipDaemon: true, installDaemon: true })).toMatchObject({
      state: 'skip',
      reason: 'flag-skip',
    })
  })

  it('treats --no-install-daemon as an explicit skip', () => {
    expect(decideOnboardDaemon({ ...base, installDaemon: false })).toMatchObject({
      state: 'skip',
      reason: 'flag-no-install',
    })
  })

  it('lets skip (external supervision) win over the quickstart install default', () => {
    expect(decideOnboardDaemon({ ...base, flow: 'quickstart', externallySupervised: true })).toMatchObject({
      state: 'skip',
      reason: 'externally-supervised',
    })
  })

  it('lets an explicit --install-daemon beat external supervision', () => {
    expect(decideOnboardDaemon({ ...base, installDaemon: true, externallySupervised: true })).toMatchObject({
      state: 'install',
      reason: 'flag-install',
    })
  })

  it('lets an explicit --install-daemon beat the interactive default', () => {
    expect(decideOnboardDaemon({ ...base, installDaemon: true, interactive: true }).reason).toBe('flag-install')
  })
})

describe('readOnboardDaemonFlags', () => {
  it('reads each flag independently', () => {
    expect(readOnboardDaemonFlags(['app'])).toEqual({ installDaemon: undefined, skipDaemon: false, quickstart: false })
    expect(readOnboardDaemonFlags(['app', '--install-daemon'])).toEqual({ installDaemon: true, skipDaemon: false, quickstart: false })
    expect(readOnboardDaemonFlags(['app', '--no-install-daemon'])).toEqual({ installDaemon: false, skipDaemon: false, quickstart: false })
    expect(readOnboardDaemonFlags(['app', '--skip-daemon', '--quickstart'])).toEqual({ installDaemon: undefined, skipDaemon: true, quickstart: true })
  })

  it('lets --no-install-daemon win over --install-daemon', () => {
    expect(readOnboardDaemonFlags(['app', '--install-daemon', '--no-install-daemon']).installDaemon).toBe(false)
  })
})

describe('detectExternalSupervisor', () => {
  it('detects the ROX managed-service marker regardless of platform', () => {
    expect(detectExternalSupervisor({ ROX_SERVICE_MANAGED: '1' }, 'darwin')).toBe('rox-service')
    expect(detectExternalSupervisor({ ROX_SERVICE_MANAGED: '0' }, 'darwin')).toBeNull()
  })

  it('detects a launchd job only when the label is the ROX service label', () => {
    expect(detectExternalSupervisor({ XPC_SERVICE_NAME: ROX_SERVICE_LABEL }, 'darwin')).toBe('launchd')
    expect(detectExternalSupervisor({ LAUNCH_JOB_LABEL: ROX_SERVICE_LABEL }, 'darwin')).toBe('launchd')
    // A plain GUI launch exposes a com.apple.* XPC name; it is not supervised.
    expect(detectExternalSupervisor({ XPC_SERVICE_NAME: 'application.com.rox.app.1.2' }, 'darwin')).toBeNull()
  })

  it('detects a systemd user unit from its environment markers', () => {
    expect(detectExternalSupervisor({ INVOCATION_ID: 'abc' }, 'linux')).toBe('systemd')
    expect(detectExternalSupervisor({ JOURNAL_STREAM: '8:1' }, 'linux')).toBe('systemd')
    expect(detectExternalSupervisor({}, 'linux')).toBeNull()
  })

  it('detects a Windows Scheduled Task marker', () => {
    expect(detectExternalSupervisor({ ROX_WINDOWS_TASK_NAME: 'RoxGateway' }, 'win32')).toBe('schtasks')
    expect(detectExternalSupervisor({}, 'win32')).toBeNull()
  })
})