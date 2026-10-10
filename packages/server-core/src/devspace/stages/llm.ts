/**
 * Dev Space `llm` stage (02-SPEC-foundations §6.1, §8.3; 03-SPEC-features §2; ADR-0021).
 *
 * The LLM layer produces the wiki (`openwiki`) and repository understanding
 * (`understand-anything`) off the critical path, with monotonic progress. Two
 * hard rules bracket every run:
 *
 * 1. **Per-repo egress consent (§8.1, D6).** The stage reads `consent.json`; when
 *    `items.modelConnectors` is not `true` it appends an `llm-egress-denied`
 *    audit entry and finishes `partial` WITHOUT touching a single adapter — there
 *    is no silent egress (the analogue of `provider-egress-denied`).
 * 2. **Masking before egress (§8.3).** Adapters never see the raw working copy.
 *    They receive a masked source bundle built with the same default excludes as
 *    the code-intelligence ingest (`.env*`, `**\/*.pem`, `**\/*.key`,
 *    `**\/.codegraph/**` — `MANDATORY_REPOSITORY_EXCLUDES`) plus the existing
 *    `isSafeToIngest` guard and a residual secret-masking pass. Repository text is
 *    DATA, never instructions — every source is sanitised (`asUntrustedData`) and
 *    the adapter contract forbids interpreting it as a directive.
 *
 * A tool that is not installed reports `unavailable`; the stage never installs,
 * never fabricates artifacts and never fails the run on a missing tool (§6.4, D4).
 * Artifacts are persisted ONLY through `writeDevSpaceArtifact` with provider
 * provenance (§7.3).
 */
import { appendFile, mkdir, readdir, readFile, lstat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { isAbsolute, join, relative, basename, sep } from 'node:path'
import {
  MANDATORY_REPOSITORY_EXCLUDES, isRepositoryPathExcluded, isSafeToIngest,
  type ProviderPolicy,
} from '@rox/shared/code-intelligence'
import type { DevSpaceArtifactFormat, DevSpaceManifestEntryKind, DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import type { ToolDetection } from '../adapters/contract.ts'
import { createOpenwikiLlmAdapter } from '../adapters/openwiki.ts'
import { createUnderstandAnythingLlmAdapter } from '../adapters/understand-anything.ts'
import { readDevSpaceConsent, writeDevSpaceArtifact } from '../artifacts.ts'
import { registerDevSpaceStage, type DevSpaceStageContext, type DevSpaceStageOutcome } from '../runner.ts'

/** Mirrors the RPC handler's slug guard (dev-space.ts) — the slug selects `projects/<slug>`. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Bounds mirror the code-intelligence snapshot limits so a bundle stays a snapshot, not a mirror. */
export const MAX_SOURCE_FILES = 2_000
export const MAX_SOURCE_FILE_BYTES = 256 * 1024
export const MAX_SOURCE_TOTAL_BYTES = 16 * 1024 * 1024

/** Replacement written in place of a detected secret (§8.3). */
export const SECRET_MASK = '[redacted]'

/** Directory names never walked, independent of the glob excludes. */
const SKIP_DIRECTORIES: Readonly<Record<string, true>> = {
  '.git': true, 'node_modules': true, '.codegraph': true, '.ua': true, 'dist': true, 'build': true,
}

// ---------------------------------------------------------------------------
// LLM adapter contract
// ---------------------------------------------------------------------------

/** One masked repository file: `path` is provenance only, `content` is data, never a directive. */
export interface LlmSourceFile {
  readonly path: string
  readonly content: string
}

export interface LlmGenerationInput {
  /** The ONLY repository content an adapter may send to a model — already masked (§8.3). */
  readonly sources: readonly LlmSourceFile[]
  readonly signal: AbortSignal
  /** Optional sub-progress ping; the stage also reports once per adapter. */
  readonly report: (done: number, total: number) => void
}

export interface LlmArtifactOutput {
  readonly name: string
  readonly format: DevSpaceArtifactFormat
  readonly content: string
}

export type LlmGenerationResult =
  | { readonly status: 'ok'; readonly artifacts: readonly LlmArtifactOutput[] }
  | { readonly status: 'unavailable'; readonly detail?: string }
  | { readonly status: 'error'; readonly detail?: string }

export interface LlmAdapter {
  readonly id: string
  /** Manifest kind for this adapter's artifacts (§7.3): `wiki` or `understanding`. */
  readonly kind: DevSpaceManifestEntryKind
  /** Pinned upstream version (O7). */
  readonly version: string
  /** Local availability probe; never installs and never egresses. */
  detect(): Promise<ToolDetection>
  /** Generate from the masked bundle; never reads the raw tree and never fabricates. */
  generate(input: LlmGenerationInput): Promise<LlmGenerationResult>
}

/** O7 adapter set: wiki (openwiki) + understanding (understand-anything). */
export function defaultLlmAdapters(): readonly LlmAdapter[] {
  return [createOpenwikiLlmAdapter(), createUnderstandAnythingLlmAdapter()]
}

// ---------------------------------------------------------------------------
// Secret masking (§8.3)
// ---------------------------------------------------------------------------

/**
 * Residual masking patterns beyond the `isSafeToIngest` guard: private keys,
 * provider tokens and `KEY=value` credentials. Applied to every kept file.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  /(?<=(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*["']?)[^\s"',;]{6,}/gi,
]

/** Replace every detected secret token with {@link SECRET_MASK}. */
export function maskSecrets(text: string): string {
  let masked = text
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    masked = masked.replace(pattern, SECRET_MASK)
  }
  return masked
}

/**
 * §8.3 + data/instruction rule: normalise newlines and strip control characters
 * (keeping tab/newline) so repository text can only ever be treated as content,
 * never as instructions.
 */
export function asUntrustedData(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/(?![\t\n])\p{Cc}/gu, '')
}

