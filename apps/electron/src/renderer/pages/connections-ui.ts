export const IMPORT_PLACEHOLDERS = {
  env: '~/.env',
  gitConfig: '~/.gitconfig',
  dockerConfig: '~/.docker/config.json',
  awsCredentials: '~/.aws/credentials',
  awsConfig: '~/.aws/config',
  adc: '~/.config/gcloud/application_default_credentials.json',
} as const

export const CONNECT_SOURCES = [
  'github-env',
  'git-helper',
  'docker',
  'aws',
  'keychain',
  'adc',
  'ssh-agent',
  'github-oauth',
] as const

export const MOVE_BACKENDS = ['local-alt'] as const
export type MoveBackend = (typeof MOVE_BACKENDS)[number]

export type ConnectSource = (typeof CONNECT_SOURCES)[number]
export type PreviewSource = Exclude<ConnectSource, 'github-env'> | 'env'

export type TestStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'ok'; readonly login: string }
  | { readonly kind: 'error'; readonly message: string }

export function errorMessage(err: unknown): string {
  if (typeof err === 'string' && err.trim()) return err.trim()
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return '—'
}

export function visibleInspectValue(value: string) {
  return value && value !== '—' ? value : ''
}

export function consumersForConnection(
  bindings: readonly { readonly connectionId: string; readonly consumerId: string }[],
  connectionId: string,
): string[] {
  const seen = new Set<string>()
  const named: string[] = []
  for (const row of bindings) {
    if (row.connectionId !== connectionId || seen.has(row.consumerId)) continue
    seen.add(row.consumerId)
    named.push(row.consumerId)
  }
  return named
}

export function formatConfirmTargets(
  row: { readonly id: string; readonly credentialRefId: string },
  consumers: readonly string[],
): string {
  if (consumers.length === 0) return `${row.id} ${row.credentialRefId}`
  return `${row.id} ${row.credentialRefId} ${consumers.join(', ')}`
}

export interface ActiveLeaseView {
  readonly id: string
  readonly consumerId: string
  readonly purpose: string
  readonly action: string
  readonly status: string
}

const ACTIVE_LEASE_KEYS = new Set(['id', 'consumerId', 'purpose', 'action', 'status'])

export function sanitizeActiveLeases(raw: unknown): ActiveLeaseView[] {
  if (!Array.isArray(raw)) throw new Error('Invalid active lease metadata')
  return raw.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid active lease metadata')
    const rec = row as Record<string, unknown>
    for (const key of Object.keys(rec)) {
      if (!ACTIVE_LEASE_KEYS.has(key)) {
        throw new Error(`Invalid connection metadata field: ${key}`)
      }
    }
    if (
      typeof rec.id !== 'string'
      || typeof rec.consumerId !== 'string'
      || typeof rec.purpose !== 'string'
      || typeof rec.action !== 'string'
      || typeof rec.status !== 'string'
    ) {
      throw new Error('Invalid active lease metadata')
    }
    return {
      id: rec.id,
      consumerId: rec.consumerId,
      purpose: rec.purpose,
      action: rec.action,
      status: rec.status,
    }
  })
}

export function formatConfirmLeases(
  row: { readonly id: string; readonly credentialRefId: string },
  leases: readonly ActiveLeaseView[],
): string {
  if (leases.length === 0) return `${row.id} ${row.credentialRefId}`
  const named = leases.map((lease) => `${lease.id} ${lease.consumerId} ${lease.purpose} ${lease.action}`)
  return `${row.id} ${row.credentialRefId} ${named.join(', ')}`
}

export function sanitizeReconnectLeases(raw: unknown): Array<{ consumerId: string; status: string }> {
  if (!Array.isArray(raw)) throw new Error('Invalid reconnect lease metadata')
  return raw.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid reconnect lease metadata')
    const rec = row as Record<string, unknown>
    for (const key of Object.keys(rec)) {
      if (key !== 'consumerId' && key !== 'status') {
        throw new Error(`Invalid connection metadata field: ${key}`)
      }
    }
    if (typeof rec.consumerId !== 'string' || typeof rec.status !== 'string') {
      throw new Error('Invalid reconnect lease metadata')
    }
    return { consumerId: rec.consumerId, status: rec.status }
  })
}

