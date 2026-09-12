/**
 * Idempotent capability install/uninstall + provenance (Rox issue 24).
 * Wraps marketplace installer. High-risk tools are never auto-enabled.
 */
import type { MarketplaceEntry } from '../marketplace/catalog.ts'
import { marketplacePaths } from '../marketplace/catalog.ts'
import {
  installEntry,
  removeEntry,
  type InstallOptions,
  type MarketplaceInstallResult,
  type MarketplaceRemoveResult,
} from '../marketplace/installer.ts'
import { readLock, type MarketplaceLockFile, type MarketplaceLockRecord } from '../marketplace/lock.ts'
import { getCapabilityTool, CAPABILITY_PACKS, CAPABILITY_TOOLS, type CapabilityPackId } from './packs.ts'

export type CapabilityInstallStatus = 'installed' | 'already-installed' | 'deferred' | 'skipped-high-risk'

export type CapabilityInstallResult = {
  id: string
  status: CapabilityInstallStatus
  result?: MarketplaceInstallResult
  lock?: MarketplaceLockRecord
}

export async function installCapability(
  entry: MarketplaceEntry,
  options: InstallOptions & { allowHighRisk?: boolean } = {},
): Promise<CapabilityInstallResult> {
  const meta = getCapabilityTool(entry.id)
  if (meta?.highRisk && !options.allowHighRisk) {
    return { id: entry.id, status: 'skipped-high-risk' }
  }

  const lockPath = options.lockPath ?? marketplacePaths(options.configDir).lockFile
  const existing = readLock(lockPath).entries[entry.id]
  if (existing && existing.ref === entry.source.ref) {
    return { id: entry.id, status: 'already-installed', lock: existing }
  }

  const result = await installEntry(entry, options)
  const status: CapabilityInstallStatus = result.status === 'deferred' ? 'deferred' : 'installed'
  return { id: entry.id, status, result }
}

export function uninstallCapability(
  id: string,
  options: { configDir?: string; lockPath?: string } = {},
): MarketplaceRemoveResult {
  return removeEntry(id, options)
}

export type ProvenanceToolRecord = {
  id: string
  packId: CapabilityPackId | 'unlisted'
  version: string | null
  checksum: string | null
  license: string | null
  highRisk: boolean
  enabled: boolean
  ref: string
  status: MarketplaceLockRecord['status'] | 'available'
}

export type ProvenanceManifest = {
  generatedAt: number
  packs: Array<{
    id: CapabilityPackId
    tools: ProvenanceToolRecord[]
  }>
  unlisted: ProvenanceToolRecord[]
}

function recordFor(lock: MarketplaceLockRecord): ProvenanceToolRecord {
  const meta = getCapabilityTool(lock.id)
  return {
    id: lock.id,
    packId: meta?.packId ?? 'unlisted',
    version: meta?.version ?? null,
    checksum: meta?.checksum ?? lock.contentSha256?.[lock.targets[0] ?? ''] ?? null,
    license: meta?.license ?? null,
    highRisk: meta?.highRisk ?? false,
    enabled: lock.status === 'installed',
    ref: lock.ref,
    status: lock.status,
  }
}

export function buildProvenanceManifest(
  lock: MarketplaceLockFile = { version: 1, entries: {} },
  now = Date.now(),
): ProvenanceManifest {
  const installed = Object.values(lock.entries)
  const byId = new Map(installed.map((entry) => [entry.id, entry]))
  const packs = CAPABILITY_PACKS.map((pack) => ({
    id: pack.id,
    tools: pack.toolIds.map((id) => {
      const live = byId.get(id)
      const meta = getCapabilityTool(id)!
      if (!live) {
        return {
          id,
          packId: pack.id,
          version: meta.version,
          checksum: meta.checksum,
          license: meta.license,
          highRisk: meta.highRisk,
          enabled: false,
          ref: meta.gitRef,
          status: 'available' as const,
        }
      }
      return recordFor(live)
    }),
  }))
  const unlisted = installed.filter((entry) => !getCapabilityTool(entry.id)).map(recordFor)
  return { generatedAt: now, packs, unlisted }
}

export function selectCapabilityTools(
  task: { kind: 'url' | 'repository' | 'document' | 'reminder' | 'sbom' | 'research' },
  installedIds: readonly string[],
): typeof CAPABILITY_TOOLS[number][] {
  const packForTask: Record<typeof task.kind, CapabilityPackId> = {
    url: 'research',
    repository: 'code-intelligence',
    document: 'documents',
    reminder: 'reminders',
    sbom: 'security-sbom',
    research: 'research',
  }
  const packId = packForTask[task.kind]
  const installed = new Set(installedIds)
  return CAPABILITY_TOOLS
    .filter((item) => item.packId === packId && installed.has(item.id) && !item.highRisk)
    .sort((a, b) => a.sizeHintKb - b.sizeHintKb)
    .slice(0, 1)
}
