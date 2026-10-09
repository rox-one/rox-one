/**
 * understand-anything adapter — repository understanding (`learning`, 03-SPEC-features §2.2, ADR-0020).
 *
 * `Egonex-AI/Understand-Anything` is a vendored multi-agent SKILL
 * (`apps/electron/resources/skills/understand-anything/**`, pin `@1d7418b8…`, MIT),
 * not a standalone CLI. It requires the agent skill harness (subcommands
 * `understand`/`understand-dashboard`/`understand-onboard`/…) plus an LLM under
 * consent, and produces `.ua/knowledge-graph.json` + learning material.
 *
 * Because the platform MUST NOT add a second agent runtime (ADR-0019), this
 * adapter has no built-in invocation: it reports `unavailable` with a precise
 * reason unless the host composes a `generate` seam. It never fabricates a
 * knowledge graph and never spawns a process of its own.
 *
 * The `generate` seam receives the SAME masked source bundle as every other LLM
 * adapter (`LlmGenerationInput.sources`, §8.3) — the skill may only ever observe
 * masked repository content.
 */
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { LlmAdapter, LlmGenerationInput, LlmGenerationResult } from '../stages/llm.ts'
import type { ToolDetection } from './contract.ts'

/** Vendored-pin version label (O7) — the skill snapshot, not an npm release. */
export const UNDERSTAND_ANYTHING_VERSION = '1d7418b8'

/** Repo-relative vendored skill location (research audit §1.3). Overridable for packagers. */
export function defaultUnderstandAnythingSkillDirectory(): string {
  return process.env.ROX_UNDERSTAND_ANYTHING_SKILL_DIR
    ?? join(process.cwd(), 'apps', 'electron', 'resources', 'skills', 'understand-anything')
}

export interface UnderstandAnythingDeps {
  /** Vendored skill root; defaults to the app resource path. */
  readonly skillDirectory?: string
  /**
   * Host-composed invocation through the existing agent runtime/skill seam. Absent
   * means the platform has no way to run the skill — the adapter stays `unavailable`.
   */
  readonly generate?: (input: LlmGenerationInput) => Promise<LlmGenerationResult>
}

export function createUnderstandAnythingLlmAdapter(deps: UnderstandAnythingDeps = {}): LlmAdapter {
  const skillDirectory = deps.skillDirectory ?? defaultUnderstandAnythingSkillDirectory()

  async function detect(): Promise<ToolDetection> {
    const installed = await access(skillDirectory).then(() => true, () => false)
    if (!deps.generate) {
      return {
        available: false,
        detail: installed
          ? 'vendored skill present; requires the agent skill harness (not composed)'
          : 'understand-anything skill not installed',
      }
    }
    return { available: true, ...(installed ? { detail: 'skill harness composed' } : {}) }
  }

  async function generate(input: LlmGenerationInput): Promise<LlmGenerationResult> {
    if (!deps.generate) return { status: 'unavailable', detail: 'agent skill harness not composed' }
    if (input.sources.length === 0) return { status: 'unavailable', detail: 'no masked source files' }
    return deps.generate(input)
  }

  return { id: 'understand-anything', kind: 'understanding', version: UNDERSTAND_ANYTHING_VERSION, detect, generate }
}