export function formatReconnectLeases(
  leases: readonly { readonly consumerId: string; readonly status: string }[],
): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const row of leases) {
    const part = `${row.consumerId}: ${row.status}`
    if (seen.has(part)) continue
    seen.add(part)
    parts.push(part)
  }
  return parts.length === 0 ? '—' : parts.join(', ')
}

export function previewSourceForChip(chip: ConnectSource): PreviewSource {
  return chip === 'github-env' ? 'env' : chip
}

export function matchesConnectSource<T extends { readonly source: PreviewSource }>(
  rows: readonly T[],
  chip: ConnectSource | null,
): T[] {
  if (!chip) return [...rows]
  const source = previewSourceForChip(chip)
  return rows.filter((row) => row.source === source)
}

export function testStatusFromResult(result: { readonly login: string }): TestStatus {
  return { kind: 'ok', login: result.login }
}

export function testStatusFromError(err: unknown): TestStatus {
  return { kind: 'error', message: errorMessage(err) }
}

export function isImportPanelVisible(panel: PreviewSource, chip: ConnectSource | null): boolean {
  if (chip == null) return true
  return previewSourceForChip(chip) === panel
}

export function firstPickedPath(paths: unknown): string {
  if (typeof paths === 'string' && paths.trim()) return paths.trim()
  if (Array.isArray(paths) && typeof paths[0] === 'string' && paths[0].trim()) return paths[0].trim()
  return ''
}

export function removeCommittedPreview<T extends { readonly source: PreviewSource; readonly candidateId: string }>(
  rows: readonly T[],
  committed: { readonly source: PreviewSource; readonly candidateId: string },
): T[] {
  return rows.filter((row) => row.source !== committed.source || row.candidateId !== committed.candidateId)
}

export function cycleTab<T>(tabs: readonly T[], current: T, delta: number): T {
  const i = tabs.indexOf(current)
  if (i < 0 || tabs.length === 0) return current
  const n = tabs.length
  return tabs[(((i + delta) % n) + n) % n]
}

export function tabFromKey<T>(tabs: readonly T[], current: T, key: string): T | null {
  if (key === 'Home') return tabs[0] ?? current
  if (key === 'End') return tabs[tabs.length - 1] ?? current
  if (key === 'ArrowRight') return cycleTab(tabs, current, 1)
  if (key === 'ArrowLeft') return cycleTab(tabs, current, -1)
  return null
}

const CRED_REF_ID = /^cred_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUiCredentialRefId(value: string): boolean {
  return CRED_REF_ID.test(value.trim())
}

export function createDraftError(input: {
  readonly integrationId: string
  readonly credentialRefId: string
}): string | null {
  if (!input.integrationId.trim() || !isUiCredentialRefId(input.credentialRefId)) return '—'
  return null
}

export function parseCsvList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function grantDraftError(input: {
  readonly connectionId: string
  readonly consumerId: string
  readonly purpose: string
  readonly actions: string
  readonly resources: string
}): string | null {
  if (
    !input.connectionId.trim()
    || !input.consumerId.trim()
    || !input.purpose.trim()
    || parseCsvList(input.actions).length === 0
    || parseCsvList(input.resources).length === 0
  ) {
    return '—'
  }
  return null
}

const DEVICE_FORBIDDEN = new Set(['value', 'payload', 'secret', 'token', 'refreshToken', 'accessToken', 'deviceCode'])
const DEVICE_POLL_STATUS = new Set(['pending', 'slow_down', 'denied', 'expired', 'imported'])

export interface DeviceLoginView {
  readonly flowId: string
  readonly userCode: string
  readonly verificationUri: string
  readonly interval: number
  readonly expiresIn?: number
}

