/**
 * Dev Space `publish` stage (02-SPEC-foundations §7.4; ADR-0021).
 *
 * Publishes the human-readable Markdown artifacts (`wiki`/`understanding`/`c4`)
 * into Notes/Pages. Publication goes through the EXISTING server-side Markdown
 * commit pipeline — the durable, journaled `content:*` writer built on
 * `MarkdownCommitStore` (docs/markdown-commit.ts) — via the narrow
 * {@link DevSpacePublishPort} seam. The port is composed where the content
 * pipeline is composed; the pipeline itself is fire-and-forget with no window, so
 * the stage never assumes a renderer `RequestContext`.
 *
 * Receipts and conflicts never overwrite a user edit silently (§7.4):
 * - each published page carries an HTML-comment provenance marker holding the
 *   digest of the body we wrote;
 * - if the current note has no marker (a foreign page) or its body no longer
 *   matches the recorded digest (a user edit), the page is marked a conflict and
 *   left untouched;
 * - `HASH_CONFLICT`/`DOCUMENT_BUSY` from the commit pipeline are recorded in the
 *   run audit instead of failing the run.
 *
 * No `shell:exec`, no egress, no writes outside `projects/<slug>/dev-space/`
 * (audit) and the Notes store (through the port).
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { DevSpaceManifestEntry } from '@rox/shared/dev-space'
import { readDevSpaceArtifact, readDevSpaceManifest } from '../artifacts.ts'
import { registerDevSpaceStage, type DevSpaceStageContext, type DevSpaceStageOutcome } from '../runner.ts'

/** Mirrors the RPC handler's slug guard (dev-space.ts) — the slug selects `projects/<slug>`. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Human-readable kinds that become Notes/Pages (§7.4); JSON models are not published. */
const PUBLISHABLE_KINDS: Readonly<Record<string, true>> = { wiki: true, understanding: true, c4: true }

const MARKER_PREFIX = '<!-- rox-devspace:'
const SEPARATOR = '\n\n'

// ---------------------------------------------------------------------------
// Publish port
// ---------------------------------------------------------------------------

/** A published note as read back from the content store. */
export interface DevSpacePublishedNote {
  readonly revision: string
  readonly content: string
}

export interface DevSpacePublishWriteInput {
  readonly workspaceId: string
  readonly noteId: string
  readonly content: string
  /** `null` = the note is expected to be absent (a create, the `writeNative` create path). */
  readonly expectedRevision: string | null
  readonly operationId: string
}

export type DevSpacePublishWriteResult =
  | { readonly status: 'committed'; readonly revision: string; readonly previousRevision: string; readonly operationId: string; readonly committedAt: string }
  | { readonly status: 'conflict'; readonly currentRevision?: string }
  | { readonly status: 'busy' }
  | { readonly status: 'denied' }
  | { readonly status: 'unavailable'; readonly detail?: string }
  | { readonly status: 'failed'; readonly detail?: string }

/**
 * Server-side seam over the existing content commit pipeline. `write` maps to
 * `content:commitMarkdown` for updates and the `writeNative` create path for a
 * `null` `expectedRevision`; its failures must surface as `conflict`
 * (`HASH_CONFLICT`) / `busy` (`DOCUMENT_BUSY`) / `denied` without raw messages.
 */
export interface DevSpacePublishPort {
  read(workspaceId: string, noteId: string): Promise<DevSpacePublishedNote | null>
  write(input: DevSpacePublishWriteInput): Promise<DevSpacePublishWriteResult>
}

// ---------------------------------------------------------------------------
// Page rendering / conflict detection (§7.4)
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Trailing blank lines are normalised so the stored body digest round-trips exactly. */
function normalizeBody(body: string): string {
  return body.replace(/\n+$/, '')
}

/** Stable note path: `projects/<slug>/dev-space/<kind-dir>/<name>` without `.md`. */
function noteIdFor(projectSlug: string, entry: DevSpaceManifestEntry): string {
  return `projects/${projectSlug}/dev-space/${entry.path.replace(/\.md$/i, '')}`
}

/** Idempotent across a run retry: the same `(runId, noteId)` reuses one content operation. */
function operationIdFor(runId: string, noteId: string): string {
  return `devspace-publish-${sha256Hex(`${runId}\0${noteId}`).slice(0, 40)}`
}

/** Render the page body plus its self-describing provenance marker. */
function renderPage(body: string, entry: DevSpaceManifestEntry): string {
  const normalized = normalizeBody(body)
  const marker = `${MARKER_PREFIX} provider=${entry.producedBy.providerId}@${entry.producedBy.version} artifact=${entry.id} body=${sha256Hex(normalized)} -->`
  return `${normalized}${SEPARATOR}${marker}\n`
}

