/**
 * createDevSpaceToolRuntime — server-core implementation of the
 * `DevSpaceToolRuntime` seam from @rox/session-tools-core (spec 02 §9). Registered
 * once by `registerDevSpaceHandlers`, it lets `devspace.read` / `devspace.search`
 * reach the same artifact store the Dev Space RPC surface writes: `manifest.json`
 * plus the `projects/<slug>/dev-space/<kind-dir>/` files (§7).
 *
 * Read-only: `read` resolves one artifact id to bounded bytes plus provenance;
 * `search` scans manifests (and text artifacts) for a query. `propose` is
 * DELIBERATELY omitted — there is no approve/apply path in this slice, so the
 * seam reports CAPABILITY_DISABLED rather than pretending a proposal was created.
 *
 * Limits mirror the tool handlers: search ≤ 50 hits (20 default), 300-char
 * snippets, artifact bytes bounded by the store's write cap.
 */
import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DevSpaceError } from '@rox/session-tools-core'
import type {
  DevSpaceArtifactEntry, DevSpaceArtifactKind, DevSpaceReadRequest, DevSpaceReadResult,
  DevSpaceSearchHit, DevSpaceSearchPage, DevSpaceSearchRequest, DevSpaceToolRuntime,
} from '@rox/session-tools-core'
import type { DevSpaceManifest, DevSpaceManifestEntry } from '@rox/shared/dev-space'
import { readDevSpaceArtifactBytes, readDevSpaceManifest } from './artifacts.ts'

const MAX_SEARCH_LIMIT = 50
const DEFAULT_SEARCH_LIMIT = 20
const MAX_SNIPPET_CHARS = 300
const MAX_SCANNED_ARTIFACTS = 5000
const TEXT_FORMATS: Readonly<Record<string, true>> = { md: true, json: true, svg: true }

function entryOf(manifest: DevSpaceManifest, projectSlug: string, entry: DevSpaceManifestEntry): DevSpaceArtifactEntry {
  return {
    id: entry.id,
    kind: entry.kind as DevSpaceArtifactKind,
    path: entry.path,
    format: entry.format,
    producedBy: { providerId: entry.producedBy.providerId, version: entry.producedBy.version },
    ...(entry.sourceRevision !== undefined ? { sourceRevision: entry.sourceRevision } : {}),
    createdAt: entry.createdAt,
    projectSlug,
    repositoryId: manifest.repositoryId,
    snapshotId: manifest.snapshotId,
  }
}

/** Project slugs that own a `dev-space/` directory; missing `projects/` is empty, not an error. */
async function devSpaceProjectSlugs(workspaceRoot: string): Promise<string[]> {
  let names: string[]
  try { names = await readdir(join(workspaceRoot, 'projects')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  return names.sort()
}

function asDevSpaceError(error: unknown): never {
  if (error instanceof DevSpaceError) throw error
  throw new DevSpaceError('PROVIDER_ERROR', error instanceof Error ? error.message : String(error))
}

function requireWorkspaceRoot(workspaceRoot: string): string {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new DevSpaceError('INVALID_ARGUMENT', 'dev-space runtime requires a workspace root')
  }
  return workspaceRoot
}

export function createDevSpaceToolRuntime(): DevSpaceToolRuntime {
  async function read(args: DevSpaceReadRequest): Promise<DevSpaceReadResult> {
    const workspaceRoot = requireWorkspaceRoot(args.workspaceRoot)
    const slugs = args.projectSlug ? [args.projectSlug] : await devSpaceProjectSlugs(workspaceRoot)
    try {
      for (const slug of slugs) {
        const manifest = await readDevSpaceManifest(workspaceRoot, slug)
        if (!manifest || (args.repositoryId && manifest.repositoryId !== args.repositoryId)) continue
        const entry = manifest.entries.find(candidate => candidate.id === args.artifactId)
        if (!entry) continue
        const bytes = await readDevSpaceArtifactBytes(workspaceRoot, slug, entry.path)
        const text = entry.format in TEXT_FORMATS
        return {
          artifact: entryOf(manifest, slug, entry),
          content: text ? bytes.toString('utf8') : bytes.toString('base64'),
          encoding: text ? 'utf8' : 'base64',
          contentHash: createHash('sha256').update(bytes).digest('hex'),
        }
      }
    } catch (error) { asDevSpaceError(error) }
    throw new DevSpaceError('NOT_FOUND', `no artifact "${args.artifactId}" in the Dev Space store`)
  }

  async function search(args: DevSpaceSearchRequest): Promise<DevSpaceSearchPage> {
    const workspaceRoot = requireWorkspaceRoot(args.workspaceRoot)
    const { input } = args
    const query = input.query.trim()
    if (query.length === 0) throw new DevSpaceError('INVALID_ARGUMENT', 'dev-space search requires a non-empty query')
    const limit = Math.min(Math.max(Math.trunc(input.limit) || DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT)
    const offset = Math.max(Number.parseInt(input.cursor ?? '0', 10) || 0, 0)
    const needle = query.toLowerCase()
    const slugs = input.projectSlug ? [input.projectSlug] : await devSpaceProjectSlugs(workspaceRoot)
    const matches: DevSpaceSearchHit[] = []
    let scanned = 0
    try {
      for (const slug of slugs) {
        if (scanned >= MAX_SCANNED_ARTIFACTS) break
        const manifest = await readDevSpaceManifest(workspaceRoot, slug)
        if (!manifest || (input.repositoryId && manifest.repositoryId !== input.repositoryId)) continue
        for (const entry of manifest.entries) {
          if (input.kind && entry.kind !== input.kind) continue
          scanned += 1
          if (scanned > MAX_SCANNED_ARTIFACTS) break
          const hit = await matchEntry(workspaceRoot, manifest, slug, entry, needle)
          if (hit) matches.push(hit)
        }
      }
    } catch (error) { asDevSpaceError(error) }
    const items = matches.slice(offset, offset + limit)
    const nextCursor = offset + limit < matches.length ? String(offset + limit) : undefined
    return { items, totalEstimate: matches.length, ...(nextCursor ? { nextCursor } : {}) }
  }

  return { read, search }
}

/** Match one manifest entry against `needle`; text formats search the body, others only the path. */
async function matchEntry(
  workspaceRoot: string, manifest: DevSpaceManifest, projectSlug: string,
  entry: DevSpaceManifestEntry, needle: string,
): Promise<DevSpaceSearchHit | null> {
  const artifact = entryOf(manifest, projectSlug, entry)
  if (!(entry.format in TEXT_FORMATS)) {
    return entry.path.toLowerCase().includes(needle) ? { artifact } : null
  }
  const content = (await readDevSpaceArtifactBytes(workspaceRoot, projectSlug, entry.path)).toString('utf8')
  const index = content.toLowerCase().indexOf(needle)
  if (index < 0) return null
  const snippet = content.slice(Math.max(0, index - 100), index + MAX_SNIPPET_CHARS)
  return { artifact, snippet }
}