export type DevicePollView =
  | { readonly status: 'pending'; readonly interval?: number }
  | { readonly status: 'slow_down'; readonly interval?: number }
  | { readonly status: 'denied' }
  | { readonly status: 'expired' }
  | { readonly status: 'imported'; readonly connectionId: string }

function assertNoDeviceSecrets(rec: Record<string, unknown>): void {
  for (const key of Object.keys(rec)) {
    if (DEVICE_FORBIDDEN.has(key)) throw new Error(`Invalid connection metadata field: ${key}`)
  }
}

export function sanitizeDeviceLoginStart(raw: unknown): DeviceLoginView {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid device login metadata')
  const rec = raw as Record<string, unknown>
  assertNoDeviceSecrets(rec)
  if (typeof rec.flowId !== 'string' || typeof rec.userCode !== 'string') {
    throw new Error('Invalid device login metadata')
  }
  if (typeof rec.verificationUri !== 'string' || typeof rec.interval !== 'number') {
    throw new Error('Invalid device login metadata')
  }
  if (rec.expiresIn != null && typeof rec.expiresIn !== 'number') {
    throw new Error('Invalid device login metadata')
  }
  return {
    flowId: rec.flowId,
    userCode: rec.userCode,
    verificationUri: rec.verificationUri,
    interval: rec.interval,
    ...(typeof rec.expiresIn === 'number' ? { expiresIn: rec.expiresIn } : {}),
  }
}

export function sanitizeDevicePoll(raw: unknown): DevicePollView {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid device poll metadata')
  const rec = raw as Record<string, unknown>
  assertNoDeviceSecrets(rec)
  if (typeof rec.status !== 'string' || !DEVICE_POLL_STATUS.has(rec.status)) {
    throw new Error(`Invalid connection metadata field: ${typeof rec.status === 'string' ? rec.status : 'status'}`)
  }
  if (rec.status === 'imported') {
    if (typeof rec.connectionId !== 'string') throw new Error('Invalid device poll metadata')
    return { status: 'imported', connectionId: rec.connectionId }
  }
  if (rec.status === 'pending' || rec.status === 'slow_down') {
    return {
      status: rec.status,
      ...(typeof rec.interval === 'number' ? { interval: rec.interval } : {}),
    }
  }
  return { status: rec.status }
}

const TERMINAL_DEVICE_POLL = new Set(['denied', 'expired', 'imported'])

export function devicePollDelayMs(input: {
  readonly status?: string
  readonly interval?: number
}): number | null {
  if (input.status && TERMINAL_DEVICE_POLL.has(input.status)) return null
  const seconds = input.interval
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 5_000
  return Math.min(60_000, Math.max(1_000, Math.round(seconds * 1000)))
}

export function importedConnectionFromList<T extends { readonly id: string }>(
  rows: readonly T[],
  connectionId: string,
): T | undefined {
  return rows.find((row) => row.id === connectionId)
}

const GITHUB_DEVICE_PATH = new Set(['/login/device', '/login/device/'])
const GITHUB_USER_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/

export function githubDeviceVerificationHref(raw: string, userCode?: string): string | null {
  if (typeof raw !== 'string' || raw !== raw.trim() || raw.length === 0) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  if (url.hostname !== 'github.com') return null
  if (url.port !== '') return null
  if (url.hash !== '') return null
  if (!GITHUB_DEVICE_PATH.has(url.pathname)) return null
  const keys = [...url.searchParams.keys()]
  if (keys.length > 1) return null
  if (keys.length === 1) {
    if (keys[0] !== 'user_code') return null
    const code = url.searchParams.get('user_code') ?? ''
    if (!GITHUB_USER_CODE.test(code)) return null
    return `https://github.com${url.pathname}?user_code=${encodeURIComponent(code)}`
  }
  if (typeof userCode === 'string' && GITHUB_USER_CODE.test(userCode)) {
    return `https://github.com${url.pathname}?user_code=${encodeURIComponent(userCode)}`
  }
  return `https://github.com${url.pathname}`
}
