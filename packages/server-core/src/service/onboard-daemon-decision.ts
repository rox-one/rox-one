/**
 * Onboard `--install-daemon` tri-state decision (port row e1.3).
 *
 * Re-expresses `ensureGatewayServiceForOnboarding`
 * (`src/wizard/setup.finalize.ts:252-266`) and the flag surface of
 * `register.onboard` (`src/cli/program/register.onboard.ts:14-23`) as one pure,
 * testable decision. The upstream ordering is extended with the supervision
 * auto-skip so ROX never installs a second service beside an operator's.
 *
 * Precedence (highest first):
 *   1. `--skip-daemon`                    → skip   (explicit skip beats *every* install source)
 *   2. `--no-install-daemon`              → skip   (explicit skip)
 *   3. `--install-daemon`                 → install (explicit flag beats defaults and supervision)
 *   4. external supervisor detected       → skip   (never duplicate launchd/systemd/schtasks/ROX service)
 *   5. quickstart flow                    → install (default)
 *   6. interactive classic wizard         → install (upstream prompt defaults to true)
 *   7. otherwise                          → refuse (non-interactive and neither applies)
 */

/** launchd label installed by the ROX service definition (see main service setup). */
export const ROX_SERVICE_LABEL = 'com.rox.service'

export type OnboardDaemonState = 'install' | 'skip' | 'refuse'

export type OnboardDaemonReason =
  | 'flag-skip'
  | 'flag-no-install'
  | 'flag-install'
  | 'externally-supervised'
  | 'quickstart-default'
  | 'interactive-default'
  | 'non-interactive'

export type OnboardDaemonSource = 'flag' | 'supervision' | 'quickstart' | 'interactive' | 'non-interactive'

export interface OnboardDaemonDecisionInput {
  /** `--install-daemon` (true) or `--no-install-daemon` (false); undefined = no explicit choice. */
  installDaemon?: boolean
  /** `--skip-daemon`; wins over every install source. */
  skipDaemon?: boolean
  /** Wizard flow; `quickstart` defaults to install. */
  flow: 'quickstart' | 'classic' | string
  /** An external supervisor (ROX service, launchd job, systemd unit, Scheduled Task) owns the process. */
  externallySupervised: boolean
  /** Whether the caller can prompt the operator (the classic wizard). */
  interactive: boolean
}

export interface OnboardDaemonDecision {
  state: OnboardDaemonState
  reason: OnboardDaemonReason
  source: OnboardDaemonSource
  /** One-line explanation of the applied precedence rule (for logs). */
  note: string
}

/** Which supervisor family is already managing this process. */
export type ExternalSupervisorKind = 'rox-service' | 'launchd' | 'systemd' | 'schtasks'

function hasValue(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = env[key]
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Detects an external supervisor from process environment markers, mirroring
 * `src/infra/supervisor-markers.ts`. launchd is matched on the ROX service label
 * only, so a plain GUI launch (`XPC_SERVICE_NAME=application.com.rox...`) is not
 * mistaken for a supervised service.
 */
export function detectExternalSupervisor(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ExternalSupervisorKind | null {
  if (env.ROX_SERVICE_MANAGED?.trim() === '1') return 'rox-service'
  if (platform === 'darwin') {
    const launchdLabel = env.XPC_SERVICE_NAME?.trim() ?? env.LAUNCH_JOB_LABEL?.trim() ?? env.LAUNCH_JOB_NAME?.trim()
    return launchdLabel === ROX_SERVICE_LABEL ? 'launchd' : null
  }
  if (platform === 'linux') {
    return hasValue(env, 'INVOCATION_ID') || hasValue(env, 'SYSTEMD_EXEC_PID') || hasValue(env, 'JOURNAL_STREAM')
      ? 'systemd'
      : null
  }
  if (platform === 'win32') {
    return hasValue(env, 'ROX_WINDOWS_TASK_NAME') ? 'schtasks' : null
  }
  return null
}

export interface OnboardDaemonFlags {
  installDaemon?: boolean
  skipDaemon: boolean
  quickstart: boolean
}

/**
 * Reads the onboard daemon flags from argv. `--no-install-daemon` wins over
 * `--install-daemon` (skip wins over install); `--skip-daemon` is reported
 * separately and outranks both in the decision.
 */
export function readOnboardDaemonFlags(argv: readonly string[]): OnboardDaemonFlags {
  const wantsInstall = argv.includes('--install-daemon')
  const wantsNoInstall = argv.includes('--no-install-daemon')
  return {
    installDaemon: wantsNoInstall ? false : wantsInstall ? true : undefined,
    skipDaemon: argv.includes('--skip-daemon'),
    quickstart: argv.includes('--quickstart'),
  }
}

export function decideOnboardDaemon(input: OnboardDaemonDecisionInput): OnboardDaemonDecision {
  if (input.skipDaemon === true) {
    return { state: 'skip', reason: 'flag-skip', source: 'flag', note: '--skip-daemon overrides every install source' }
  }
  if (input.installDaemon === false) {
    return { state: 'skip', reason: 'flag-no-install', source: 'flag', note: '--no-install-daemon is an explicit skip' }
  }
  if (input.installDaemon === true) {
    return { state: 'install', reason: 'flag-install', source: 'flag', note: 'explicit --install-daemon beats defaults' }
  }
  if (input.externallySupervised) {
    return { state: 'skip', reason: 'externally-supervised', source: 'supervision', note: 'an external supervisor owns the process; never install a second service' }
  }
  if (input.flow === 'quickstart') {
    return { state: 'install', reason: 'quickstart-default', source: 'quickstart', note: 'quickstart installs the service by default' }
  }
  if (input.interactive) {
    return { state: 'install', reason: 'interactive-default', source: 'interactive', note: 'classic wizard prompts; default is install' }
  }
  return { state: 'refuse', reason: 'non-interactive', source: 'non-interactive', note: 'non-interactive and neither install nor skip applies' }
}