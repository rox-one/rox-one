/**
 * Dev Space `structural` stage (02-SPEC-foundations §6.1, ADR-0021).
 *
 * Runs the deterministic, daemon-free structural adapters in sequence over the
 * repository working copy and records their artifacts in the shared manifest.
 * A tool that is not installed is skipped with an `unavailable` outcome — the
 * stage never installs, never fabricates artifacts and never fails the run on a
 * missing tool; it settles `partial` instead (§6.4, D4).
 *
 * Audit entries (`structural-tool` run/skip/error) are appended best-effort to
 * `projects/<slug>/dev-space/audit.jsonl` (§8.4), mirroring the RPC handler's
 * audit shape. Nothing here writes outside `projects/<slug>/dev-space/`.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { join, relative, isAbsolute, sep } from 'node:path'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import { registerDevSpaceStage, type DevSpaceStageContext, type DevSpaceStageOutcome } from '../runner.ts'
import { createToolAdapter, type StructuralAdapter, type StructuralAdapterContext } from '../adapters/contract.ts'
import { codegraphAdapterSpec } from '../adapters/codegraph.ts'
import { gromaAdapterSpec } from '../adapters/groma.ts'
import { graphifyAdapterSpec } from '../adapters/graphify.ts'
import { archifyAdapterSpec } from '../adapters/archify.ts'

/** Mirrors the RPC handler's slug guard (dev-space.ts) — the slug selects `projects/<slug>`. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Default structural adapter set; O7 pins live in each adapter module. */
export function defaultStructuralAdapters(): readonly StructuralAdapter[] {
  return [codegraphAdapterSpec, gromaAdapterSpec, graphifyAdapterSpec, archifyAdapterSpec].map(spec => createToolAdapter(spec))
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'repo'
}

function repositoryDirectoryName(url: string): string {
  const name = url.replace(/\.git$/i, '').split('/').filter(Boolean).pop() ?? 'repository'
  return sanitizeName(name)
}

/**
 * Repository working copy under `projects/<slug>/` (ADR-0022). Mirrors the RPC
 * handler's `gitUrlDestination`/local-folder rule; no other roots are introduced.
 */
function resolveWorkingCopy(root: string, record: DevSpaceRepositoryRecord): string {
  if (record.origin.kind === 'local-folder') return record.origin.path
  return join(root, 'projects', record.projectSlug, repositoryDirectoryName(record.origin.url))
}

function inside(base: string, target: string): boolean {
  const rel = relative(base, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** Best-effort append-only audit; a failure here never fails an analysis run. */
async function appendStructuralAudit(root: string, slug: string, event: Record<string, unknown>): Promise<void> {
  if (!SLUG.test(slug)) return
  const directory = join(root, 'projects', slug, 'dev-space')
  if (!inside(root, directory)) return
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await appendFile(join(directory, 'audit.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, 'utf8')
  } catch { /* audit is best-effort */ }
}

/**
 * Run the structural adapters in sequence, reporting monotonic progress. Returns
 * the manifest entry ids produced and `partial: true` whenever any adapter was
 * unavailable or failed (§6.4).
 */
export async function runStructuralStage(
  adapters: readonly StructuralAdapter[], context: DevSpaceStageContext,
): Promise<DevSpaceStageOutcome> {
  const cwd = resolveWorkingCopy(context.root, context.record)
  const total = adapters.length
  const artifacts: string[] = []
  let partial = false
  let done = 0
  context.report(0, total)

  for (const adapter of adapters) {
    if (context.signal.aborted) { partial = true; break }
    const detection = await adapter.detect()
    if (!detection.available) {
      partial = true
      await appendStructuralAudit(context.root, context.projectSlug, {
        event: 'structural-tool', runId: context.runId, tool: adapter.id, version: adapter.version,
        status: 'skip', reason: 'unavailable', ...(detection.detail !== undefined ? { detail: detection.detail } : {}),
      })
      done += 1
      context.report(done, total)
      continue
    }

    const adapterContext: StructuralAdapterContext = {
      root: context.root,
      cwd,
      projectSlug: context.projectSlug,
      repositoryId: context.repositoryId,
      snapshotId: context.snapshotId,
      runId: context.runId,
      signal: context.signal,
      report: context.report,
    }
    const result = await adapter.run(adapterContext)
    if (result.status !== 'ok') partial = true
    artifacts.push(...result.artifactIds)
    await appendStructuralAudit(context.root, context.projectSlug, {
      event: 'structural-tool', runId: context.runId, tool: adapter.id, version: adapter.version,
      status: result.status === 'unavailable' ? 'skip' : result.status === 'ok' ? 'run' : 'error',
      artifactCount: result.artifactIds.length,
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
    })
    done += 1
    context.report(done, total)
  }

  return { artifacts, partial }
}

/** Register the `structural` stage; later slices may pass an explicit adapter set. */
export function registerDevSpaceStructuralStage(adapters: readonly StructuralAdapter[] = defaultStructuralAdapters()): void {
  registerDevSpaceStage('structural', context => runStructuralStage(adapters, context))
}