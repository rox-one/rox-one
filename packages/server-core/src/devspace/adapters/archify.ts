/**
 * archify adapter — diagram generator from a typed IR (03-SPEC-features §2.4).
 *
 * `tt-a1i/archify` (`v3.0.1`, MIT) is an agent-skill that turns a typed JSON IR
 * into interactive HTML/SVG; it is NOT collapsed with groma (ADR-0020 O2) because
 * a rendered `diagram` artifact is not a diffable C4 source.
 *
 * ASSUMPTIONs (not pinned by the D4 audit; archify ships as a skill, not a catalogued
 * CLI):
 * - a `archify` bin answers `--version` on PATH when the skill is installed;
 * - render argv is `archify render .`, emitting `archify-out/diagram.svg`.
 * The IR builder is a separate later slice; until it exists this adapter can only
 * report `unavailable`/publish a pre-rendered SVG, never fabricate one.
 */
import type { ToolExecSpec } from './contract.ts'

/** Rendering a diagram is quick but still routed through the job-runner (ADR-0021). */
const ARCHIFY_TIMEOUT_MS = 2 * 60 * 1000

export const archifyAdapterSpec: ToolExecSpec = {
  id: 'archify',
  providerId: 'archify',
  kind: 'diagram',
  version: '3.0.1',
  probe: { command: 'archify', args: ['--version'] },
  run: { command: 'archify', args: () => ['render', '.'] },
  timeoutMs: ARCHIFY_TIMEOUT_MS,
  outputs: [{ source: 'archify-out/diagram.svg', name: 'diagram.svg', format: 'svg' }],
}