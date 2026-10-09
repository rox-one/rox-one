/**
 * Question-context assembly (03-SPEC-features §3.2): resolve the repository
 * working copy, read the code-intelligence snapshot (status/dirty/size) and the
 * read-only working signals (CI presence), and fold in the onboarding profile and
 * the security-scan outcome. Everything is best-effort: an unreadable snapshot or
 * a missing `.github/workflows` degrades the corresponding input to `null` rather
 * than failing generation. No network is ever touched here.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { loadEnvironmentPrefs, type EnvironmentPrefs } from '@rox/shared/environment'
import type { ProjectConfig } from '@rox/shared/projects'
import { loadRepositorySnapshot, repositoryPolicyFingerprint } from '@rox/shared/code-intelligence'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import type {
  DevSpaceQuestionContext, DevSpaceQuestionProfile, DevSpaceQuestionRepo, DevSpaceQuestionSecurity, DevSpaceQuestionSignals,
} from './blocks.ts'

/** Sanitise a repo name exactly like the structural/llm stages resolve the working copy. */
function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'repo'
}

/** Repository working copy under `projects/<slug>/` (ADR-0022); mirrors the structural stage. */
export function resolveWorkingCopy(root: string, record: DevSpaceRepositoryRecord): string {
  if (record.origin.kind === 'local-folder') return record.origin.path
  const raw = record.origin.url.replace(/\.git$/i, '').split('/').filter(Boolean).pop() ?? 'repository'
  return join(root, 'projects', record.projectSlug, sanitizeName(raw))
}

/** Onboarding profile projected from `EnvironmentPrefs.role` (D1, §2.2). */
export function profileFromEnvironment(prefs: EnvironmentPrefs): DevSpaceQuestionProfile {
  const role = prefs.role
  if (role.status !== 'answered' || role.value === null) {
    return { answered: false, isDeveloper: null, relatedRoles: [] }
  }
  return { answered: true, isDeveloper: role.value.isDeveloper, relatedRoles: role.value.relatedRoles }
}

/** Default environment reader; injectable so tests never touch the real config dir. */
export type EnvironmentPrefsReader = () => EnvironmentPrefs

/**
 * Repository context. The snapshot is loaded through the code-intelligence store
 * (same layout the handler writes: `code-intelligence/<bindingId>/<policyHash>`);
 * an unloadable snapshot degrades `dirty`/size to `null` — never an error, never a
 * fabricated value.
 */
export async function collectRepoSignals(
  root: string, record: DevSpaceRepositoryRecord, project: ProjectConfig,
): Promise<DevSpaceQuestionRepo> {
  const base: DevSpaceQuestionRepo = {
    status: record.status,
    snapshotId: record.lastSnapshotId ?? null,
    dirty: null,
    fileCount: null,
    totalBytes: null,
  }
  const snapshotId = record.lastSnapshotId
  const bindingId = record.bindingId
  if (!snapshotId || !bindingId) return base
  try {
    const binding = (project.repositoryBindings ?? []).find(candidate => candidate.id === bindingId)
    if (!binding) return base
    const store = join(root, 'projects', record.projectSlug, 'code-intelligence', binding.id, repositoryPolicyFingerprint(binding.policy))
    const snapshot = await loadRepositorySnapshot(store, snapshotId, binding, { workspaceId: record.workspaceId, projectId: project.id })
    const totalBytes = snapshot.files.reduce((sum, file) => sum + file.bytes, 0)
    return { ...base, dirty: snapshot.dirty, fileCount: snapshot.coverage.includedCount, totalBytes }
  } catch {
    return base
  }
}

/**
 * Read-only working signals: CI presence is best-effort from `.github/workflows`.
 * An unreadable directory yields `null` (unknown), never a fabricated claim.
 */
export async function collectWorkSignals(cwd: string): Promise<DevSpaceQuestionSignals> {
  try {
    const entries = await readdir(join(cwd, '.github', 'workflows'), { withFileTypes: true })
    const workflows = entries.filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name)).length
    return { ci: workflows > 0, ciWorkflows: workflows }
  } catch {
    return { ci: null, ciWorkflows: null }
  }
}

export interface BuildQuestionContextInput {
  readonly root: string
  readonly record: DevSpaceRepositoryRecord
  readonly project: ProjectConfig
  readonly security: DevSpaceQuestionSecurity
  /** Defaults to the real environment storage; injected in tests. */
  readonly readEnvironmentPrefs?: EnvironmentPrefsReader
}

/** Assemble the full generator context from the handler's repositories + secrets-free inputs. */
export async function buildQuestionContext(input: BuildQuestionContextInput): Promise<DevSpaceQuestionContext> {
  const reader = input.readEnvironmentPrefs ?? loadEnvironmentPrefs
  const profile = profileFromEnvironment(reader())
  const repo = await collectRepoSignals(input.root, input.record, input.project)
  const signals = await collectWorkSignals(resolveWorkingCopy(input.root, input.record))
  return { profile, repo, signals, security: input.security }
}