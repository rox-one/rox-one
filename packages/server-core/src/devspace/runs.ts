/**
 * Dev Space run journal: `projects/<slug>/dev-space/runs/<runId>.json` (02-SPEC-foundations §6.2).
 *
 * Each run is one immutable-in-shape JSON record rewritten atomically after every
 * stage transition, so a crash mid-pipeline never leaves a torn file. `listRuns`
 * reads the directory back with light validation and skips corrupt journals — the
 * renderer's history view must never fail on one bad file.
 */
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import type { DevSpaceRun, DevSpaceRunStage, DevSpaceRunStatus } from '@rox/shared/dev-space'

/** `devrun_<sha256([repositoryId, snapshotId, planHash])>`. */
export const DEV_SPACE_RUN_ID = /^devrun_[a-f0-9]{64}$/
/** Must mirror `SLUG` in the RPC handler; the slug selects `projects/<slug>`. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
/** Bounded history per project — O10 closed 2026-10-10 (§6.2); mirrors `MAX_RUNS` in playbooks/codebook/runs.ts. */
export const MAX_RUNS_PER_PROJECT = 128

const RUN_STAGES: Readonly<Record<DevSpaceRunStage, true>> = { reconcile: true, structural: true, llm: true, publish: true }
const RUN_STATUSES: Readonly<Record<DevSpaceRunStatus, true>> = {
  queued: true, running: true, succeeded: true, failed: true, cancelled: true, partial: true,
}

function isRun(value: unknown): value is DevSpaceRun {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const run = value as Record<string, unknown>
  return run.schemaVersion === 1
    && typeof run.id === 'string' && DEV_SPACE_RUN_ID.test(run.id)
    && typeof run.repositoryId === 'string' && typeof run.snapshotId === 'string'
    && Array.isArray(run.stages) && run.stages.every(stage => typeof stage === 'string' && stage in RUN_STAGES)
    && typeof run.status === 'string' && run.status in RUN_STATUSES
    && typeof run.startedAt === 'number'
    && !!run.progress && typeof run.progress === 'object'
}

/** `projects/<slug>/dev-space/runs`. */
export function devSpaceRunsDirectory(root: string, projectSlug: string): string {
  return join(root, 'projects', projectSlug, 'dev-space', 'runs')
}

export function devSpaceRunPath(root: string, projectSlug: string, runId: string): string {
  return join(devSpaceRunsDirectory(root, projectSlug), `${runId}.json`)
}

export async function readDevSpaceRun(root: string, projectSlug: string, runId: string): Promise<DevSpaceRun | null> {
  if (!SLUG.test(projectSlug) || !DEV_SPACE_RUN_ID.test(runId)) return null
  let raw: string
  try { raw = await readFile(devSpaceRunPath(root, projectSlug, runId), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRun(parsed) ? parsed : null
  } catch { return null }
}

/** Atomic rewrite of one run journal; the caller decides the next immutable state. */
export async function writeDevSpaceRun(root: string, projectSlug: string, run: DevSpaceRun): Promise<void> {
  if (!isRun(run) || !SLUG.test(projectSlug)) return
  const directory = devSpaceRunsDirectory(root, projectSlug)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  atomicWriteFileSync(devSpaceRunPath(root, projectSlug, run.id), JSON.stringify(run, null, 2))
}

/** Read every valid run journal for the given project slugs, newest first. */
export async function listDevSpaceRuns(
  root: string, projectSlugs: readonly string[], limit = MAX_RUNS_PER_PROJECT,
): Promise<DevSpaceRun[]> {
  const runs: DevSpaceRun[] = []
  for (const slug of projectSlugs) {
    if (!SLUG.test(slug)) continue
    let names: string[]
    try { names = await readdir(devSpaceRunsDirectory(root, slug)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    const journals = names.filter(name => name.endsWith('.json') && DEV_SPACE_RUN_ID.test(name.slice(0, -5)))
    if (journals.length > MAX_RUNS_PER_PROJECT) continue
    for (const name of journals) {
      try {
        const parsed: unknown = JSON.parse(await readFile(join(devSpaceRunsDirectory(root, slug), name), 'utf8'))
        if (isRun(parsed)) runs.push(parsed)
      } catch { /* skip a corrupt run journal; history must still render */ }
    }
  }
  runs.sort((a, b) => b.startedAt - a.startedAt)
  return runs.slice(0, Math.max(0, limit))
}