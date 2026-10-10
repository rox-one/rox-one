/**
 * Dev Space structural-tool adapter contract (03-SPEC-features §1, ADR-0020).
 *
 * Every structural adapter (codegraph/groma/graphify/archify) is an on-demand,
 * daemon-free `execFile` invocation over the repository working copy. Adapters
 * never install, update or telemetry-fingerprint a tool: `detect()` runs a
 * read-only `--version` probe and a missing tool reports `unavailable`, never an
 * install. Results are persisted ONLY through `writeDevSpaceArtifact(...)` so the
 * manifest stays the single source of truth (§7.3).
 *
 * The tool argv praxis is encoded as data (`ToolExecSpec`) with clearly marked
 * ASSUMPTIONs where the D4 audit did not pin an exact upstream command; the
 * execution/publish contract itself is stable and fully testable with an injected
 * `ToolExec` seam.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { DevSpaceArtifactFormat, DevSpaceManifestEntryKind } from '@rox/shared/dev-space'
import { writeDevSpaceArtifact } from '../artifacts.ts'

/** Generous cap so a large graph dump never trips `maxBuffer` (clone.ts uses the same). */
export const TOOL_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** A read-only availability probe must never block a pipeline; it only reports. */
export const TOOL_PROBE_TIMEOUT_MS = 5_000

/** `AbortSignal` is wired straight into `execFile`, which SIGTERMs the child. */
export interface ToolExecInput {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly signal: AbortSignal
  readonly maxBuffer?: number
}

export interface ToolExecResult {
  readonly code: 0
  readonly stdout: string
  readonly stderr: string
}

/** Injectable exec seam; the default is the real `execFile` (see `defaultToolExec`). */
export type ToolExec = (input: ToolExecInput) => Promise<ToolExecResult>

export type ToolFailureKind = 'unavailable' | 'timeout' | 'cancelled' | 'failed'

export class ToolExecError extends Error {
  constructor(readonly failure: ToolFailureKind, readonly exitCode: number | null, message: string) {
    super(message)
    this.name = 'ToolExecError'
  }
}

function classifyToolFailure(error: NodeJS.ErrnoException & { killed?: boolean; signal?: string | null }, signal: AbortSignal): ToolFailureKind {
  if (signal.aborted || error.name === 'AbortError') return 'cancelled'
  if (error.code === 'ENOENT') return 'unavailable'
  if (error.killed || error.code === 'ETIMEDOUT' || typeof error.signal === 'string') return 'timeout'
  return 'failed'
}

