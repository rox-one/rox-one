/**
 * Codebook run journal (03-SPEC-features §9; 05-PLAN В5).
 *
 * A codebook run is a per-notebook pipeline, not a dev-space analysis snapshot,
 * so its durable record lives NEXT TO the dev-space stage journal rather than in
 * it: `projects/<slug>/dev-space/codebook/runs/<runId>.json`. The dev-space
 * `runs/` directory keeps `DevSpaceRun` records bound to a snapshot triple; a
 * codebook run has no snapshot and would falsify that contract, so reusing the
 * directory is refused and a sibling is used instead.
 *
 * Step results carry artifact REFERENCES (`artifactId`, `artifactPath`) — never
 * artifact content — so the journal duplicates nothing from `manifest.json`
 * (§7, "no content duplication"). Reads are contained under the codebook
 * directory and follow no symlinks; nothing here spawns a process.
 */
import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { CodebookRunError } from '@rox/shared/playbooks'
import type { CodebookRun } from '@rox/shared/playbooks'
import type { CodebookArtifactRef } from './engine.ts'
import { atomicWriteFileSync } from '@rox/shared/utils/files'

/** Mirrors the RPC envelope's slug guard — the slug selects `projects/<slug>`. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const RUN_ID = /^codebookrun_[a-f0-9]{16}$/
const MAX_RUNS = 200
/** A single journal must stay a record, not a content dump; oversized runs are truncated on write. */
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024

export const CODEBOOK_DIRECTORY = 'codebook'
export const CODEBOOK_RUNS_DIRECTORY = 'runs'

export function codebookDirectory(root: string, projectSlug: string): string {
  return join(root, 'projects', projectSlug, 'dev-space', CODEBOOK_DIRECTORY)
}

export function codebookRunsDirectory(root: string, projectSlug: string): string {
  return join(codebookDirectory(root, projectSlug), CODEBOOK_RUNS_DIRECTORY)
}

const MANIFEST_FILENAME = 'manifest.json'

/**
 * Resolve an `artifact` cell reference against the project's dev-space manifest
 * (`projects/<slug>/dev-space/manifest.json`, written by the В2 stage writers and
 * the podcast store). Only the reference is returned — the caller never reads or
 * copies the artifact's content, so an artifact cell duplicates nothing.
 */
export async function readDevSpaceManifestEntry(root: string, projectSlug: string, artifactId: string): Promise<CodebookArtifactRef | null> {
  if (!SLUG.test(projectSlug)) return null
  const manifestPath = join(root, 'projects', projectSlug, 'dev-space', MANIFEST_FILENAME)
  let raw: string
  try { raw = await readFile(manifestPath, 'utf8') } catch { return null }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const entries = 'entries' in parsed ? parsed.entries : undefined
  if (!Array.isArray(entries)) return null
  for (const candidate of entries) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    if (!('id' in candidate) || !('path' in candidate)) continue
    if (candidate.id !== artifactId || typeof candidate.path !== 'string') continue
    return {
      artifactId,
      path: candidate.path,
      ...('format' in candidate && typeof candidate.format === 'string' ? { format: candidate.format } : {}),
    }
  }
  return null
}

export function newCodebookRunId(): string {
  return `codebookrun_${createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16)}`
}

function assertSlug(projectSlug: string): void {
  if (!SLUG.test(projectSlug)) throw new CodebookRunError('invalid-input', 'codebook-project-slug')
}

function assertRunId(runId: string): void {
  if (!RUN_ID.test(runId)) throw new CodebookRunError('invalid-input', 'codebook-run-id')
}

function within(base: string, target: string): boolean {
  const rel = relative(base, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** Refuse to read or write through a symlinked path component. */
async function assertNoSymlinks(root: string, target: string): Promise<void> {
  const rel = relative(root, target)
  if (!within(root, target)) throw new CodebookRunError('invalid-input', 'codebook-path-denied')
  let path = root
  for (const part of rel.split(sep).filter(Boolean)) {
    path = join(path, part)
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new CodebookRunError('invalid-input', 'codebook-path-denied')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

/**
 * Append (or replace) a finished run in the journal. Callers only reach this on
 * a terminal status, so a cancelled or still-running job never publishes a
 * partial record.
 */
export async function writeCodebookRun(input: {
  readonly root: string
  readonly projectSlug: string
  readonly run: CodebookRun
}): Promise<CodebookRun> {
  assertSlug(input.projectSlug)
  assertRunId(input.run.id)
  const directory = codebookRunsDirectory(input.root, input.projectSlug)
  const target = join(directory, `${input.run.id}.json`)
  if (!within(directory, target)) throw new CodebookRunError('invalid-input', 'codebook-path-denied')
  await assertNoSymlinks(input.root, target)
  const serialized = JSON.stringify(input.run, null, 2)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_JOURNAL_BYTES) throw new CodebookRunError('limit-exceeded', 'codebook-run-too-large')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  atomicWriteFileSync(target, serialized)
  return input.run
}

/** Read every valid run of a project, newest first; corrupt entries are skipped. */
export async function readCodebookRuns(root: string, projectSlug: string): Promise<readonly CodebookRun[]> {
  assertSlug(projectSlug)
  const directory = codebookRunsDirectory(root, projectSlug)
  let names: string[]
  try { names = await readdir(directory) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new CodebookRunError('storage-failed', 'codebook-runs-read')
  }
  const runs: CodebookRun[] = []
  for (const name of names.filter(entry => entry.endsWith('.json')).sort().reverse()) {
    if (runs.length >= MAX_RUNS) break
    try {
      const parsed = JSON.parse(await readFile(join(directory, name), 'utf8')) as CodebookRun
      if (parsed.schemaVersion === 1 && typeof parsed.id === 'string' && Array.isArray(parsed.steps)) runs.push(parsed)
    } catch { /* skip a corrupt journal entry */ }
  }
  return runs
}