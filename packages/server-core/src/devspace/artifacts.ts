/**
 * Dev Space artifact store (02-SPEC-foundations §7): artifacts live under
 * `projects/<slug>/dev-space/<kind-dir>/` and every write is registered in
 * `manifest.json` with provenance (providerId/version/sourceRevision). The
 * manifest is the single source of truth the renderer and session-tools read;
 * each mutation is an atomic rewrite. `consent.json` (§8.1) lives beside it.
 *
 * Nothing here ever touches the network or spawns a process — stages that need
 * egress gate it through the per-repo consent read from this module.
 */
import { mkdir, lstat, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import { devSpaceManifestEntryId } from '@rox/shared/dev-space'
import type {
  DevSpaceArtifactFormat, DevSpaceConsent, DevSpaceManifest, DevSpaceManifestEntry, DevSpaceManifestEntryKind,
} from '@rox/shared/dev-space'

/** Request limits mirror the RPC envelope guards. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_MANIFEST_ENTRIES = 4096
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024

/** Artifact kind → on-disk directory under `dev-space/` (§7.1). */
const KIND_DIRECTORY: Readonly<Record<DevSpaceManifestEntryKind, string>> = {
  'wiki': 'wiki',
  'understanding': 'understanding',
  'code-graph': 'code-graph',
  'diagram': 'diagrams',
  'knowledge-graph': 'knowledge-graph',
  'c4': 'c4',
  'questions': 'questions',
  'tour': 'tours',
  'sbom-cve': 'security',
  'audio': 'audio',
}

export const DEV_SPACE_MANIFEST_FILENAME = 'manifest.json'
export const DEV_SPACE_CONSENT_FILENAME = 'consent.json'

function devSpaceRoot(root: string, projectSlug: string): string {
  return join(root, 'projects', projectSlug, 'dev-space')
}

/** Directory that holds one artifact kind; exported for session-tools readers. */
export function devSpaceArtifactDirectory(root: string, projectSlug: string, kind: DevSpaceManifestEntryKind): string {
  return join(devSpaceRoot(root, projectSlug), KIND_DIRECTORY[kind])
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** Resolve a manifest `path` to an absolute, still-contained file under `dev-space/`. */
function resolveArtifactPath(root: string, projectSlug: string, path: string): string {
  const base = devSpaceRoot(root, projectSlug)
  const target = resolve(base, path)
  if (!within(base, target)) throw new Error('devSpace.artifact-path-denied')
  return target
}

/**
 * Write an artifact file and register it in the manifest. `name` is a bare file
 * name relative to the kind directory; `path` in the manifest is `<kind-dir>/<name>`.
 * Same `(repositoryId, snapshotId, kind, path)` yields the same entry id, so a
 * rerun of one stage replaces rather than duplicates its manifest row.
 */
export async function writeDevSpaceArtifact(input: {
  readonly root: string
  readonly projectSlug: string
  readonly repositoryId: string
  readonly snapshotId: string
  readonly runId: string
  readonly kind: DevSpaceManifestEntryKind
  readonly name: string
  readonly format: DevSpaceArtifactFormat
  readonly content: string
  readonly producedBy: { readonly providerId: string; readonly version: string }
  readonly sourceRevision?: string
  readonly now?: number
}): Promise<DevSpaceManifestEntry> {
  if (!SLUG.test(input.projectSlug)) throw new Error('devSpace.invalid-project-slug')
  if (input.name.length === 0 || input.name.includes('/') || input.name.includes('\\') || input.name.includes('\0')) {
    throw new Error('devSpace.invalid-artifact-name')
  }
  const bytes = Buffer.byteLength(input.content)
  if (bytes > MAX_ARTIFACT_BYTES) throw new Error('devSpace.artifact-byte-limit')
  const directory = devSpaceArtifactDirectory(input.root, input.projectSlug, input.kind)
  const relativePath = `${KIND_DIRECTORY[input.kind]}/${input.name}`
  const target = resolveArtifactPath(input.root, input.projectSlug, relativePath)
  if (await hasSymlinkLink(input.root, dirname(target))) throw new Error('devSpace.artifact-path-denied')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(target, input.content, { encoding: 'utf8', mode: 0o600 })

  const entry: DevSpaceManifestEntry = {
    id: devSpaceManifestEntryId(input.repositoryId, input.snapshotId, input.kind, relativePath),
    kind: input.kind,
    path: relativePath,
    format: input.format,
    producedBy: { providerId: input.producedBy.providerId, version: input.producedBy.version },
    ...(input.sourceRevision !== undefined ? { sourceRevision: input.sourceRevision } : {}),
    createdAt: input.now ?? Date.now(),
  }
  await upsertDevSpaceManifestEntry(input.root, input.projectSlug, {
    repositoryId: input.repositoryId, snapshotId: input.snapshotId, runId: input.runId,
  }, entry)
  return entry
}

/** True when any existing path component under `root` is a symlink. */
async function hasSymlinkLink(root: string, target: string): Promise<boolean> {
  const rel = relative(root, target)
  if (!within(root, target)) return true
  let path = root
  for (const part of rel.split(sep).filter(Boolean)) {
    path = join(path, part)
    try { if ((await lstat(path)).isSymbolicLink()) return true }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return false
}

/** A manifest is bound to one `(repositoryId, snapshotId, runId)` triple; a new triple starts a fresh set (§7.3). */
async function upsertDevSpaceManifestEntry(
  root: string, projectSlug: string,
  identity: { readonly repositoryId: string; readonly snapshotId: string; readonly runId: string },
  entry: DevSpaceManifestEntry,
): Promise<DevSpaceManifest> {
  const existing = await readDevSpaceManifest(root, projectSlug)
  const sameRun = existing !== null && existing.repositoryId === identity.repositoryId
    && existing.snapshotId === identity.snapshotId && existing.runId === identity.runId
  const entries = sameRun
    ? [...existing.entries.filter(current => current.id !== entry.id), entry]
    : [entry]
  if (entries.length > MAX_MANIFEST_ENTRIES) throw new Error('devSpace.manifest-limit')
  const manifest: DevSpaceManifest = { schemaVersion: 1, ...identity, entries }
  await mkdir(devSpaceRoot(root, projectSlug), { recursive: true, mode: 0o700 })
  atomicWriteFileSync(join(devSpaceRoot(root, projectSlug), DEV_SPACE_MANIFEST_FILENAME), JSON.stringify(manifest, null, 2))
  return manifest
}

const MANIFEST_FORMATS: Readonly<Record<DevSpaceArtifactFormat, true>> = { md: true, json: true, svg: true, mp3: true, srt: true }

function isManifestEntry(value: unknown): value is DevSpaceManifestEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && typeof entry.path === 'string'
    && typeof entry.kind === 'string' && entry.kind in KIND_DIRECTORY
    && typeof entry.format === 'string' && entry.format in MANIFEST_FORMATS
    && !!entry.producedBy && typeof entry.producedBy === 'object'
    && typeof entry.createdAt === 'number'
}

export async function readDevSpaceManifest(root: string, projectSlug: string): Promise<DevSpaceManifest | null> {
  if (!SLUG.test(projectSlug)) return null
  let raw: string
  try { raw = await readFile(join(devSpaceRoot(root, projectSlug), DEV_SPACE_MANIFEST_FILENAME), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const manifest = parsed as Record<string, unknown>
  if (manifest.schemaVersion !== 1 || typeof manifest.repositoryId !== 'string'
    || typeof manifest.snapshotId !== 'string' || typeof manifest.runId !== 'string'
    || !Array.isArray(manifest.entries)) return null
  if (!manifest.entries.every(isManifestEntry)) return null
  return manifest as unknown as DevSpaceManifest
}

/** Read one artifact's bytes back through the manifest path (contained, no symlinks). */
export async function readDevSpaceArtifactBytes(root: string, projectSlug: string, path: string): Promise<Buffer> {
  const target = resolveArtifactPath(root, projectSlug, path)
  if (await hasSymlinkLink(root, dirname(target))) throw new Error('devSpace.artifact-path-denied')
  return readFile(target)
}

/** Read one artifact's text back through the manifest path (contained, no symlinks). */
export async function readDevSpaceArtifact(root: string, projectSlug: string, entry: DevSpaceManifestEntry): Promise<string> {
  return (await readDevSpaceArtifactBytes(root, projectSlug, entry.path)).toString('utf8')
}

/** Default consent never enables egress (§8.1, §10); the UI flips explicit items. */
export function defaultDevSpaceConsent(repositoryId: string, now = Date.now()): DevSpaceConsent {
  return { schemaVersion: 1, repositoryId, items: { modelConnectors: false, cveNetwork: false, toolUpdates: false }, grantedAt: now, updatedAt: now }
}

export async function readDevSpaceConsent(root: string, projectSlug: string): Promise<DevSpaceConsent | null> {
  if (!SLUG.test(projectSlug)) return null
  let raw: string
  try { raw = await readFile(join(devSpaceRoot(root, projectSlug), DEV_SPACE_CONSENT_FILENAME), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const consent = parsed as Record<string, unknown>
  const items = consent.items as Record<string, unknown> | undefined
  if (consent.schemaVersion !== 1 || typeof consent.repositoryId !== 'string' || !items
    || typeof items.modelConnectors !== 'boolean' || typeof items.cveNetwork !== 'boolean'
    || typeof items.toolUpdates !== 'boolean') return null
  return consent as unknown as DevSpaceConsent
}

export async function writeDevSpaceConsent(root: string, projectSlug: string, consent: DevSpaceConsent): Promise<void> {
  if (!SLUG.test(projectSlug)) throw new Error('devSpace.invalid-project-slug')
  await mkdir(devSpaceRoot(root, projectSlug), { recursive: true, mode: 0o700 })
  atomicWriteFileSync(join(devSpaceRoot(root, projectSlug), DEV_SPACE_CONSENT_FILENAME), JSON.stringify(consent, null, 2))
}