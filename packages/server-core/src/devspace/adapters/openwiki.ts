/**
 * openwiki adapter — repository wiki (`repo-wiki`, 03-SPEC-features §2.1, ADR-0020).
 *
 * `langchain-ai/openwiki` (npm `openwiki@0.7.1`, MIT, Node ≥ 22.22) generates a
 * linked Markdown wiki with Mermaid and evidence grounding. Per the D4 audit it
 * is NOT vendored and has no MCP catalog entry, so the honest default is a local
 * `openwiki --version` probe: a missing tool reports `unavailable` — this adapter
 * never installs, never updates and never fabricates a page.
 *
 * LLM egress shape: the adapter receives an ALREADY-MASKED source bundle
 * (`LlmGenerationInput.sources`, §8.3) and materialises it in an isolated staging
 * directory before running the generation flow, so the tool (and any model
 * connector it drives) can only ever observe masked repository content. The
 * adapter never reads the raw working copy itself.
 *
 * ASSUMPTIONs (not pinned by the D4 audit):
 * - the npm bin is `openwiki` and it answers `openwiki --version`;
 * - generation argv is `openwiki generate .`, emitting `openwiki-out/index.md`.
 * The argv/output contract is stable for tests through the injected `ToolExec` seam.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LlmAdapter, LlmGenerationInput, LlmGenerationResult } from '../stages/llm.ts'
import {
  TOOL_PROBE_TIMEOUT_MS, ToolExecError, defaultToolExec, parseToolVersion, toolProcessEnv,
  type ToolDetection, type ToolExec,
} from './contract.ts'

/** O7 pin (ADR-0020 §Decision-4). */
export const OPENWIKI_VERSION = '0.7.1'
/** Wiki generation drives a model connector; well beyond the 20 s `shell:exec` budget (ADR-0021). */
const OPENWIKI_RUN_TIMEOUT_MS = 30 * 60 * 1000
/** Output path under the staged working copy (ASSUMPTION above). */
const OPENWIKI_OUTPUT = 'openwiki-out/index.md'
/** Each source must reach a real file path; a masked bundle is capped by the stage. */
const MAX_SOURCE_FILE_BYTES = 256 * 1024

export function createOpenwikiLlmAdapter(deps: { readonly exec?: ToolExec } = {}): LlmAdapter {
  const exec = deps.exec ?? defaultToolExec

  async function detect(): Promise<ToolDetection> {
    try {
      const result = await exec({
        command: 'openwiki',
        args: ['--version'],
        cwd: process.cwd(),
        env: toolProcessEnv(process.env),
        timeoutMs: TOOL_PROBE_TIMEOUT_MS,
        signal: new AbortController().signal,
      })
      const version = parseToolVersion(`${result.stdout}\n${result.stderr}`)
      return { available: true, ...(version !== undefined ? { version } : {}) }
    } catch (error) {
      if (error instanceof ToolExecError && error.failure === 'unavailable') {
        return { available: false, detail: 'openwiki not on PATH' }
      }
      return { available: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  async function generate(input: LlmGenerationInput): Promise<LlmGenerationResult> {
    if (input.sources.length === 0) return { status: 'unavailable', detail: 'no masked source files' }
    const staging = await mkdtemp(join(tmpdir(), 'rox-devspace-openwiki-'))
    try {
      for (const source of input.sources) {
        if (Buffer.byteLength(source.content) > MAX_SOURCE_FILE_BYTES) continue
        // Never let a bundle path escape the staging root.
        if (source.path.startsWith('/') || source.path.split('/').includes('..')) continue
        const target = join(staging, source.path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, source.content, 'utf8')
      }
      try {
        await exec({
          command: 'openwiki',
          args: ['generate', '.'],
          cwd: staging,
          env: toolProcessEnv(process.env),
          timeoutMs: OPENWIKI_RUN_TIMEOUT_MS,
          signal: input.signal,
        })
      } catch (error) {
        const failure = error instanceof ToolExecError ? error.failure : 'failed'
        if (failure === 'unavailable') return { status: 'unavailable', detail: 'openwiki not on PATH' }
        const detail = failure === 'cancelled' ? 'cancelled' : failure === 'timeout' ? 'timeout'
          : error instanceof Error ? error.message : String(error)
        return { status: 'error', detail }
      }
      let content: string
      try { content = await readFile(join(staging, OPENWIKI_OUTPUT), 'utf8') }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'error', detail: 'openwiki produced no page' }
        throw error
      }
      return { status: 'ok', artifacts: [{ name: 'index.md', format: 'md', content }] }
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  return { id: 'openwiki', kind: 'wiki', version: OPENWIKI_VERSION, detect, generate }
}