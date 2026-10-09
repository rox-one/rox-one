/**
 * Codebook renderer bridge (С-15, docs/specs/2026-10-09-dev-space-and-playbooks
 * 04-UI-SPEC B.15, D12, В5). Consumes the frozen `playbooks:runCodebook` /
 * `playbooks:cancelCodebook` / `playbooks:codebookRuns` RPC surface plus the
 * `playbooks:codebookJob` push stream (monotonic `seq`, see
 * `@rox/shared/playbooks`). One job runs one notebook's ordered cell pipeline;
 * per-cell results ride `job.steps[i]`.
 *
 * Export is renderer-side through the existing `saveTextFile` dialog (no new
 * native surface): JSON is the notebook + last run, Markdown is a readable
 * pipeline dump. Result artifacts are referenced by В2 artifact id; reading
 * their content is optional and mirrors the `podcast-client` reader precedent,
 * so a host without the dev-space artifact bridge degrades gracefully.
 */
import type {
  CodebookCancelInput,
  CodebookCancelResult,
  CodebookCell,
  CodebookJob,
  CodebookRunInput,
  CodebookRunResult,
  CodebookRunsInput,
  CodebookRunsResult,
} from '@rox/shared/playbooks'

export type {
  CodebookCancelInput,
  CodebookCancelResult,
  CodebookCell,
  CodebookCellKind,
  CodebookErrorCode,
  CodebookJob,
  CodebookJobState,
  CodebookRun,
  CodebookRunInput,
  CodebookRunResult,
  CodebookRunsInput,
  CodebookRunsResult,
  CodebookStepOutput,
  CodebookStepResult,
  CodebookStepStatus,
} from '@rox/shared/playbooks'

/** Optional channel the artifact preview depends on; absent until В2 artifacts land. */
interface DevSpaceArtifactReader {
  readDevSpaceArtifact?(input: { workspaceId: string; projectSlug?: string; artifactId: string }): Promise<string>
}

export function runCodebook(input: CodebookRunInput): Promise<CodebookRunResult> {
  return window.electronAPI.runCodebook(input)
}

export function cancelCodebook(input: CodebookCancelInput): Promise<CodebookCancelResult> {
  return window.electronAPI.cancelCodebook(input)
}

export function listCodebookRuns(input: CodebookRunsInput): Promise<CodebookRunsResult> {
  return window.electronAPI.listCodebookRuns(input)
}

export function onCodebookJob(callback: (job: CodebookJob) => void): () => void {
  return window.electronAPI.onCodebookJob(callback)
}

/**
 * Read a step result artifact (bounded text) for the in-cell preview. Returns
 * `null` when the host has no В2 dev-space artifact bridge, so the preview
 * degrades without inventing content.
 */
export async function readCellArtifact(input: { workspaceId: string; projectSlug?: string; artifactId: string }): Promise<string | null> {
  const reader = window.electronAPI as unknown as DevSpaceArtifactReader
  if (typeof reader.readDevSpaceArtifact !== 'function') return null
  return reader.readDevSpaceArtifact(input)
}

export type CodebookExportFormat = 'json' | 'md'

export interface CodebookExportInput {
  readonly notebook: { readonly id: string; readonly name: string; readonly projectSlug?: string; readonly cells?: readonly CodebookCell[] }
  /** Last observed run; its step results are embedded when present. */
  readonly job?: CodebookJob | null
  readonly format: CodebookExportFormat
  readonly defaultPath: string
}

/** Notebook + last-run JSON, faithful to the persisted cells (no invented fields). */
export function buildCodebookExportJson(input: CodebookExportInput): string {
  const { notebook, job } = input
  return `${JSON.stringify({
    schemaVersion: 1,
    notebookId: notebook.id,
    name: notebook.name,
    ...(notebook.projectSlug ? { projectSlug: notebook.projectSlug } : {}),
    exportedAt: new Date().toISOString(),
    cells: notebook.cells ?? [],
    ...(job ? { results: { jobId: job.id, runId: job.runId, state: job.state, steps: job.steps } } : {}),
  }, null, 2)}\n`
}

/** Human-readable pipeline: one section per cell with its last result. */
export function buildCodebookExportMarkdown(input: CodebookExportInput): string {
  const { notebook, job } = input
  const lines: string[] = [`# ${notebook.name}`, '']
  lines.push(`> ${notebook.cells?.length ?? 0} cells${notebook.projectSlug ? ` · ${notebook.projectSlug}` : ''}`, '')
  const cells = notebook.cells ?? []
  for (const [index, cell] of cells.entries()) {
    const result = job?.steps.find((step) => step.cellId === cell.id)
    lines.push(`## ${index + 1}. ${cell.title ?? cell.id} (${cell.kind})`, '')
    if (cell.kind === 'script') lines.push('```sh', [cell.command ?? '', ...(cell.args ?? [])].join(' '), '```', '')
    if (cell.kind === 'agent') lines.push('```text', cell.prompt ?? '', '```', '')
    if (cell.kind === 'artifact') lines.push(`artifact: ${cell.artifactId ?? ''}`, '')
    if (result) {
      lines.push(`status: ${result.status}${typeof result.output?.exitCode === 'number' ? ` (exit ${result.output.exitCode})` : ''}`, '')
      if (result.output?.text) lines.push('```text', result.output.text, '```', '')
      if (result.output?.stderr) lines.push('stderr:', '```text', result.output.stderr, '```', '')
      if (result.error) lines.push(`error: ${result.error.code}${result.error.detail ? ` — ${result.error.detail}` : ''}`, '')
      if (result.output?.artifactId) lines.push(`artifact: ${result.output.artifactId}`, '')
      if (result.output?.sessionId) lines.push(`session: ${result.output.sessionId}`, '')
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** Renderer-side export through the shared native text-save dialog. */
export async function exportCodebookNotebook(input: CodebookExportInput): Promise<{ canceled: boolean; filePath?: string }> {
  const content = input.format === 'json' ? buildCodebookExportJson(input) : buildCodebookExportMarkdown(input)
  return window.electronAPI.saveTextFile({
    content,
    defaultPath: input.defaultPath,
    filters: input.format === 'json'
      ? [{ name: 'JSON', extensions: ['json'] }]
      : [{ name: 'Markdown', extensions: ['md'] }],
  })
}