/** Bounded local-owned connection configuration and preview receipts. No network credentials or provider execution. */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { RepositoryContractError, repositoryPolicyFingerprint } from './refs.ts'
import type { RepositoryBinding, RepositoryInspection, RepositoryProjectInput, RepositorySnapshotSummary } from './refs.ts'

export interface RepositoryConnectionConfiguration {
  readonly approvedBranch: string
  readonly includes: readonly string[]
  readonly excludes: readonly string[]
  readonly maxFileBytes: number
  readonly maxBytes: number
  readonly maxFiles: number
  readonly readOnly: true
  /** Local-owned repositories use OS access and have no remote credential connection. */
  readonly connectionRef: null
}
export interface RepositoryConnection extends RepositoryConnectionConfiguration {
  readonly version: 1
  readonly approvedRoot: string
  readonly policyFingerprint: string
  readonly sourceProvenance: { readonly kind: 'local-owned'; readonly bindingId: string; readonly repositoryId: string; readonly previewFingerprint: string }
}
export interface RepositoryPreviewInput extends RepositoryProjectInput { configuration?: Omit<RepositoryConnectionConfiguration, 'approvedBranch'> & { approvedBranch?: string } }
export interface RepositoryBindInput extends RepositoryProjectInput {
  configuration: RepositoryConnectionConfiguration
  previewFingerprint: string
  expectedPolicyFingerprint: string | null
}
export interface RepositoryPreview {
  readonly binding: RepositoryBinding
  readonly configuration: RepositoryConnectionConfiguration
  readonly inventory: RepositorySnapshotSummary
  readonly previewFingerprint: string
  readonly expectedPolicyFingerprint: string | null
  readonly sourceProvenance: { readonly kind: 'local-owned'; readonly readOnly: true; readonly connectionRef: null }
}
export interface RepositoryConnectionInspection extends RepositoryInspection {
  readonly connection: RepositoryConnection | null
  readonly historicalSnapshots: readonly RepositorySnapshotSummary[]
}
export const MANDATORY_REPOSITORY_EXCLUDES = ['.env', '.env.*', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/.codegraph/**'] as const
export function defaultRepositoryConfiguration(branch: string): RepositoryConnectionConfiguration {
  return { approvedBranch: branch, includes: ['**'], excludes: [...MANDATORY_REPOSITORY_EXCLUDES],
    maxFileBytes: 256 * 1024, maxBytes: 16 * 1024 * 1024, maxFiles: 10_000, readOnly: true, connectionRef: null }
}
export function parseRepositoryConfiguration(value: unknown): RepositoryConnectionConfiguration {
  const fail = (): never => { throw new RepositoryContractError('invalid-connection-configuration') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !['approvedBranch', 'includes', 'excludes', 'maxFileBytes', 'maxBytes', 'maxFiles', 'readOnly', 'connectionRef'].includes(key))
    || typeof record.approvedBranch !== 'string' || !record.approvedBranch || record.approvedBranch.length > 255
    || /[\x00-\x20~^:?*\[\\]/.test(record.approvedBranch) || record.approvedBranch.startsWith('-')
    || record.readOnly !== true || record.connectionRef !== null) return fail()
  function patterns(raw: unknown, allowEmpty: boolean): string[] {
    if (!Array.isArray(raw) || raw.length > 128 || (!allowEmpty && !raw.length)) return fail()
    return [...new Set(raw.map(value => {
      if (typeof value !== 'string' || !value || value.length > 512 || /[\\\x00-\x1f]/.test(value) || value.startsWith('/')
        || value.split('/').some(part => !part || part === '.' || part === '..')) return fail()
      return value
    }))].sort()
  }
  function limit(raw: unknown, max: number): number {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > max) return fail()
    return raw
  }
  return { approvedBranch: record.approvedBranch, includes: patterns(record.includes, false),
    excludes: [...new Set([...patterns(record.excludes, true), ...MANDATORY_REPOSITORY_EXCLUDES])].sort(),
    maxFileBytes: limit(record.maxFileBytes, 256 * 1024), maxBytes: limit(record.maxBytes, 16 * 1024 * 1024),
    maxFiles: limit(record.maxFiles, 10_000), readOnly: true, connectionRef: null }
}
export function repositoryConnectionFingerprint(connection: RepositoryConnection | undefined): string | null {
  return connection?.policyFingerprint ?? null
}
export function repositoryPreviewFingerprint(binding: RepositoryBinding, inventory: RepositorySnapshotSummary,
  expectedPolicyFingerprint: string | null): string {
  return createHash('sha256').update(JSON.stringify([binding.canonicalRoot, binding.id, repositoryPolicyFingerprint(binding.policy), inventory.id, expectedPolicyFingerprint])).digest('hex')
}
export async function repositoryCurrentBranch(root: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new RepositoryContractError('request-cancelled')
  try {
    const result = await promisify(execFile)('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', root,
      'symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 4096, signal,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' } })
    const branch = result.stdout.trim()
    if (!branch) throw new RepositoryContractError('repository-branch-unavailable')
    return branch
  } catch {
    throw new RepositoryContractError(signal?.aborted ? 'request-cancelled' : 'repository-branch-unavailable')
  }
}