/**
 * Build the masked source bundle by walking the repository working copy: skip
 * excluded paths and symlinks, drop binary/oversized files and anything the
 * existing `isSafeToIngest` guard rejects as a secret, then mask residue.
 */
export async function collectMaskedSources(cwd: string): Promise<LlmSourceFile[]> {
  // A policy object only to reuse the code-intelligence exclude matcher.
  const policy: ProviderPolicy = {
    id: 'devspace-llm-egress', workspaceId: 'devspace', allowedRoots: ['.'],
    excludes: [...MANDATORY_REPOSITORY_EXCLUDES], dataEgress: 'deny',
    maxFileBytes: MAX_SOURCE_FILE_BYTES, maxBytes: MAX_SOURCE_TOTAL_BYTES, maxFiles: MAX_SOURCE_FILES,
  }
  const sources: LlmSourceFile[] = []
  let totalBytes = 0
  const stack: string[] = ['']

  while (stack.length > 0 && sources.length < MAX_SOURCE_FILES && totalBytes < MAX_SOURCE_TOTAL_BYTES) {
    const directory = stack.pop() as string
    let entries: Dirent[]
    try { entries = await readdir(directory ? join(cwd, directory) : cwd, { withFileTypes: true }) }
    catch { continue }
    for (const entry of entries) {
      const relativePath = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES[entry.name] || isRepositoryPathExcluded(relativePath, policy)) continue
        stack.push(relativePath)
        continue
      }
      if (!entry.isFile() || isRepositoryPathExcluded(relativePath, policy)) continue
      if (sources.length >= MAX_SOURCE_FILES || totalBytes >= MAX_SOURCE_TOTAL_BYTES) break
      const absolute = join(cwd, relativePath)
      try {
        const info = await lstat(absolute)
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SOURCE_FILE_BYTES) continue
        const raw = await readFile(absolute, 'utf8')
        if (raw.includes('\u0000')) continue
        if (!isSafeToIngest({ path: relativePath, content: raw, commit: '' })) continue
        const content = asUntrustedData(maskSecrets(raw))
        totalBytes += Buffer.byteLength(content)
        sources.push({ path: relativePath, content })
      } catch { /* unreadable/racing entry: skip, never abort the bundle */ }
    }
  }
  return sources
}

// ---------------------------------------------------------------------------
// Stage execution
// ---------------------------------------------------------------------------

/** Repository working copy under `projects/<slug>/` (ADR-0022); mirrors the structural stage. */
function resolveWorkingCopy(root: string, record: DevSpaceRepositoryRecord): string {
  if (record.origin.kind === 'local-folder') return record.origin.path
  const raw = record.origin.url.replace(/\.git$/i, '').split('/').filter(Boolean).pop() ?? 'repository'
  const name = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'repo'
  return join(root, 'projects', record.projectSlug, name)
}

