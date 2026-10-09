/**
 * bootstrap — provenance-gated MEMORY.md / curated-context prompt block (spec c1.4).
 *
 * This is the ONLY place curated memory enters an agent prompt automatically.
 * A source document is admitted only when its whole-document provenance class is
 * injectable (`owner`/`agent`); untrusted documents stay retrievable via
 * `memory_search` but can never be injected here or anywhere else in the prompt.
 * Output is bounded by a byte budget and skipped entirely when empty.
 */
import type { MemoryChunkProvenance } from '@rox/shared/memory/types'
import { isMemoryOriginEligibleForAutomaticInjection } from './provenance-gate'
import type { ChunkSourceDoc } from './chunk-index'

/** Default budget for the assembled bootstrap block, in characters. */
export const MEMORY_BOOTSTRAP_MAX_BYTES = 6000

export interface MemoryBootstrapEntry {
  path: string
  provenance: MemoryChunkProvenance
}

export interface MemoryBootstrapResult {
  /** Assembled block (undefined when nothing eligible fit). */
  block?: string
  /** Provenance of the documents folded in, in injection order. */
  entries: MemoryBootstrapEntry[]
}

/**
 * Assemble the curated-memory block. Whole documents are added while the byte
 * budget allows; the first document that would overflow is dropped (and every
 * document after it) so the block is deterministic and never half-truncated.
 */
export function buildMemoryBootstrap(
  docs: ChunkSourceDoc[],
  opts?: { maxBytes?: number },
): MemoryBootstrapResult {
  const maxBytes = opts?.maxBytes ?? MEMORY_BOOTSTRAP_MAX_BYTES
  const entries: MemoryBootstrapEntry[] = []
  const sections: string[] = []
  let used = 0
  for (const doc of docs) {
    if (!isMemoryOriginEligibleForAutomaticInjection(doc.provenance.originClass)) continue
    const content = doc.content.trim()
    if (!content) continue
    const section = `## ${doc.path}\n${content}`
    if (used + section.length + 1 > maxBytes) break
    used += section.length + 1
    sections.push(section)
    entries.push({ path: doc.path, provenance: doc.provenance })
  }
  if (sections.length === 0) return { entries }
  return {
    block: ['', '[Curated memory]', ...sections.flatMap(s => ['', s]), ''].join('\n'),
    entries,
  }
}