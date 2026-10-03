/** Provider registration extends the canonical off-by-default pack; it does not launch tools. */
import { createHash } from 'node:crypto'
import {
  CODE_INTEL_PACK,
  REJECTED_CODE_INTEL_TOOLS,
  SELECTED_CODE_INTEL,
} from './types.ts'
import type { CodeGraph, CodeIntelAdapter } from './types.ts'
import {
  RepositoryContractError,
  assertRepositorySnapshotScope,
  readSnapshotFile,
} from './refs.ts'
import type { RepositoryBinding, RepositoryScope, RepositorySnapshot } from './refs.ts'

export const CODE_INTELLIGENCE_SELECTION_REVISION = 'CI-DEC-EXTEND-EXISTING-01'
export type CodeIntelligenceOperation = 'symbols' | 'sbom' | 'search' | 'repo-wiki' | 'diagram' | 'source-graph' | 'c4'

export interface CodeIntelligenceProvider {
  readonly id: string
  readonly version: string
  readonly alwaysOn: false
  readonly operations: readonly CodeIntelligenceOperation[]
  readonly execution: 'local' | 'remote'
  readonly sourceRevision?: string
  readonly artifactDigest?: string
  readonly readiness: 'ready' | 'requires-runtime-probe'
  readonly adapter?: CodeIntelAdapter
}

export interface ProviderRequestContext {
  readonly binding: RepositoryBinding
  readonly snapshot: RepositorySnapshot
  readonly scope: RepositoryScope
  /** Explicit activation for this request; provider discovery never activates it. */
  readonly enabled: boolean
  readonly allowedProviderIds: readonly string[]
}

export const CODE_INTELLIGENCE_PROVIDER_DECISION = Object.freeze({
  revision: CODE_INTELLIGENCE_SELECTION_REVISION,
  packId: CODE_INTEL_PACK.id,
  alwaysOn: false as const,
  selected: SELECTED_CODE_INTEL,
  rejected: REJECTED_CODE_INTEL_TOOLS,
  inventoryDeclarationIsRuntimeEvidence: false,
  inventoryDeclarationIsUpstreamVerification: false,
})

const OPERATIONS = new Set<CodeIntelligenceOperation>(['symbols', 'sbom', 'search', 'repo-wiki', 'diagram', 'source-graph', 'c4'])
function reject(code: string): never { throw new RepositoryContractError(code) }
function providerId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) reject('invalid-provider-id')
  return id
}
function isRejected(id: string): boolean {
  return REJECTED_CODE_INTEL_TOOLS.some(tool => tool.name.toLowerCase() === id.replace(/-/g, ''))
}

export class CodeIntelligenceProviderRegistry {
  private readonly providers = new Map<string, CodeIntelligenceProvider>()

  constructor(initial: readonly CodeIntelligenceProvider[] = []) {
    for (const provider of initial) this.register(provider)
  }

  register(input: CodeIntelligenceProvider): void {
    const id = providerId(input.id)
    if (isRejected(id)) reject('rejected-provider')
    if (this.providers.has(id)) reject('duplicate-provider')
    if (input.alwaysOn !== false || typeof input.version !== 'string' || !input.version || input.version.length > 128
      || !Array.isArray(input.operations) || !input.operations.length || input.operations.length > OPERATIONS.size
      || input.operations.some(operation => !OPERATIONS.has(operation))
      || new Set(input.operations).size !== input.operations.length
      || !['local', 'remote'].includes(input.execution)
      || !['ready', 'requires-runtime-probe'].includes(input.readiness)) reject('invalid-provider')
    if (input.sourceRevision !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.sourceRevision)) reject('invalid-provider-revision')
    if (input.artifactDigest !== undefined && !/^[a-f0-9]{64}$/.test(input.artifactDigest)) reject('invalid-provider-digest')
    if (!SELECTED_CODE_INTEL.includes(id as typeof SELECTED_CODE_INTEL[number])
      && (!input.sourceRevision || !input.artifactDigest)) reject('unverified-provider-manifest')
    if (input.adapter && (input.adapter.id !== id || input.adapter.alwaysOn !== false)) reject('invalid-provider-adapter')
    this.providers.set(id, Object.freeze({ ...input, operations: Object.freeze([...input.operations]) }))
  }

  list(): readonly CodeIntelligenceProvider[] { return Object.freeze([...this.providers.values()]) }

  resolve(id: string, operation: CodeIntelligenceOperation, context: ProviderRequestContext): CodeIntelligenceProvider {
    providerId(id)
    const provider = this.providers.get(id)
    if (!provider) reject('unknown-provider')
    assertRepositorySnapshotScope(context.snapshot, context.binding, context.scope)
    if (!context.enabled || !context.allowedProviderIds.includes(id)) reject('provider-disabled')
    if (!provider.operations.includes(operation)) reject('unsupported-provider-operation')
    if (provider.readiness !== 'ready') reject('provider-runtime-unready')
    if (provider.execution === 'remote' && context.binding.policy.dataEgress !== 'allow') reject('provider-egress-denied')
    return provider
  }
}

/** Uses the existing adapter only for files proven to exist at a Git commit. */
export function indexVerifiedSnapshotFiles(adapter: CodeIntelAdapter, snapshot: RepositorySnapshot,
  binding: RepositoryBinding, scope: RepositoryScope): CodeGraph {
  assertRepositorySnapshotScope(snapshot, binding, scope)
  const files = snapshot.files.filter(file => file.commitSha).map(file => {
    const checked = readSnapshotFile(snapshot, binding, file.path, scope)
    return { path: checked.path, content: checked.content, commit: checked.commitSha! }
  })
  return adapter.index(files)
}

/** Provider-local identifiers are namespaced by repository, exact snapshot and provider version. */
export function scopedProviderResourceId(input: {
  binding: RepositoryBinding; snapshot: RepositorySnapshot; scope: RepositoryScope;
  provider: CodeIntelligenceProvider; providerResourceId: string
}): string {
  assertRepositorySnapshotScope(input.snapshot, input.binding, input.scope)
  providerId(input.provider.id)
  if (typeof input.providerResourceId !== 'string' || !input.providerResourceId || input.providerResourceId.length > 512
    || /[\x00-\x1f]/.test(input.providerResourceId)) reject('invalid-provider-resource-id')
  const hash = createHash('sha256').update(JSON.stringify([input.binding.workspaceId, input.binding.projectId,
    input.binding.repositoryId, input.snapshot.id, input.provider.id, input.provider.version, input.providerResourceId])).digest('hex')
  return `provider-resource_${hash}`
}