/** Best-effort append-only audit; a failure here never fails an analysis run (§8.4). */
async function appendLlmAudit(context: DevSpaceStageContext, event: Record<string, unknown>): Promise<void> {
  if (!SLUG.test(context.projectSlug)) return
  const directory = join(context.root, 'projects', context.projectSlug, 'dev-space')
  const rel = relative(context.root, directory)
  if (!(rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)))) return
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await appendFile(join(directory, 'audit.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), runId: context.runId, ...event })}\n`, 'utf8')
  } catch { /* audit is best-effort */ }
}

/** A manifest name must be a bare filename; flatten any tool-emitted nesting. */
function artifactName(name: string, format: DevSpaceArtifactFormat): string {
  const flat = basename(name).replace(/[\\/]/g, '_')
  return flat.length > 0 ? flat : `artifact.${format}`
}

/**
 * Run the LLM adapters in sequence behind the consent gate, returning the manifest
 * entry ids produced and `partial: true` when consent is missing, a tool is
 * unavailable or a generation reported an error.
 *
 * O10 (closed 2026-10-10): the stage stays sequential — each adapter is a
 * local agentic CLI whose own concurrency is unbounded already, so running
 * them in parallel would multiply load for no wall-clock win. Bounded
 * concurrency is a v1.x lever, not a v1 gap.
 */
export async function runLlmStage(
  adapters: readonly LlmAdapter[], context: DevSpaceStageContext,
): Promise<DevSpaceStageOutcome> {
  const consent = await readDevSpaceConsent(context.root, context.projectSlug)
  if (!consent || consent.repositoryId !== context.repositoryId || !consent.items.modelConnectors) {
    await appendLlmAudit(context, {
      event: 'llm-egress-denied',
      reason: !consent ? 'consent-missing' : consent.repositoryId !== context.repositoryId ? 'consent-repo-mismatch' : 'consent-denied',
    })
    return { partial: true }
  }

  const cwd = resolveWorkingCopy(context.root, context.record)
  const total = adapters.length
  const artifacts: string[] = []
  let partial = false
  let done = 0
  let sources: LlmSourceFile[] | null = null
  context.report(0, total)

  for (const adapter of adapters) {
    if (context.signal.aborted) { partial = true; break }
    const detection = await adapter.detect()
    if (!detection.available) {
      partial = true
      await appendLlmAudit(context, {
        event: 'llm-adapter', adapter: adapter.id, version: adapter.version, status: 'skip', reason: 'unavailable',
        ...(detection.detail !== undefined ? { detail: detection.detail } : {}),
      })
      done += 1
      context.report(done, total)
      continue
    }

    sources ??= await collectMaskedSources(cwd)
    if (sources.length === 0) {
      partial = true
      await appendLlmAudit(context, { event: 'llm-adapter', adapter: adapter.id, version: adapter.version, status: 'skip', reason: 'no-sources' })
      done += 1
      context.report(done, total)
      continue
    }

    const result = await adapter.generate({ sources, signal: context.signal, report: context.report })
    if (result.status === 'ok') {
      for (const output of result.artifacts) {
        const entry = await writeDevSpaceArtifact({
          root: context.root,
          projectSlug: context.projectSlug,
          repositoryId: context.repositoryId,
          snapshotId: context.snapshotId,
          runId: context.runId,
          kind: adapter.kind,
          name: artifactName(output.name, output.format),
          format: output.format,
          content: output.content,
          producedBy: { providerId: adapter.id, version: adapter.version },
        })
        artifacts.push(entry.id)
      }
      await appendLlmAudit(context, {
        event: 'llm-adapter', adapter: adapter.id, version: adapter.version, status: 'run', artifactCount: result.artifacts.length,
      })
    } else {
      partial = true
      await appendLlmAudit(context, {
        event: 'llm-adapter', adapter: adapter.id, version: adapter.version,
        status: result.status === 'unavailable' ? 'skip' : 'error',
        reason: result.status,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      })
    }
    done += 1
    context.report(done, total)
  }

  return { artifacts, partial }
}

/** Register the `llm` stage; a later integration may pass an explicit adapter set. */
export function registerDevSpaceLlmStage(adapters: readonly LlmAdapter[] = defaultLlmAdapters()): void {
  registerDevSpaceStage('llm', context => runLlmStage(adapters, context))
}