/** Real `execFile` runner: no shell, no cwd escape, `AbortSignal` → kill. */
export function defaultToolExec(input: ToolExecInput): Promise<ToolExecResult> {
  return new Promise<ToolExecResult>((resolvePromise, reject) => {
    execFile(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      signal: input.signal,
      timeout: input.timeoutMs,
      maxBuffer: input.maxBuffer ?? TOOL_MAX_OUTPUT_BYTES,
      windowsHide: true,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error) {
        const errno = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null }
        const exitCode = typeof errno.code === 'number' ? errno.code : null
        reject(new ToolExecError(classifyToolFailure(errno, input.signal), exitCode, errno.message))
        return
      }
      resolvePromise({ code: 0, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/**
 * Child env for a tool run: the same git hardening as `clone.ts` (a repo clone is
 * the cwd, so git-adjacent helpers must stay prompt-free) plus per-tool overrides.
 */
export function toolProcessEnv(base: NodeJS.ProcessEnv, extra?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return { ...base, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...extra }
}

export interface ToolDetection {
  readonly available: boolean
  /** Version parsed from the probe output, when the probe exposed one. */
  readonly version?: string
  readonly detail?: string
}

export type StructuralAdapterStatus = 'ok' | 'unavailable' | 'error'

export interface StructuralAdapterResult {
  /** Manifest entry ids produced by this run (§7.3); empty when nothing was published. */
  readonly artifactIds: readonly string[]
  readonly status: StructuralAdapterStatus
  readonly detail?: string
}

export interface StructuralAdapterContext {
  /** Workspace root; artifact writes resolve `projects/<slug>/dev-space/` beneath it. */
  readonly root: string
  /** Repository working copy; the tool's cwd, matching ADR-0022 `projects/<slug>/<repo-dir>`. */
  readonly cwd: string
  readonly projectSlug: string
  readonly repositoryId: string
  readonly snapshotId: string
  readonly runId: string
  /** Parent commit sha, when the caller resolved one (optional in the manifest, §7.3). */
  readonly sourceRevision?: string
  readonly signal: AbortSignal
  readonly report: (done: number, total: number) => void
}

export interface StructuralAdapter {
  readonly id: string
  readonly kind: DevSpaceManifestEntryKind
  /** Pinned upstream version (O7). */
  readonly version: string
  detect(): Promise<ToolDetection>
  run(context: StructuralAdapterContext): Promise<StructuralAdapterResult>
}

/** One published file: `source` lives under the tool cwd, `name` under the kind dir. */
export interface ToolOutputSpec {
  readonly source: string
  readonly name: string
  readonly format: DevSpaceArtifactFormat
}

export interface ToolExecSpec {
  readonly id: string
  /** Provenance providerId in the manifest; the D4 slug. */
  readonly providerId: string
  readonly kind: DevSpaceManifestEntryKind
  readonly version: string
  /** `--version` probe; never installs. */
  readonly probe: { readonly command: string; readonly args: readonly string[] }
  /** Real run argv; `cwd` is the repository working copy. ASSUMPTIONs are per-tool. */
  readonly run: { readonly command: string; readonly args: (cwd: string) => readonly string[] }
  /** Per-tool env (e.g. embedded DB location); no network, no telemetry. */
  readonly env?: (context: StructuralAdapterContext) => Readonly<Record<string, string>>
  /** Per-tool timeout, deliberately beyond the 20 s `shell:exec` budget (ADR-0021). */
  readonly timeoutMs: number
  readonly outputs: readonly ToolOutputSpec[]
}

/** `/^(\d+\.\d+(?:\.\d+)?)/` on the probe output; undefined when the tool prints none. */
export function parseToolVersion(output: string): string | undefined {
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(output)
  return match ? match[1] : undefined
}

function within(base: string, target: string): boolean {
  const rel = relative(base, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/**
 * Build an adapter from an exec spec. `detect()` never throws; `run()` classifies
 * any failure, publishes whatever the tool produced and never fabricates output.
 */
export function createToolAdapter(spec: ToolExecSpec, deps: { readonly exec?: ToolExec } = {}): StructuralAdapter {
  const exec = deps.exec ?? defaultToolExec

  async function detect(): Promise<ToolDetection> {
    try {
      const result = await exec({
        command: spec.probe.command,
        args: spec.probe.args,
        cwd: process.cwd(),
        env: toolProcessEnv(process.env),
        timeoutMs: TOOL_PROBE_TIMEOUT_MS,
        signal: new AbortController().signal,
      })
      const version = parseToolVersion(`${result.stdout}\n${result.stderr}`)
      return { available: true, ...(version !== undefined ? { version } : {}) }
    } catch (error) {
      if (error instanceof ToolExecError && error.failure === 'unavailable') {
        return { available: false, detail: `${spec.probe.command} not on PATH` }
      }
      return { available: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  async function publish(context: StructuralAdapterContext): Promise<string[]> {
    const ids: string[] = []
    for (const output of spec.outputs) {
      const target = resolve(context.cwd, output.source)
      if (!within(context.cwd, target)) continue
      let content: string
      try { content = await readFile(target, 'utf8') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      const entry = await writeDevSpaceArtifact({
        root: context.root,
        projectSlug: context.projectSlug,
        repositoryId: context.repositoryId,
        snapshotId: context.snapshotId,
        runId: context.runId,
        kind: spec.kind,
        name: output.name,
        format: output.format,
        content,
        producedBy: { providerId: spec.providerId, version: spec.version },
        ...(context.sourceRevision !== undefined ? { sourceRevision: context.sourceRevision } : {}),
      })
      ids.push(entry.id)
    }
    return ids
  }

  async function run(context: StructuralAdapterContext): Promise<StructuralAdapterResult> {
    try {
      await exec({
        command: spec.run.command,
        args: spec.run.args(context.cwd),
        cwd: context.cwd,
        env: toolProcessEnv(process.env, spec.env?.(context)),
        timeoutMs: spec.timeoutMs,
        signal: context.signal,
      })
    } catch (error) {
      const failure = error instanceof ToolExecError ? error.failure : 'failed'
      if (failure === 'unavailable') return { status: 'unavailable', artifactIds: [], detail: `${spec.probe.command} not on PATH` }
      const detail = failure === 'cancelled' ? 'cancelled' : failure === 'timeout' ? 'timeout' : (error instanceof Error ? error.message : String(error))
      return { status: 'error', artifactIds: [], detail }
    }
    const artifactIds = await publish(context)
    if (artifactIds.length === 0) return { status: 'error', artifactIds, detail: 'no tool output published' }
    return { status: 'ok', artifactIds }
  }

  return { id: spec.id, kind: spec.kind, version: spec.version, detect, run }
}