/** Parse a page we previously published; `null` when it carries no marker (a foreign page). */
function parsePublishedPage(content: string): { body: string; bodyDigest: string } | null {
  const index = content.lastIndexOf(MARKER_PREFIX)
  if (index < 0) return null
  // The marker is written with a trailing newline; tolerate any trailing whitespace
  // so our own unmodified output round-trips as ours instead of reading as foreign.
  const marker = content.slice(index).trimEnd()
  if (!marker.endsWith('-->')) return null
  const match = /body=([a-f0-9]{64})/.exec(marker)
  if (!match) return null
  return { body: normalizeBody(content.slice(0, index)), bodyDigest: match[1] as string }
}

// ---------------------------------------------------------------------------
// Stage execution
// ---------------------------------------------------------------------------

/** Best-effort append-only audit; a failure here never fails an analysis run (§8.4). */
async function appendPublishAudit(context: DevSpaceStageContext, event: Record<string, unknown>): Promise<void> {
  if (!SLUG.test(context.projectSlug)) return
  const directory = join(context.root, 'projects', context.projectSlug, 'dev-space')
  const rel = relative(context.root, directory)
  if (!(rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)))) return
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await appendFile(join(directory, 'audit.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), runId: context.runId, ...event })}\n`, 'utf8')
  } catch { /* audit is best-effort */ }
}

/**
 * Publish every human-readable Markdown artifact of the run's manifest, honouring
 * user edits. Returns `partial: true` whenever the manifest is unusable, the port
 * is absent, or any page could not be published cleanly.
 */
export async function runPublishStage(
  port: DevSpacePublishPort | undefined, context: DevSpaceStageContext,
): Promise<DevSpaceStageOutcome> {
  const manifest = await readDevSpaceManifest(context.root, context.projectSlug)
  if (!manifest || manifest.repositoryId !== context.repositoryId || manifest.snapshotId !== context.snapshotId) {
    await appendPublishAudit(context, {
      event: 'publish-skip',
      reason: !manifest ? 'no-manifest' : manifest.repositoryId !== context.repositoryId ? 'manifest-repo-mismatch' : 'manifest-snapshot-mismatch',
    })
    return { partial: true }
  }

  const pages = manifest.entries.filter(entry => PUBLISHABLE_KINDS[entry.kind] === true && entry.format === 'md')
  if (pages.length === 0) {
    await appendPublishAudit(context, { event: 'publish-skip', reason: 'no-pages' })
    return { partial: true }
  }
  if (!port) {
    await appendPublishAudit(context, { event: 'publish-unavailable', reason: 'no-publish-port', pageCount: pages.length })
    return { partial: true }
  }

  let partial = false
  let done = 0
  const total = pages.length
  context.report(0, total)

  for (const entry of pages) {
    if (context.signal.aborted) { partial = true; break }
    const noteId = noteIdFor(context.projectSlug, entry)
    const content = renderPage(await readDevSpaceArtifact(context.root, context.projectSlug, entry), entry)

    let expectedRevision: string | null = null
    const existing = await port.read(context.workspaceId, noteId)
    if (existing) {
      const parsed = parsePublishedPage(existing.content)
      // No marker, or a body that no longer matches our digest → the user edited
      // the page (or it is not ours). Never overwrite silently; mark the conflict.
      if (!parsed || parsed.bodyDigest !== sha256Hex(parsed.body)) {
        partial = true
        await appendPublishAudit(context, {
          event: 'publish-conflict', artifactId: entry.id, noteId, reason: 'user-edit', currentRevision: existing.revision,
        })
        done += 1
        context.report(done, total)
        continue
      }
      expectedRevision = existing.revision
    }

    const result = await port.write({
      workspaceId: context.workspaceId, noteId, content, expectedRevision, operationId: operationIdFor(context.runId, noteId),
    })
    if (result.status === 'committed') {
      await appendPublishAudit(context, {
        event: 'publish', artifactId: entry.id, noteId, status: 'ok',
        receipt: { revision: result.revision, previousRevision: result.previousRevision, operationId: result.operationId, committedAt: result.committedAt },
      })
    } else if (result.status === 'conflict') {
      partial = true
      await appendPublishAudit(context, {
        event: 'publish-conflict', artifactId: entry.id, noteId, reason: 'hash-conflict',
        ...(result.currentRevision !== undefined ? { currentRevision: result.currentRevision } : {}),
      })
    } else {
      partial = true
      const reason = result.status === 'busy' ? 'document-busy' : result.status
      await appendPublishAudit(context, {
        event: 'publish-error', artifactId: entry.id, noteId, status: result.status, reason,
        ...(result.status !== 'busy' && result.status !== 'denied' && result.detail !== undefined ? { detail: result.detail } : {}),
      })
    }
    done += 1
    context.report(done, total)
  }

  return { partial }
}

/**
 * Register the `publish` stage. The host composes the {@link DevSpacePublishPort}
 * from the content commit pipeline; without it the stage honestly reports
 * `publish-unavailable` instead of pretending a page was published.
 */
export function registerDevSpacePublishStage(port?: DevSpacePublishPort): void {
  registerDevSpaceStage('publish', context => runPublishStage(port, context))
}