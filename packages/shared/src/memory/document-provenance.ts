/**
 * document-provenance — the document-level injection gate for memory recall
 * (spec c1.2/c1.4), shared by the prompt-assembly code in `shared` (project
 * MEMORY.md) and the server-core MemoryService (workspace memory + lessons).
 *
 * `MemoryIndexService` writes a provenance override sidecar at
 * `{workspace}/memory/index-provenance.json`, keyed by workspace-relative
 * document path (`projects/<slug>/MEMORY.md`, `memory/context.md`, …). That map
 * is the single authority for trust: a document stamped `untrusted` must never
 * be injected into a prompt through ANY path — not just the curated bootstrap
 * block, but also the project-memory block, the workspace-memory block and the
 * lessons block.
 *
 * The gate is deliberately FAIL-OPEN for unknown documents: absence of an
 * override means the document keeps its default classification
 * (`agent`/`owner`), which is injectable. Only an explicit non-injectable
 * stamp excludes it. Classification is never parsed from document text.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import type { MemoryChunkProvenance, MemoryOriginClass } from './types.ts'

/** The origin classes that may enter a prompt automatically. */
export function isMemoryOriginInjectable(origin: MemoryOriginClass | undefined | null): boolean {
  return origin === 'owner' || origin === 'agent'
}

/**
 * Read the write-time provenance override sidecar
 * (`{workspace}/memory/index-provenance.json`). Keys are normalized to forward
 * slashes so lookups are platform-independent. Missing/corrupt → `{}`.
 */
export function loadMemoryProvenanceOverrides(workspaceRoot: string): Record<string, MemoryChunkProvenance> {
  try {
    const raw = readFileSync(join(workspaceRoot, 'memory', 'index-provenance.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, MemoryChunkProvenance>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, MemoryChunkProvenance> = {}
    for (const [key, value] of Object.entries(parsed)) {
      out[key.replace(/\\/g, '/')] = value
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Fail-open document gate: a document is injectable unless the override map
 * explicitly stamps it with a non-injectable origin class. Unknown documents
 * (no override entry) return `true`, preserving the default agent/owner
 * classification.
 */
export function isMemoryDocumentInjectable(
  workspaceRoot: string,
  relPath: string,
  overrides?: Record<string, MemoryChunkProvenance>,
): boolean {
  const map = overrides ?? loadMemoryProvenanceOverrides(workspaceRoot)
  const override = map[relPath.replace(/\\/g, '/')]
  if (!override || typeof override.originClass !== 'string') return true
  return isMemoryOriginInjectable(override.originClass)
}

/**
 * Injection decision for a bound project's MEMORY.md: excluded when the agent
 * profile captured `memoryScope: 'none'`, otherwise subject to the same
 * document-level provenance gate. Used by every backend's
 * `resolveProjectContext` so the project-memory path honours the gate.
 */
export function isProjectMemoryInjectable(
  workspaceRoot: string,
  projectSlug: string,
  memoryScope: string | undefined,
): boolean {
  if (memoryScope === 'none') return false
  return isMemoryDocumentInjectable(workspaceRoot, `projects/${projectSlug}/MEMORY.md`)
}